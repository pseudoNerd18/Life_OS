/**
 * The demo corpus — every string the seed puts in the database.
 *
 * Kept apart from `seed.ts` so the orchestration (date maths, cleanup,
 * insert order) stays readable and this file stays a plain content list.
 *
 * Persona: a CS undergrad in Bengaluru who also interns part-time — GATE prep,
 * a half marathon block, a side project, and the usual bills and family. The
 * point is a database that reads like eight weeks of daily use rather than a
 * handful of placeholder rows.
 *
 * Every title here doubles as a cleanup key: `seed.ts` deletes exactly the
 * titles it knows about, so a re-run replaces the demo data without touching
 * anything the user created themselves.
 */

export type Cat =
  | "WORK" | "PERSONAL" | "HEALTH" | "LEARNING"
  | "FINANCE" | "SOCIAL" | "HOME" | "OTHER";
export type Prio = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type Src = "MANUAL" | "CHAT" | "VOICE" | "GOAL_PLAN" | "CALENDAR_SYNC" | "BRIEFING";

export interface PoolTask {
  title: string;
  category: Cat;
  priority?: Prio;
  durationMin?: number;
  description?: string;
  /** Preferred completion hour in the user's zone. */
  hour?: number;
}

// ─────────────────────────────────────────────────────────────
// HISTORY POOL — one-off work that got done over the past weeks.
// Drawn from without replacement, so titles rarely repeat.
// ─────────────────────────────────────────────────────────────

export const HISTORY_POOL: PoolTask[] = [
  // WORK
  { title: "Rewrite the onboarding empty states", category: "WORK", priority: "MEDIUM", durationMin: 90, hour: 15 },
  { title: "Review Aditya's PR on the auth guard", category: "WORK", priority: "HIGH", durationMin: 40, hour: 11 },
  { title: "Fix the flaky calendar sync test", category: "WORK", priority: "HIGH", durationMin: 75, hour: 16 },
  { title: "Write the RFC for two-way task sync", category: "WORK", priority: "HIGH", durationMin: 120, hour: 14 },
  { title: "Migrate the notes editor to BlockNote 0.54", category: "WORK", priority: "MEDIUM", durationMin: 150, hour: 15 },
  { title: "Add rate limiting to the chat endpoint", category: "WORK", priority: "HIGH", durationMin: 60, hour: 12 },
  { title: "Clean up the dead integrations routes", category: "WORK", priority: "LOW", durationMin: 45, hour: 18 },
  { title: "Draft sprint goals for next week", category: "WORK", priority: "MEDIUM", durationMin: 30, hour: 17 },
  { title: "Pair with Priya on the sync reconciler", category: "WORK", priority: "MEDIUM", durationMin: 60, hour: 15 },
  { title: "Reply to the design feedback thread", category: "WORK", priority: "MEDIUM", durationMin: 20, hour: 10 },
  { title: "Profile the dashboard's first paint", category: "WORK", priority: "MEDIUM", durationMin: 90, hour: 16 },
  { title: "Set up the Playwright smoke run in CI", category: "WORK", priority: "MEDIUM", durationMin: 110, hour: 14 },
  { title: "Write release notes for v0.2", category: "WORK", priority: "LOW", durationMin: 35, hour: 18 },
  { title: "Update the README setup section", category: "WORK", priority: "LOW", durationMin: 25, hour: 19 },
  { title: "Triage the bug inbox", category: "WORK", priority: "MEDIUM", durationMin: 45, hour: 10 },
  { title: "Fix the timezone bug in daily briefings", category: "WORK", priority: "URGENT", durationMin: 80, hour: 13 },
  { title: "Add an index on Task(userId, dueAt)", category: "WORK", priority: "MEDIUM", durationMin: 30, hour: 12 },
  { title: "Split the settings page into tabs", category: "WORK", priority: "LOW", durationMin: 70, hour: 16 },
  { title: "Debug the BlockNote hydration warning", category: "WORK", priority: "HIGH", durationMin: 95, hour: 15 },
  { title: "Write the incident note for Friday's outage", category: "WORK", priority: "HIGH", durationMin: 40, hour: 11 },

  // LEARNING
  { title: "Finish the graph algorithms chapter", category: "LEARNING", priority: "HIGH", durationMin: 120, hour: 21 },
  { title: "20 DP problems from the GATE workbook", category: "LEARNING", priority: "HIGH", durationMin: 150, hour: 20 },
  { title: "Watch the MIT lecture on paging", category: "LEARNING", priority: "MEDIUM", durationMin: 55, hour: 22 },
  { title: "Notes on B+ trees vs LSM trees", category: "LEARNING", priority: "MEDIUM", durationMin: 60, hour: 21 },
  { title: "Solve last year's GATE networks section", category: "LEARNING", priority: "HIGH", durationMin: 90, hour: 20 },
  { title: "Read DDIA chapter 7 — transactions", category: "LEARNING", priority: "MEDIUM", durationMin: 75, hour: 22 },
  { title: "Revise TCP congestion control", category: "LEARNING", priority: "MEDIUM", durationMin: 50, hour: 21 },
  { title: "Implement a trie from scratch", category: "LEARNING", priority: "MEDIUM", durationMin: 65, hour: 20 },
  { title: "Work through the deadlock problem set", category: "LEARNING", priority: "HIGH", durationMin: 100, hour: 21 },
  { title: "Summarise the attention paper in my own words", category: "LEARNING", priority: "MEDIUM", durationMin: 80, hour: 22 },
  { title: "Practice 3 SQL window-function problems", category: "LEARNING", priority: "LOW", durationMin: 40, hour: 21 },
  { title: "Finish the compilers parsing assignment", category: "LEARNING", priority: "HIGH", durationMin: 130, hour: 19 },
  { title: "Rewrite my quicksort notes with proofs", category: "LEARNING", priority: "LOW", durationMin: 45, hour: 22 },
  { title: "Read up on pgvector index tradeoffs", category: "LEARNING", priority: "MEDIUM", durationMin: 55, hour: 21 },
  { title: "Take the OS mock quiz", category: "LEARNING", priority: "HIGH", durationMin: 60, hour: 20 },

  // HEALTH
  { title: "Long run — 14k along the lake", category: "HEALTH", priority: "MEDIUM", durationMin: 95, hour: 6 },
  { title: "Leg day at the gym", category: "HEALTH", priority: "MEDIUM", durationMin: 70, hour: 19 },
  { title: "Book the annual blood test", category: "HEALTH", priority: "MEDIUM", durationMin: 10, hour: 11 },
  { title: "Physio exercises for the left knee", category: "HEALTH", priority: "HIGH", durationMin: 25, hour: 7 },
  { title: "Swim 1km", category: "HEALTH", priority: "LOW", durationMin: 50, hour: 7 },
  { title: "Meal prep for the week", category: "HEALTH", priority: "MEDIUM", durationMin: 80, hour: 17 },
  { title: "Track macros for the day", category: "HEALTH", priority: "LOW", durationMin: 10, hour: 22 },
  { title: "Interval session — 6 x 800m", category: "HEALTH", priority: "MEDIUM", durationMin: 55, hour: 6 },
  { title: "Refill the protein and creatine", category: "HEALTH", priority: "LOW", durationMin: 15, hour: 20 },
  { title: "No screens after 11pm — night 1", category: "HEALTH", priority: "LOW", hour: 23 },

  // FINANCE
  { title: "Pay the electricity bill", category: "FINANCE", priority: "HIGH", durationMin: 10, hour: 20 },
  { title: "Pay the broadband bill", category: "FINANCE", priority: "MEDIUM", durationMin: 10, hour: 20 },
  { title: "Move ₹15,000 into the emergency fund", category: "FINANCE", priority: "HIGH", durationMin: 15, hour: 21 },
  { title: "Reconcile August expenses", category: "FINANCE", priority: "MEDIUM", durationMin: 45, hour: 21 },
  { title: "File the rent receipts for HRA", category: "FINANCE", priority: "MEDIUM", durationMin: 30, hour: 19 },
  { title: "Review the SIP allocation", category: "FINANCE", priority: "LOW", durationMin: 35, hour: 21 },
  { title: "Cancel the unused design subscription", category: "FINANCE", priority: "LOW", durationMin: 10, hour: 18 },
  { title: "Submit the internship invoice", category: "FINANCE", priority: "HIGH", durationMin: 20, hour: 12 },

  // HOME
  { title: "Fix the leaking kitchen tap", category: "HOME", priority: "MEDIUM", durationMin: 40, hour: 18 },
  { title: "Get the geyser serviced", category: "HOME", priority: "LOW", durationMin: 60, hour: 11 },
  { title: "Replace the bedroom bulb", category: "HOME", priority: "LOW", durationMin: 10, hour: 20 },
  { title: "Deep clean the desk and cable mess", category: "HOME", priority: "LOW", durationMin: 50, hour: 17 },
  { title: "Sort out the laundry pile", category: "HOME", priority: "LOW", durationMin: 30, hour: 21 },
  { title: "Water the balcony plants", category: "HOME", priority: "LOW", durationMin: 10, hour: 8 },
  { title: "Order a new desk lamp", category: "HOME", priority: "LOW", durationMin: 15, hour: 22 },

  // SOCIAL
  { title: "Call Mom", category: "SOCIAL", priority: "MEDIUM", durationMin: 30, hour: 20 },
  { title: "Call Dadi for her birthday", category: "SOCIAL", priority: "HIGH", durationMin: 20, hour: 19 },
  { title: "Dinner with Ananjan and Saksham", category: "SOCIAL", priority: "MEDIUM", durationMin: 120, hour: 20 },
  { title: "Reply to Ishita's message about the trip", category: "SOCIAL", priority: "LOW", durationMin: 10, hour: 22 },
  { title: "Send Rohan the wedding gift", category: "SOCIAL", priority: "MEDIUM", durationMin: 25, hour: 19 },
  { title: "Coffee catch-up with Priya", category: "SOCIAL", priority: "LOW", durationMin: 60, hour: 17 },

  // PERSONAL
  { title: "Renew the passport appointment", category: "PERSONAL", priority: "HIGH", durationMin: 30, hour: 11 },
  { title: "Back up the laptop to the external drive", category: "PERSONAL", priority: "MEDIUM", durationMin: 40, hour: 22 },
  { title: "Update the résumé with the internship", category: "PERSONAL", priority: "MEDIUM", durationMin: 55, hour: 20 },
  { title: "Clear the photo library", category: "PERSONAL", priority: "LOW", durationMin: 45, hour: 22 },
  { title: "Write the weekly journal entry", category: "PERSONAL", priority: "LOW", durationMin: 20, hour: 23 },
  { title: "Cancel the unused domain renewal", category: "PERSONAL", priority: "LOW", durationMin: 10, hour: 21 },
  { title: "Plan the Goa trip dates with the group", category: "PERSONAL", priority: "MEDIUM", durationMin: 35, hour: 21 },
  { title: "Read 30 pages of the current book", category: "PERSONAL", priority: "LOW", durationMin: 35, hour: 23 },
  { title: "Sort the Downloads folder", category: "PERSONAL", priority: "LOW", durationMin: 20, hour: 22 },
  { title: "Book the dentist follow-up", category: "PERSONAL", priority: "MEDIUM", durationMin: 10, hour: 12 },
];

/**
 * Chores that genuinely repeat every few weeks. Reused across the history
 * window with a minimum gap, which is what makes the log look lived-in
 * rather than like a list that was written once.
 */
export const CHORE_POOL: PoolTask[] = [
  { title: "Weekly grocery run", category: "HOME", priority: "MEDIUM", durationMin: 60, hour: 18 },
  { title: "Clear the email inbox to zero", category: "WORK", priority: "LOW", durationMin: 30, hour: 10 },
  { title: "Review the week's spending", category: "FINANCE", priority: "LOW", durationMin: 20, hour: 21 },
  { title: "Tidy the notes backlog", category: "PERSONAL", priority: "LOW", durationMin: 25, hour: 22 },
  { title: "Charge and sync the running watch", category: "HEALTH", priority: "LOW", durationMin: 10, hour: 7 },
  { title: "Refill the water filter cartridge", category: "HOME", priority: "LOW", durationMin: 15, hour: 19 },
];

// ─────────────────────────────────────────────────────────────
// HABITS — recurring parents. Past occurrences are materialised as
// recurrence children so the streak is visible in the history.
// ─────────────────────────────────────────────────────────────

export interface Habit {
  title: string;
  category: Cat;
  priority: Prio;
  rrule: string;
  /** Weekdays the habit lands on, 0 = Sunday. */
  days: number[];
  hour: number;
  minute?: number;
  durationMin?: number;
  /** Rough share of occurrences actually ticked off — nobody is perfect. */
  hitRate: number;
  source: Src;
}

export const HABITS: Habit[] = [
  {
    title: "Morning run — 5k", category: "HEALTH", priority: "MEDIUM",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", days: [1, 3, 5], hour: 6, minute: 15,
    durationMin: 40, hitRate: 0.82, source: "VOICE",
  },
  {
    title: "DSA practice — 2 problems", category: "LEARNING", priority: "HIGH",
    rrule: "FREQ=DAILY", days: [0, 1, 2, 3, 4, 5, 6], hour: 21,
    durationMin: 60, hitRate: 0.74, source: "CHAT",
  },
  {
    title: "Standup notes", category: "WORK", priority: "LOW",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", days: [1, 2, 3, 4, 5], hour: 9, minute: 45,
    durationMin: 10, hitRate: 0.93, source: "MANUAL",
  },
  {
    title: "Take vitamin D3", category: "HEALTH", priority: "LOW",
    rrule: "FREQ=WEEKLY;BYDAY=SU", days: [0], hour: 9,
    hitRate: 0.88, source: "CHAT",
  },
  {
    title: "Weekly review", category: "PERSONAL", priority: "MEDIUM",
    rrule: "FREQ=WEEKLY;BYDAY=SU", days: [0], hour: 20,
    durationMin: 45, hitRate: 0.86, source: "MANUAL",
  },
];

// ─────────────────────────────────────────────────────────────
// TODAY — the set the dashboard opens on. Deliberately mixed:
// something late, something in flight, something already ticked.
// ─────────────────────────────────────────────────────────────

export interface DatedTask extends PoolTask {
  /** Days from today; negative is overdue. */
  day: number;
  status?: "TODO" | "IN_PROGRESS" | "DONE" | "SNOOZED";
  source?: Src;
  rrule?: string;
  /** Hours before `dueAt` that the reminder fires. */
  remindBeforeH?: number;
}

export const OVERDUE_TASKS: DatedTask[] = [
  {
    title: "Renew the health insurance policy", category: "FINANCE", priority: "URGENT",
    day: -4, hour: 18, durationMin: 30, source: "MANUAL",
    description: "Policy lapses on the 5th. Portal keeps timing out — try the app instead.",
  },
  {
    title: "Send the internship timesheet to HR", category: "WORK", priority: "HIGH",
    day: -2, hour: 17, durationMin: 20, source: "CHAT",
  },
  {
    title: "Book the GATE mock test slot", category: "LEARNING", priority: "HIGH",
    day: -1, hour: 21, durationMin: 15, source: "VOICE",
  },
];

export const TODAY_TASKS: DatedTask[] = [
  {
    title: "Finish the sync conflict write-up", category: "WORK", priority: "HIGH",
    day: 0, hour: 14, durationMin: 90, status: "IN_PROGRESS", source: "CHAT",
    description: "Cover the three cases: local-newer, remote-newer, and both-changed.",
    remindBeforeH: 1,
  },
  {
    title: "Review the pull request queue", category: "WORK", priority: "MEDIUM",
    day: 0, hour: 11, durationMin: 45, status: "DONE", source: "MANUAL",
  },
  {
    title: "Physio — knee routine", category: "HEALTH", priority: "MEDIUM",
    day: 0, hour: 7, durationMin: 25, status: "DONE", source: "VOICE",
  },
  {
    title: "Two GATE OS problem sets", category: "LEARNING", priority: "HIGH",
    day: 0, hour: 21, durationMin: 90, source: "MANUAL",
  },
  {
    title: "Call Mom", category: "SOCIAL", priority: "MEDIUM",
    day: 0, hour: 20, durationMin: 30, source: "MANUAL",
  },
  {
    title: "Pay the mobile recharge", category: "FINANCE", priority: "MEDIUM",
    day: 0, hour: 19, durationMin: 10, source: "CHAT",
  },
  {
    title: "Pick up the dry cleaning", category: "HOME", priority: "LOW",
    day: 0, hour: 18, durationMin: 20, status: "SNOOZED", source: "MANUAL",
  },
];

export const UPCOMING_TASKS: DatedTask[] = [
  { title: "Sprint demo dry run", category: "WORK", priority: "HIGH", day: 1, hour: 15, durationMin: 60, source: "MANUAL", remindBeforeH: 2 },
  { title: "Long run — 16k", category: "HEALTH", priority: "MEDIUM", day: 2, hour: 6, durationMin: 110, source: "GOAL_PLAN" },
  { title: "Submit the compilers assignment", category: "LEARNING", priority: "URGENT", day: 2, hour: 23, durationMin: 120, source: "MANUAL", remindBeforeH: 4 },
  { title: "Dentist appointment", category: "HEALTH", priority: "MEDIUM", day: 3, hour: 11, durationMin: 60, source: "MANUAL" },
  { title: "Pay the credit card bill", category: "FINANCE", priority: "HIGH", day: 3, hour: 20, durationMin: 10, source: "BRIEFING" },
  { title: "Write the retro notes", category: "WORK", priority: "MEDIUM", day: 4, hour: 17, durationMin: 30, source: "MANUAL" },
  { title: "GATE full-length mock 1", category: "LEARNING", priority: "HIGH", day: 5, hour: 9, durationMin: 180, source: "MANUAL", remindBeforeH: 12 },
  { title: "Grocery run", category: "HOME", priority: "MEDIUM", day: 6, hour: 18, durationMin: 60, source: "VOICE" },
  { title: "Mom's birthday — book the restaurant", category: "SOCIAL", priority: "HIGH", day: 6, hour: 12, durationMin: 20, source: "CHAT", remindBeforeH: 24 },
  { title: "Move ₹15,000 into the emergency fund", category: "FINANCE", priority: "HIGH", day: 8, hour: 21, durationMin: 15, source: "MANUAL" },
  { title: "Quarterly self-review draft", category: "WORK", priority: "MEDIUM", day: 9, hour: 16, durationMin: 90, source: "MANUAL" },
  { title: "Renew the gym membership", category: "HEALTH", priority: "MEDIUM", day: 11, hour: 19, durationMin: 15, source: "MANUAL" },
  { title: "File the quarterly advance tax", category: "FINANCE", priority: "URGENT", day: 12, hour: 20, durationMin: 60, source: "MANUAL", remindBeforeH: 48 },
  { title: "Book train tickets for Diwali", category: "PERSONAL", priority: "HIGH", day: 14, hour: 10, durationMin: 30, source: "CHAT" },
  { title: "GATE full-length mock 2", category: "LEARNING", priority: "HIGH", day: 19, hour: 9, durationMin: 180, source: "MANUAL" },
];

/** No due date — the backlog you keep meaning to get to. */
export const BACKLOG_TASKS: PoolTask[] = [
  { title: "Set up a proper backup routine", category: "PERSONAL", priority: "LOW" },
  { title: "Learn enough Blender to model a keycap", category: "LEARNING", priority: "LOW" },
  { title: "Sell the old monitor", category: "HOME", priority: "LOW" },
  { title: "Write the blog post on pgvector", category: "WORK", priority: "MEDIUM" },
];

/** A parent with subtasks — the hierarchy the schema supports. */
export const SUBTASK_TREE = {
  parent: {
    title: "Ship the notes editor rewrite", category: "WORK" as Cat, priority: "HIGH" as Prio,
    day: 4, hour: 18, durationMin: 240,
    description: "Cutover plan: ship behind a flag, migrate old HTML lazily, drop the old editor next sprint.",
  },
  children: [
    { title: "Migrate stored HTML to BlockNote blocks", done: true, durationMin: 120 },
    { title: "Port the slash-command menu", done: true, durationMin: 90 },
    { title: "Image upload via the notes/images route", done: false, durationMin: 75 },
    { title: "Keyboard shortcut parity pass", done: false, durationMin: 60 },
    { title: "Delete the old editor component", done: false, durationMin: 20 },
  ],
};

// ─────────────────────────────────────────────────────────────
// GOALS — progress is derived from the done/total ratio of the
// milestone tasks below, so the list page and detail page agree.
// ─────────────────────────────────────────────────────────────

export interface SeedGoal {
  title: string;
  description: string;
  category: Cat;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ABANDONED";
  startDay: number;
  targetDay: number;
  planRationale?: string;
  planVersion?: number;
  milestones: Array<{
    title: string;
    description?: string;
    status: "PENDING" | "ACTIVE" | "COMPLETED";
    targetDay: number;
    completedDay?: number;
    tasks: Array<{ title: string; done: boolean; durationMin?: number; priority?: Prio }>;
  }>;
}

export const GOALS: SeedGoal[] = [
  {
    title: "Run a sub-2:00 half marathon",
    description: "Twelve-week block for the December half. Base first, speed last, no more than 10% weekly volume jumps.",
    category: "HEALTH", status: "ACTIVE", startDay: -42, targetDay: 96,
    planVersion: 2,
    planRationale:
      "The knee flared up last time from adding speed too early, so the first six weeks are easy "
      + "volume only. Long runs grow 2k a fortnight and cap at 18k — race day adrenaline covers the rest.",
    milestones: [
      {
        title: "Base building — 30km weeks", status: "COMPLETED", targetDay: -7, completedDay: -9,
        tasks: [
          { title: "Four weeks of easy mileage", done: true, durationMin: 600 },
          { title: "Get fitted for proper shoes", done: true, durationMin: 60 },
          { title: "Build to a 12k long run", done: true, durationMin: 90 },
        ],
      },
      {
        title: "Long runs to 18k", status: "ACTIVE", targetDay: 42,
        tasks: [
          { title: "14k long run", done: true, durationMin: 100 },
          { title: "16k long run", done: false, durationMin: 115 },
          { title: "18k long run", done: false, durationMin: 130 },
          { title: "Weekly strength session", done: false, durationMin: 45 },
        ],
      },
      {
        title: "Race-pace intervals + taper", status: "PENDING", targetDay: 90,
        tasks: [
          { title: "Threshold sessions — 4 weeks", done: false, durationMin: 240 },
          { title: "Race simulation — 18k at target pace", done: false, durationMin: 130 },
          { title: "Two-week taper", done: false },
        ],
      },
    ],
  },
  {
    title: "Get Life OS in front of 100 users",
    description: "Ship the parts that are half-done, then actually tell people about it.",
    category: "WORK", status: "ACTIVE", startDay: -35, targetDay: 60,
    planRationale:
      "Nothing here is a research problem — it is all finishing work. Ordered by what blocks a "
      + "stranger from getting value in the first five minutes.",
    milestones: [
      {
        title: "Auth + calendar sync", status: "COMPLETED", targetDay: -12, completedDay: -13,
        tasks: [
          { title: "Email/password and Google sign-in", done: true, durationMin: 300 },
          { title: "Two-way Google Calendar sync", done: true, durationMin: 480, priority: "HIGH" },
          { title: "Handle the no-refresh-token grant", done: true, durationMin: 120 },
        ],
      },
      {
        title: "Notes editor + images", status: "ACTIVE", targetDay: 18,
        tasks: [
          { title: "BlockNote rewrite", done: true, durationMin: 420 },
          { title: "Paste and drop image upload", done: false, durationMin: 150 },
          { title: "Backlinks in the editor UI", done: false, durationMin: 180 },
        ],
      },
      {
        title: "Launch", status: "PENDING", targetDay: 55,
        tasks: [
          { title: "Record a 90-second demo", done: false, durationMin: 180 },
          { title: "Write the launch post", done: false, durationMin: 120 },
          { title: "Post on Peerlist and HN", done: false, durationMin: 30 },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// NOTES — BlockNote stores HTML, so the content is HTML.
// ─────────────────────────────────────────────────────────────

export interface SeedNote {
  title: string;
  content: string;
  excerpt?: string;
  tags: string[];
  pinned?: boolean;
  /** Days ago the note was created / last edited. */
  createdDay: number;
  updatedDay: number;
  /** Titles of notes this one links out to. */
  links?: string[];
}

export const NOTES: SeedNote[] = [
  {
    title: "Weekly review — this week",
    pinned: true, tags: ["review", "weekly"], createdDay: -2, updatedDay: 0,
    excerpt: "Sync write-up slipped again; mornings are the only reliable study slot.",
    links: ["Sync conflict resolution — the three cases", "Half marathon — 12 week block"],
    content: `<h2>What moved</h2>
<ul><li>Notes editor rewrite is behind a flag and working — two subtasks left.</li>
<li>OS concurrency section finished, two days ahead of the milestone date.</li>
<li>14k long run done at 5:42/km, knee quiet the whole way.</li></ul>
<h2>What didn't</h2>
<ul><li>Sync conflict write-up has slipped three days running. It keeps losing to whatever is loudest.</li>
<li>Skipped Wednesday's run because standup ran to 10:30.</li></ul>
<h2>Pattern I keep ignoring</h2>
<p>Every week the study block survives when it is <strong>before</strong> work and dies when it is after. Stop scheduling DSA at 9pm.</p>
<h2>Next week</h2>
<ul><li>Move the DSA block to 6:45am, three days a week.</li>
<li>Write-up gets the first hour of Monday, before the inbox.</li>
<li>16k long run on Saturday, not Sunday — Sunday is family lunch.</li></ul>`,
  },
  {
    title: "Sync conflict resolution — the three cases",
    tags: ["work", "architecture", "sync"], createdDay: -9, updatedDay: -1,
    excerpt: "syncedAt is the agreement point; compare both sides against it, not against each other.",
    links: ["Life OS v2 — architecture decisions"],
    content: `<p>The whole thing hinges on one field: <code>syncedAt</code> is the last moment local and remote <em>agreed</em>. Every decision compares each side against that, never against the other side.</p>
<h2>Local newer, remote unchanged</h2>
<p><code>local.updatedAt &gt; syncedAt</code> and <code>remote.updated &lt;= syncedAt</code>. Push local, set <code>syncedAt = now</code>. No ambiguity.</p>
<h2>Remote newer, local unchanged</h2>
<p>Mirror image. Pull remote over local. This is the common case for events created on a phone.</p>
<h2>Both changed</h2>
<p>This is the only interesting one. Options considered:</p>
<ul><li><strong>Last write wins</strong> — trivial, and silently eats work. Rejected.</li>
<li><strong>Field-level merge</strong> — correct in theory, needs per-field timestamps we don't have.</li>
<li><strong>Remote wins, local kept as a note</strong> — what we shipped. The calendar is the source of truth for time, and nothing is lost.</li></ul>
<p>Edge case worth a test: <code>syncedAt</code> null means never synced. A first-time mirror must not be read as "both changed".</p>`,
  },
  {
    title: "Half marathon — 12 week block",
    tags: ["running", "health", "plan"], createdDay: -44, updatedDay: -3,
    excerpt: "Base six weeks, long runs to 18k, speed last. Knee rules non-negotiable.",
    content: `<h2>Shape of the block</h2>
<table><tbody>
<tr><td>Weeks 1–6</td><td>Easy volume only, 30 → 42km/week</td></tr>
<tr><td>Weeks 7–10</td><td>Long runs 14 → 18k, one threshold session</td></tr>
<tr><td>Weeks 11–12</td><td>Taper, race simulation at target pace</td></tr>
</tbody></table>
<h2>Target</h2>
<p>Sub-2:00 means <strong>5:41/km</strong>. Current easy pace is 6:10, threshold around 5:20 — the fitness is there, the endurance isn't yet.</p>
<h2>Knee rules</h2>
<ul><li>Physio routine before every run. Not optional, this is what went wrong in March.</li>
<li>Any twinge that persists past 2km — walk home, no negotiation.</li>
<li>Volume increases capped at 10% a week even when it feels easy.</li></ul>
<h2>Log</h2>
<ul><li>Week 7: 14k at 5:52. Felt controlled, could have held it another 3k.</li>
<li>Week 6: 12k at 6:02. Hot morning, heart rate drifted 8 bpm in the last third.</li></ul>`,
  },
  {
    title: "Life OS v2 — architecture decisions",
    tags: ["work", "architecture"], createdDay: -56, updatedDay: -7,
    excerpt: "Why Postgres+pgvector, why local models, and the two decisions already regretted.",
    links: ["Sync conflict resolution — the three cases"],
    content: `<h2>Postgres + pgvector over a dedicated vector DB</h2>
<p>One database to operate, transactional writes alongside the embeddings, and at this scale the recall difference is noise. Revisit past a few million rows.</p>
<h2>Local models via Ollama</h2>
<p>The entire point is that a life log doesn't leave the machine. It also means the app has to degrade gracefully when the model isn't running — hence deterministic fallbacks on every AI path.</p>
<h2>Server components read, client stores poll</h2>
<p>First paint comes from the server with real data; the client store takes over for interaction. The trap is the two drifting apart, which is why the query shapes live in <code>lib/queries.ts</code> and both sides import them.</p>
<h2>Decisions I already regret</h2>
<ul><li><strong>HTML for note content.</strong> Convenient with BlockNote, awkward to query. Blocks-as-JSON would have been the better call.</li>
<li><strong>Tasks and calendar events as separate models.</strong> They overlap enough that every sync path handles both. One model with a discriminator would have been less code.</li></ul>`,
  },
];

/** `from` links to `to` — both by title. */
export const NOTE_LINKS: Array<[string, string]> = [
  ["Weekly review — this week", "Sync conflict resolution — the three cases"],
  ["Weekly review — this week", "Half marathon — 12 week block"],
  ["Sync conflict resolution — the three cases", "Life OS v2 — architecture decisions"],
  ["Life OS v2 — architecture decisions", "Sync conflict resolution — the three cases"],
];
// ─────────────────────────────────────────────────────────────
// CALENDAR — a handful of one-offs at uneven intervals.
// Created as local events (no account), so they need no OAuth
// and never collide with a real synced calendar.
// ─────────────────────────────────────────────────────────────

export interface WeeklyEvent {
  title: string;
  /** 0 = Sunday. */
  weekday: number;
  hour: number;
  minute?: number;
  durationMin: number;
  location?: string;
  attendees?: string[];
  description?: string;
  rrule: string;
}

/**
 * Deliberately empty. A repeating working week filled every weekday of the
 * visible calendar and read as filler rather than as someone's real schedule,
 * so the demo now ships one-offs only. `seed.ts` still expands this array, so
 * adding an entry back is all it takes to get the recurring set again.
 */
export const WEEKLY_EVENTS: WeeklyEvent[] = [];

export interface OneOffEvent {
  title: string;
  day: number;
  /**
   * Only makes sense on a working day. The offsets here are relative to
   * whenever the seed runs, so without this a Friday run puts the offsite on a
   * Sunday — the seed nudges these to the nearest weekday instead.
   */
  workday?: boolean;
  /** Swallows the working day: the recurring meetings on it are skipped. */
  blocksWorkday?: boolean;
  hour?: number;
  minute?: number;
  durationMin?: number;
  allDay?: boolean;
  /** All-day events spanning more than one day. */
  days?: number;
  location?: string;
  attendees?: string[];
  description?: string;
}

export const ONE_OFF_EVENTS: OneOffEvent[] = [
  { title: "Blood test — fasting", workday: true, day: -6, hour: 8, durationMin: 45, location: "Apollo, Indiranagar", description: "Nothing to eat after 10pm the night before." },
  { title: "Sprint demo", workday: true, day: 1, hour: 15, minute: 30, durationMin: 45, location: "Meet", attendees: ["priya@example.com", "meera@example.com"], description: "Owning the notes editor section." },
  { title: "Ananjan visiting", day: 12, allDay: true, days: 3, location: "Home" },
];

// ─────────────────────────────────────────────────────────────
// RETIRED — titles earlier versions of this seed used to write.
//
// Cleanup in `seed.ts` deletes by title, so anything dropped from the lists
// above would otherwise survive a re-seed as an orphan: the old row stays in
// the database because nothing still names it. These are the titles the demo
// shrank away from (20 notes → 4, 7 goals → 3, a repeating working week and
// 16 one-offs → 3), kept only so a re-run can remove them.
//
// Safe to delete an entry once every database that ran an older seed has been
// re-seeded at least once.
// ─────────────────────────────────────────────────────────────

export const RETIRED_GOAL_TITLES = [
  "Crack GATE CS 2027",
  "Read 12 books this year",
  "Build a ₹1,50,000 emergency fund",
  "Touch type at 80 wpm",
  "Conversational Spanish",
];

export const RETIRED_NOTE_TITLES = [
  "GATE — OS concurrency cheatsheet",
  "GATE — what I keep getting wrong",
  "Postgres indexing notes",
  "Transformers — attention in my own words",
  "1:1 with Priya — running notes",
  "Sleep experiment — four weeks of data",
  "Things I keep re-Googling",
  "Books — 2026 reading log",
  "Standup — what I actually said",
  "Expenses — August",
  "Meal prep that actually gets eaten",
  "Ideas parking lot",
  "Mom's birthday — plan",
  "Debugging log — BlockNote hydration warning",
  "Interview stories — STAR format",
  "Goa trip — rough plan",
];

export const RETIRED_CONVERSATION_TITLES = [
  "Notes on the attention paper",
  "GATE prep plan",
  "Expenses question",
  "Cancel the Spanish goal?",
  "Reading list",
];

/** Memories are matched on their exact `content`, which is their only key. */
export const RETIRED_MEMORY_CONTENTS = [
  "Goal: Crack GATE CS 2027. Four milestones, weakest subjects first, last six weeks reserved for full-length mocks.",
  "Goal: Build a ₹1,50,000 emergency fund at ₹15,000 a month from the internship stipend.",
  "Goal: Read 12 books in 2026. Eight finished by the end of August.",
  "Paused goal: Conversational Spanish — parked until GATE is done, since two learning goals at once failed before.",
  "Completed goal: touch typing at 80 wpm, finished three weeks ago after four months of daily drills.",
  "Note: recurring GATE mistakes are the master theorem log factor, Belady's anomaly applying to FIFO not LRU, and over-counting in combinatorics.",
];

export const RETIRED_NOTIFICATION_TITLES = [
  "Operating Systems milestone is 40% through with 24 days left",
  "Algorithms milestone completed — two days early",
  "Release cut at 6pm",
  "You're on pace for 12 books",
  "Team offsite covers your long run slot",
  "Two events at 4pm on Wednesday",
  "Spanish hasn't moved in 3 weeks",
];

export const RETIRED_EVENT_TITLES = [
  // The recurring working week.
  "Standup",
  "Sprint planning",
  "1:1 with Priya",
  "Sprint retro",
  "Long run",
  "Family lunch",
  "GATE study block",
  // One-offs.
  "Design review — notes editor",
  "Team offsite",
  "Aditya's farewell dinner",
  "Release cut — v0.2",
  "Physio appointment",
  "Dentist",
  "GATE mock test — full length",
  "Mom's birthday dinner",
  "Mom's birthday",
  "Quarterly all-hands",
  "Semester registration deadline",
  "Advance tax deadline",
  "Half marathon — race day",
];

// ─────────────────────────────────────────────────────────────
// ASSISTANT HISTORY — conversations, newest last within each.
// ─────────────────────────────────────────────────────────────

export interface SeedConversation {
  title: string;
  /** Days ago the conversation happened. */
  day: number;
  hour: number;
  turns: Array<{
    user: string;
    assistant: string;
    /** Mirrors the extractor's output shape — see lib/validation.ts. */
    payload?: unknown;
  }>;
}

export const CONVERSATIONS: SeedConversation[] = [
  {
    title: "Move the study block to mornings", day: 0, hour: 8,
    turns: [
      {
        user: "Move my DSA practice to 6:45 in the morning, three days a week",
        assistant: "Done — DSA practice now runs Mon/Wed/Fri at 6:45am instead of 9pm. Your morning run is on the same days at 6:15, so the two are back to back. Want me to move the run to Tue/Thu?",
        payload: { intent: "UPDATE", target: { kind: "task", ref: null, query: "DSA practice" }, patch: { rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR", dueAt: "06:45" } },
      },
      {
        user: "no, keep the run. i'll do the run then study after",
        assistant: "Keeping it. That's 6:15 run, 6:45 study — tight but they're both at home, so no travel in between.",
        payload: { intent: "CHITCHAT" },
      },
    ],
  },
  {
    title: "What's left today", day: 0, hour: 14,
    turns: [
      {
        user: "what's still open today?",
        assistant: "Four things: the sync conflict write-up (in progress, 90 min), two GATE OS problem sets at 9pm, calling Mom at 8, and the mobile recharge. Three overdue items are also sitting there — the insurance renewal is four days late and lapses on the 5th.",
        payload: { intent: "QUERY" },
      },
    ],
  },
  {
    title: "Insurance renewal reminder", day: -1, hour: 21,
    turns: [
      {
        user: "Remind me to renew the health insurance tomorrow evening, it's urgent",
        assistant: "Added \"Renew the health insurance policy\" for tomorrow at 6pm, marked urgent, with a reminder an hour before.",
        payload: { intent: "CREATE_TASK", tasks: [{ title: "Renew the health insurance policy", category: "FINANCE", priority: "URGENT", dueAt: "18:00", durationMin: 30, rrule: null }] },
      },
    ],
  },
  {
    title: "Half marathon plan", day: -44, hour: 20,
    turns: [
      {
        user: "Help me plan a sub-2 hour half marathon in 12 weeks. My knee acted up last time I added speed early.",
        assistant: "Set up \"Run a sub-2:00 half marathon\" with three milestones: six weeks of base volume only, then long runs to 18k, then race-pace work and a taper. Given the knee, all the speed work sits in the last block and weekly volume never jumps more than 10%. Sub-2:00 is 5:41/km — your current easy pace suggests the fitness is there and the endurance isn't yet.",
        payload: { intent: "CREATE_GOAL", goal: { title: "Run a sub-2:00 half marathon", category: "HEALTH" } },
      },
      {
        user: "add the physio routine before every run",
        assistant: "Added it as a rule in the plan note and created a recurring \"Physio — knee routine\" task on run days.",
        payload: { intent: "CREATE_TASK", tasks: [{ title: "Physio — knee routine", category: "HEALTH", priority: "MEDIUM", durationMin: 25, rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" }] },
      },
    ],
  },
  {
    title: "Weekly review draft", day: -2, hour: 23,
    turns: [
      {
        user: "draft my weekly review from what i actually finished",
        assistant: "Drafted it as a note. The honest version: the notes editor and the OS concurrency section both moved, the sync write-up slipped three days, and you skipped Wednesday's run. Worth noting — every study block that survived this week was in the morning.",
        payload: { intent: "CREATE_NOTE", note: { title: "Weekly review — this week", tags: ["review", "weekly"] } },
      },
    ],
  },
  {
    title: "Overdue check", day: -3, hour: 9,
    turns: [
      {
        user: "what's overdue?",
        assistant: "Two things: the internship timesheet (one day late) and the GATE mock slot booking (two days). The insurance renewal is due tomorrow and is the one with a hard deadline.",
        payload: { intent: "QUERY" },
      },
      {
        user: "mark the timesheet done, i sent it this morning",
        assistant: "Marked \"Send the internship timesheet to HR\" complete.",
        payload: { intent: "COMPLETE", target: { kind: "task", ref: null, query: "timesheet" } },
      },
    ],
  },
  {
    title: "Mom's birthday", day: -8, hour: 22,
    turns: [
      {
        user: "Mom's birthday is on the 6th. Remind me to book the restaurant a week before and order the photo book by wednesday",
        assistant: "Added both: \"Mom's birthday — book the restaurant\" with a day-ahead reminder, and the photo book order for Wednesday. Printing lead time is the risk on the photo book, so I put that one first.",
        payload: { intent: "CREATE_TASKS", tasks: [{ title: "Mom's birthday — book the restaurant", category: "SOCIAL", priority: "HIGH" }, { title: "Order the photo book", category: "SOCIAL", priority: "HIGH" }] },
      },
    ],
  },
  {
    title: "Vitamin reminder", day: -22, hour: 9,
    turns: [
      {
        user: "remind me to take vitamin d3 every sunday morning",
        assistant: "Added \"Take vitamin D3\" every Sunday at 9am.",
        payload: { intent: "CREATE_TASK", tasks: [{ title: "Take vitamin D3", category: "HEALTH", priority: "LOW", rrule: "FREQ=WEEKLY;BYDAY=SU", dueAt: "09:00" }] },
      },
    ],
  },
  {
    title: "Grocery run", day: -6, hour: 18,
    turns: [
      {
        user: "add a grocery run for saturday evening",
        assistant: "Added \"Grocery run\" for Saturday at 6pm, an hour blocked out.",
        payload: { intent: "CREATE_TASK", tasks: [{ title: "Grocery run", category: "HOME", priority: "MEDIUM", durationMin: 60 }] },
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// SEMANTIC MEMORY — what the assistant has learned. Embedded
// with the configured Ollama model when it is reachable.
// ─────────────────────────────────────────────────────────────

export const MEMORIES: Array<{ kind: "task" | "goal" | "note" | "preference" | "fact"; content: string }> = [
  { kind: "preference", content: "Prefers study blocks in the morning — every evening study block gets skipped when work runs late." },
  { kind: "preference", content: "Wants overdue items surfaced first in the daily briefing, not last." },
  { kind: "preference", content: "Dislikes toast notifications; prefers an inline activity log that doesn't disappear on a timer." },
  { kind: "preference", content: "Keeps the phone outside the bedroom after 11pm and does not want reminders scheduled past then." },
  { kind: "preference", content: "Asks for plans in fortnights rather than weeks — a two-week horizon is what actually gets followed." },
  { kind: "preference", content: "Would rather pause a goal than abandon it — paused work can be resumed, abandoned work is relitigated." },
  { kind: "fact", content: "Lives in Bengaluru, timezone Asia/Kolkata. Works partly remote with a standup at 9:45am." },
  { kind: "fact", content: "Preparing for GATE CS 2027; weakest subjects are Algorithms and Operating Systems." },
  { kind: "fact", content: "Training for a half marathon in December, target sub-2:00, which is 5:41 per km." },
  { kind: "fact", content: "Had a left knee issue in March from adding speed work too early in a training block." },
  { kind: "fact", content: "Manager is Priya; 1:1 is Wednesdays at 4pm. Teammates are Aditya and Meera." },
  { kind: "fact", content: "Mom's birthday is on the 6th. Family lunch is a standing Sunday commitment." },
  { kind: "fact", content: "Rent is ₹18,000 and ₹15,000 a month goes into a separate liquid emergency fund." },
  { kind: "fact", content: "Interning part-time; conversion depends on owning one visible end-to-end feature." },
  { kind: "fact", content: "Runs a local-first setup — Postgres with pgvector, Ollama for models, nothing leaves the machine." },
  { kind: "fact", content: "Reads roughly one book a month, alternating fiction and non-fiction." },
  { kind: "goal", content: "Goal: Run a sub-2:00 half marathon. Base volume first, all speed work in the final block because of the knee." },
  { kind: "goal", content: "Goal: Get Life OS in front of 100 users. Ordered by what blocks a stranger's first five minutes." },
  { kind: "task", content: "Recurring: morning run 5k on Mon/Wed/Fri at 6:15am, roughly 40 minutes." },
  { kind: "task", content: "Recurring: DSA practice, two problems daily — being moved from 9pm to 6:45am." },
  { kind: "task", content: "Recurring: standup notes every weekday at 9:45am." },
  { kind: "task", content: "Recurring: weekly review every Sunday at 8pm, about 45 minutes." },
  { kind: "task", content: "The health insurance renewal is urgent — the policy lapses on the 5th and the web portal keeps timing out." },
  { kind: "task", content: "The sync conflict write-up has slipped three days in a row; it loses to whatever is loudest that day." },
  { kind: "task", content: "Advance tax is due in under two weeks and is the highest-consequence financial deadline on the list." },
  { kind: "task", content: "Notes editor rewrite has two subtasks left: image upload and the keyboard shortcut parity pass." },
  { kind: "note", content: "Note: sync conflicts resolve by comparing each side against syncedAt, the last point local and remote agreed." },
  { kind: "note", content: "Note: the three sync cases are local-newer, remote-newer, and both-changed. Remote wins the third, local is kept as a note." },
  { kind: "note", content: "Note: HTML for note content and separate Task/CalendarEvent models are the two architecture decisions already regretted." },
  { kind: "note", content: "Note: no screens after 11pm added over an hour of sleep — more than caffeine timing, and stacking both barely helped." },
  { kind: "note", content: "Note: eating out costs nearly as much as groceries, almost all weekday lunches when Sunday meal prep was skipped." },
  { kind: "note", content: "Note: composite index column order is equality first, range last — (userId, dueAt) not (dueAt, userId)." },
  { kind: "note", content: "Note: attention is a soft dictionary lookup; KV caching turns per-token cost from quadratic to linear." },
  { kind: "note", content: "Note: meal prep only survives the week with two rotations, and anything with fresh salad is soggy by Tuesday." },
  { kind: "note", content: "Note: a hydration warning is never cosmetic — it means the server and client rendered two different trees." },
  { kind: "note", content: "Note: PR reviews go faster under 400 lines; Priya's standing feedback is to split by concern." },
];

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

export interface SeedNotification {
  type: "TASK_DUE" | "TASK_OVERDUE" | "GOAL_NUDGE" | "BRIEFING_READY" | "CONFLICT" | "SUGGESTION";
  title: string;
  body?: string;
  actionUrl?: string;
  /** Days ago it fired. */
  day: number;
  hour: number;
  /** Unread when false. */
  read: boolean;
}

export const NOTIFICATIONS: SeedNotification[] = [
  { type: "TASK_OVERDUE", title: "Health insurance renewal is 4 days late", body: "The policy lapses on the 5th.", actionUrl: "/dashboard", day: 0, hour: 8, read: false },
  { type: "BRIEFING_READY", title: "Your briefing is ready", body: "3 overdue, 5 due today, 4 on the calendar.", actionUrl: "/dashboard", day: 0, hour: 7, read: false },
  { type: "SUGGESTION", title: "Your morning study blocks survive; evening ones don't", body: "Six of seven morning blocks finished this month, against two of nine in the evening. Want to move them?", actionUrl: "/assistant", day: 0, hour: 8, read: false },
  { type: "TASK_DUE", title: "Two GATE OS problem sets due at 9pm", actionUrl: "/dashboard", day: 0, hour: 20, read: false },
  { type: "CONFLICT", title: "Sprint demo overlaps your physio appointment", body: "Tomorrow, 15:30 and 18:00 — 45 minutes of travel between them.", actionUrl: "/calendar", day: 0, hour: 9, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -1, hour: 7, read: true },
  { type: "TASK_OVERDUE", title: "GATE mock slot booking is a day late", actionUrl: "/dashboard", day: -1, hour: 9, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -2, hour: 7, read: true },
  { type: "SUGGESTION", title: "The sync write-up has slipped 3 days", body: "Every day it's scheduled after 2pm it doesn't happen. Try the first hour of the morning.", actionUrl: "/assistant", day: -2, hour: 18, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -3, hour: 7, read: true },
  { type: "TASK_OVERDUE", title: "Internship timesheet is overdue", actionUrl: "/dashboard", day: -3, hour: 9, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -4, hour: 7, read: true },
  { type: "SUGGESTION", title: "Three tasks have had no due date for over a month", body: "The blog post, the monitor sale, and the backup routine.", actionUrl: "/dashboard", day: -7, hour: 19, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -7, hour: 7, read: true },
  { type: "TASK_DUE", title: "Blood test tomorrow at 8am — fasting", body: "Nothing to eat after 10pm tonight.", actionUrl: "/calendar", day: -7, hour: 21, read: true },
  { type: "SUGGESTION", title: "Your knee physio streak is at 14 days", actionUrl: "/dashboard", day: -11, hour: 7, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -12, hour: 7, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -19, hour: 7, read: true },
  { type: "TASK_OVERDUE", title: "Electricity bill is 2 days late", actionUrl: "/dashboard", day: -23, hour: 9, read: true },
  { type: "SUGGESTION", title: "Base building milestone looks finishable this week", body: "One 12k long run left.", actionUrl: "/goals", day: -11, hour: 20, read: true },
  { type: "BRIEFING_READY", title: "Your briefing is ready", actionUrl: "/dashboard", day: -26, hour: 7, read: true },
];

// ─────────────────────────────────────────────────────────────
// DAILY BRIEFINGS — one per day the app was opened. The gaps
// are deliberate: nobody has a perfect streak.
// ─────────────────────────────────────────────────────────────

/**
 * Summaries keyed by how many days ago. Anything not listed gets a
 * generated line from the counts, which is what the real briefing
 * route falls back to when the model is unavailable.
 */
export const BRIEFING_LINES: Record<number, string> = {
  0: "Three overdue and the insurance one has a hard deadline — start there, it takes ten minutes. The sync write-up has the afternoon; protect it.",
  1: "Lighter than yesterday. The mock slot booking is the only thing with a clock on it.",
  2: "The morning is the only real working block today. Everything else can wait until tomorrow.",
  3: "Two overdue from last week. The timesheet is a two-minute job and it's been sitting for three days.",
  4: "Nothing overdue for the first time in a week. Long run tomorrow — the physio routine is on today's list for a reason.",
  5: "Nothing on the calendar, which makes the 8pm study block the easiest thing to skip — it'd be the third.",
  6: "Quiet Sunday. Weekly review at 8, and the OS chapter if you want it.",
  8: "Wide open today, so it's the day to move anything that needs a long uninterrupted block.",
  9: "One milestone with a date on it and nothing else urgent. Worth a long block on it.",
  11: "Good week so far — five of six morning blocks done. The 14k long run is Saturday.",
  13: "The notes editor migration is the thing that'll get asked about — worth an hour before anyone does.",
  16: "Base building is nearly closed out — one long run left. Everything else can move.",
  18: "Three things due and two of them are financial. The advance tax one is the expensive one to forget.",
  22: "Nothing urgent. Worth using the space for the DBMS reading you keep deferring.",
  26: "Back-to-back meetings until 4. The only study block that will survive is the morning one.",
};

/** Days ago that got a briefing. Missing days are days the app wasn't opened. */
export const BRIEFING_DAYS = [
  0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18,
  20, 21, 22, 23, 25, 26, 27, 29, 30, 32, 33, 34, 36, 37,
];
