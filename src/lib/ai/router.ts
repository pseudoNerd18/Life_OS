/**
 * The AI router is the top-level orchestrator. It takes a user message and:
 *   1. Recalls relevant memory via pgvector.
 *   2. Runs intent extraction with Gemma (local).
 *   3. Optionally escalates to Claude/GPT for hard reasoning (if API key set).
 *   4. Executes side effects (create tasks/goals/notes) via the action layer.
 *   5. Returns a short natural-language reply for the chat UI.
 *
 * Side effects (DB writes) live in /lib/server/actions.ts so this file stays
 * a pure orchestration layer.
 */

import { extractIntent } from "./extractor";
import { recallSimilar, rememberFact } from "./memory";
import { ollamaChat } from "./ollama";
import { getCapabilities } from "@/lib/env";
import { CONVERSATIONAL_REPLY_SYSTEM } from "./prompts";
import {
  createTasksFromIntent, createGoalFromIntent, createNoteFromIntent,
  updateEntity, completeTask, deleteEntity, type DeletedSnapshot,
} from "@/lib/server/actions";
import { resolveTarget } from "@/lib/server/resolve";
import type { ExtractedIntent } from "@/lib/validation";

export interface RouteResult {
  intent: ExtractedIntent["intent"];
  reply: string;
  created: {
    taskIds: string[];
    goalId?: string;
    noteId?: string;
  };
  /** Set when this turn changed or removed something that already existed. */
  affected?: { kind: "task" | "note" | "goal"; id?: string; title: string };
  /** Present after a delete, so the caller can offer an undo. */
  undo?: DeletedSnapshot;
  extracted: ExtractedIntent;
}

export async function routeMessage(args: {
  userId: string;
  timezone: string;
  message: string;
}): Promise<RouteResult> {
  // 1. Pull relevant prior memory (lightweight context, not yet injected into
  //    extraction — kept available for the conversational reply step).
  const memories = await recallSimilar({
    userId: args.userId,
    query: args.message,
    k: 4,
  }).catch(() => []);

  // 2. Extract structured intent
  const intent = await extractIntent(args.message, { timezone: args.timezone });

  // 3. Execute side effects
  const created: RouteResult["created"] = { taskIds: [] };

  if (intent.intent === "CREATE_TASK" || intent.intent === "CREATE_TASKS") {
    if (intent.tasks?.length) {
      const ids = await createTasksFromIntent(args.userId, intent.tasks);
      created.taskIds = ids;
      // Remember in semantic store
      await Promise.all(
        intent.tasks.map((t, i) =>
          rememberFact({
            userId: args.userId,
            kind: "task",
            refId: ids[i],
            content: `Task: ${t.title}${t.dueAt ? ` due ${t.dueAt}` : ""}`,
          }).catch(() => {}),
        ),
      );
    }
  } else if (intent.intent === "CREATE_GOAL" && intent.goal) {
    const { goalId } = await createGoalFromIntent(args.userId, args.timezone, intent.goal);
    created.goalId = goalId;
    await rememberFact({
      userId: args.userId,
      kind: "goal",
      refId: goalId,
      content: `Goal: ${intent.goal.title}`,
    }).catch(() => {});
  } else if (intent.intent === "UPDATE" || intent.intent === "DELETE" || intent.intent === "COMPLETE") {
    return actOnExisting(args.userId, intent, args.message);
  } else if (intent.intent === "CREATE_NOTE" && intent.note) {
    const noteId = await createNoteFromIntent(args.userId, intent.note);
    created.noteId = noteId;
    await rememberFact({
      userId: args.userId,
      kind: "note",
      refId: noteId,
      content: `Note: ${intent.note.title} — ${intent.note.content.slice(0, 200)}`,
    }).catch(() => {});
  }

  // 4. Compose conversational reply
  const reply = await composeReply({
    intent,
    created,
    memoryHints: memories.slice(0, 3).map((m) => m.content),
    original: args.message,
  });

  return { intent: intent.intent, reply, created, extracted: intent };
}

async function composeReply(args: {
  intent: ExtractedIntent;
  created: RouteResult["created"];
  memoryHints: string[];
  original: string;
}): Promise<string> {
  // Cheap deterministic replies for the common case — avoids an LLM round-trip.
  if (args.intent.intent === "CREATE_TASK" || args.intent.intent === "CREATE_TASKS") {
    const n = args.created.taskIds.length;
    if (n === 0) return "I couldn't quite parse that — try rephrasing?";
    if (n === 1) {
      const t = args.intent.tasks?.[0];
      const when = t?.dueAt ? ` for ${new Date(t.dueAt).toLocaleString()}` : "";
      return `Added "${t?.title}"${when}.`;
    }
    return `Added ${n} tasks.`;
  }
  // These must report what actually happened. The model sometimes returns
  // CREATE_NOTE with no note object at all; the reply used to say "Note saved."
  // regardless, so a silent no-op looked like a success.
  if (args.intent.intent === "CREATE_GOAL") {
    if (!args.created.goalId) return "I understood a goal but couldn't tell what it was — try naming it?";
    return `Goal created. I'll draft a plan with milestones — open it to review.`;
  }
  if (args.intent.intent === "CREATE_NOTE") {
    if (!args.created.noteId) return "I understood a note but couldn't tell what to write — try again?";
    return `Note saved.`;
  }
  if (args.intent.intent === "QUERY" && args.intent.reply) {
    return args.intent.reply;
  }
  // CHITCHAT / UNKNOWN → let the LLM reply briefly, if it's available.
  if (!getCapabilities().hasOllama) {
    return "I've noted that. Try phrasing it as something to do, and I'll turn it into a task.";
  }
  try {
    const reply = await ollamaChat({
      system: CONVERSATIONAL_REPLY_SYSTEM,
      prompt: `User said: "${args.original}"\n\nReply in 1-2 short sentences.`,
      temperature: 0.4,
    });
    return reply.trim() || "Got it.";
  } catch {
    return "Got it.";
  }
}


/**
 * UPDATE / DELETE / COMPLETE — the "act on something that already exists" path.
 *
 * Resolution failures are answered, not swallowed. Saying "I couldn't find a
 * note about the roof" is far better than creating a second one, which is what
 * the create-only router used to do with an edit request.
 */
async function actOnExisting(
  userId: string,
  intent: ExtractedIntent,
  original: string,
): Promise<RouteResult> {
  const base = { intent: intent.intent, created: { taskIds: [] as string[] }, extracted: intent };
  const target = intent.target ?? { kind: "task" as const, ref: "last" as const, query: null };
  const kind = target.kind ?? "task";

  const resolution = await resolveTarget(userId, target, {
    destructive: intent.intent === "DELETE",
  });

  if (resolution.status === "none") {
    const what = target.query ? `"${target.query}"` : `a recent ${kind}`;
    return { ...base, reply: `I couldn't find ${what} to ${verbOf(intent.intent)}. Nothing was changed.` };
  }
  if (resolution.status === "ambiguous") {
    const names = resolution.candidates.map((c) => `"${c.title}"`).join(", ");
    return {
      ...base,
      reply: `That could be ${names}. Which one did you mean? Nothing was changed.`,
    };
  }

  const found = resolution.target;

  if (intent.intent === "COMPLETE") {
    const r = await completeTask(userId, found.id);
    if (!r.ok) return { ...base, reply: `I couldn't complete that (${r.reason}).` };
    return {
      ...base,
      reply: `Marked "${r.title}" done.`,
      affected: { kind: "task", id: found.id, title: r.title },
    };
  }

  if (intent.intent === "DELETE") {
    const r = await deleteEntity(userId, kind, found.id);
    if (!r.ok) return { ...base, reply: `I couldn't delete that (${r.reason}).` };
    return {
      ...base,
      reply: `Deleted the ${kind} "${r.snapshot.title}".`,
      affected: { kind, title: r.snapshot.title },
      undo: r.snapshot,
    };
  }

  // UPDATE
  const patch = intent.patch ?? {};
  if (!Object.keys(patch).length) {
    return { ...base, reply: `I understood an edit to "${found.title}" but not what to change.` };
  }
  const r = await updateEntity(userId, kind, found.id, patch);
  if (!r.ok) {
    if (r.reason === "text-not-found") {
      return { ...base, reply: `"${found.title}" doesn't contain that text, so I left it alone.` };
    }
    if (r.reason === "nothing-to-change") {
      return { ...base, reply: `I couldn't tell what to change about "${found.title}".` };
    }
    return { ...base, reply: `I couldn't update that (${r.reason}).` };
  }
  void original;
  return {
    ...base,
    reply: `Updated ${r.changed.join(" and ")} on "${r.title}".`,
    affected: { kind, id: found.id, title: r.title },
  };
}

function verbOf(intent: ExtractedIntent["intent"]): string {
  if (intent === "DELETE") return "delete";
  if (intent === "COMPLETE") return "complete";
  return "update";
}
