import { z } from "zod";
import { modelCategoryZ, modelDateZ, modelDurationZ, modelPriorityZ, modelRRuleZ } from "@/lib/ai/schema";

export const priorityZ = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const statusZ = z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED", "SNOOZED"]);
export const categoryZ = z.enum([
  "WORK", "PERSONAL", "HEALTH", "LEARNING",
  "FINANCE", "SOCIAL", "HOME", "OTHER",
]);

export const taskInputZ = z.object({
  title: z.string().min(1).max(280),
  description: z.string().optional(),
  status: statusZ.optional(),
  priority: priorityZ.optional(),
  category: categoryZ.optional(),
  dueAt: z.string().datetime().optional().nullable(),
  startAt: z.string().datetime().optional().nullable(),
  durationMin: z.number().int().positive().optional().nullable(),
  remindAt: z.string().datetime().optional().nullable(),
  rrule: z.string().optional().nullable(),
  goalId: z.string().optional().nullable(),
  milestoneId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
});

export type TaskInput = z.infer<typeof taskInputZ>;

export const calendarEventInputZ = z.object({
  title: z.string().min(1).max(280),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  allDay: z.boolean().optional(),
});

export type CalendarEventInput = z.infer<typeof calendarEventInputZ>;

/**
 * E.164, the only format Twilio accepts: a leading `+`, country code, up to 15
 * digits. Deliberately strict — a number saved without its country code fails
 * silently at dial time, two minutes before a meeting, which is the worst
 * possible moment to discover it.
 */
export const phoneZ = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter a number in international format, e.g. +14155552671");

export const goalInputZ = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: categoryZ.optional(),
  targetDate: z.string().datetime().optional().nullable(),
});

export const noteInputZ = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
  tags: z.array(z.string()).optional(),
});

export const chatMessageZ = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1).max(4000),
});

// AI extraction result — what the model returns.
//
// Note the schemas: `modelCategoryZ` and friends *coerce* instead of rejecting.
// The strict `categoryZ` / `priorityZ` above stay in force for the HTTP API,
// where a bad value is a client bug worth a 400. Here a bad value is just a
// small model being a small model, and rejecting the whole object threw away a
// usable extraction — see lib/ai/schema.ts.
export const extractedTaskZ = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  category: modelCategoryZ,
  priority: modelPriorityZ,
  dueAt: modelDateZ,
  durationMin: modelDurationZ,
  rrule: modelRRuleZ,
  needsClarification: z.boolean().optional(),
  clarificationQuestion: z.string().optional().nullable(),
});

/**
 * What an UPDATE/DELETE/COMPLETE refers to.
 *
 * The model never guesses an id — it can't know them. It describes the thing in
 * the user's own words and the server resolves it (see lib/server/resolve.ts).
 * That split matters: resolution needs the database, and a hallucinated id would
 * silently mutate the wrong row.
 */
export const intentTargetZ = z.object({
  kind: z.enum(["task", "note", "goal"]).optional().default("task"),
  /** "the previous note", "the last one" → most recently touched of that kind. */
  ref: z.enum(["last", "previous"]).nullable().optional().default(null),
  /** Words that identify it: "the gym one" → "gym". */
  query: z.string().optional().nullable().default(null),
});

/** Fields an UPDATE may change. Everything is optional; absent means untouched. */
export const intentPatchZ = z.object({
  title: z.string().min(1).optional().nullable(),
  description: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  category: modelCategoryZ.optional(),
  priority: modelPriorityZ.optional(),
  dueAt: modelDateZ.optional(),
  durationMin: modelDurationZ.optional(),
  rrule: modelRRuleZ.optional(),
  status: statusZ.optional().nullable(),
  /** Text replacement: "it should say X not Y". */
  replace: z.object({ from: z.string().min(1), to: z.string() }).optional().nullable(),
});

export const extractedIntentZ = z.object({
  intent: z.enum([
    "CREATE_TASK", "CREATE_TASKS", "CREATE_GOAL", "CREATE_NOTE",
    // Acting on something that already exists.
    "UPDATE", "DELETE", "COMPLETE",
    "QUERY", "CHITCHAT", "UNKNOWN",
  ]),
  target: intentTargetZ.optional().nullable(),
  patch: intentPatchZ.optional().nullable(),
  tasks: z.array(extractedTaskZ).optional(),
  goal: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    category: modelCategoryZ,
    targetDate: modelDateZ,
  }).optional().nullable(),
  note: z.object({
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()).optional(),
  }).optional().nullable(),
  reply: z.string().optional(),
});

export type ExtractedIntent = z.infer<typeof extractedIntentZ>;
