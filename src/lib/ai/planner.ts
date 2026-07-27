import { ollamaChat } from "./ollama";
import { GOAL_PLANNER_SYSTEM, goalPlannerPrompt } from "./prompts";
import { z } from "zod";
import { modelCategoryZ, modelDateZ, modelDurationZ, modelPriorityZ, modelRRuleZ } from "./schema";

const planZ = z.object({
  // A missing rationale should not sink an otherwise-good plan.
  rationale: z.string().optional().default(""),
  milestones: z.array(
    z.object({
      title: z.string().min(1),
      description: z.string().optional().nullable().default(""),
      targetDate: modelDateZ,
      // Models sometimes omit `tasks` entirely for a milestone.
      tasks: z
        .array(
          z.object({
            title: z.string().min(1),
            description: z.string().optional().nullable(),
            // Coerced, not rejected: one invented category (`LANGUAGE`,
            // `SELF-REFLECTION`) used to discard the entire plan.
            category: modelCategoryZ,
            priority: modelPriorityZ,
            durationMin: modelDurationZ,
            rrule: modelRRuleZ,
          }),
        )
        .optional()
        .default([]),
    }),
  ).default([]),
});

export type GoalPlan = z.infer<typeof planZ>;

export async function planGoal(args: {
  title: string;
  description?: string;
  targetDate?: string | null;
  timezone: string;
}): Promise<GoalPlan> {
  const now = new Date().toLocaleString("sv-SE", { timeZone: args.timezone }).replace(" ", "T");
  const raw = await ollamaChat({
    system: GOAL_PLANNER_SYSTEM,
    prompt: goalPlannerPrompt({ ...args, now, tz: args.timezone }),
    format: "json",
    temperature: 0.3,
  });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) {
      console.warn("[planner] model returned no JSON object. Raw:", raw.slice(0, 400));
      return { rationale: "Could not generate plan.", milestones: [] };
    }
    try {
      json = JSON.parse(m[0]);
    } catch {
      console.warn("[planner] embedded JSON did not parse. Raw:", raw.slice(0, 400));
      return { rationale: "Could not generate plan.", milestones: [] };
    }
  }

  // Models wrap the plan in a container key surprisingly often.
  if (json && typeof json === "object" && !("milestones" in json)) {
    for (const key of ["plan", "goal", "result", "data"]) {
      const inner = (json as Record<string, unknown>)[key];
      if (inner && typeof inner === "object" && "milestones" in inner) {
        json = inner;
        break;
      }
    }
  }

  const safe = planZ.safeParse(json);
  if (!safe.success) {
    // Silence here was its own bug: a schema mismatch looked identical to
    // "the model had nothing to say", with nothing in the logs either way.
    console.warn(
      "[planner] plan failed schema validation:",
      JSON.stringify(safe.error.flatten().fieldErrors).slice(0, 400),
      "\n  raw:", raw.slice(0, 400),
    );
    return { rationale: "Could not generate plan.", milestones: [] };
  }

  // Drop milestones the model left empty rather than persisting blanks.
  const milestones = safe.data.milestones.filter((m) => m.title.trim().length > 0);
  if (!milestones.length) {
    console.warn("[planner] model produced zero usable milestones. Raw:", raw.slice(0, 400));
  }
  return { ...safe.data, milestones };
}
