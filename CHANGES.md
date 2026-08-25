# Life OS — changes

## v0.5 — a ghost on the calendar

### Deleting an event in Google left a copy behind

Cancel an event in Google Calendar, sync, and the row stayed in Life OS. It
could not be explained, only deleted a second time.

The pull path read a non-null `CalendarEvent.syncedAt` as "this row carries
local intent — unlink it rather than delete it", a guard meant to stop a
Google-side tidy-up destroying an event the user created here. But
`markEventSynced()` runs on every mirror the instant it is first pulled in, so
`syncedAt` is non-null for pure mirrors too and the guard fired for all of them.
`syncedAt` answers *has this ever synced*, not *does the user own this*, and no
column carried the second question.

So provenance got its own: `CalendarEvent.mirrored`, set true only on the two
pull-**create** paths. Deliberately not on the update path — that also runs for
our own pushed events coming back around, and marking those as mirrors would
reintroduce the bug from the other side.

Both tombstone branches now call one predicate, `carriesLocalIntent()`, which
treats a row as locally owned if it did not originate remotely, **or** if it is
a mirror holding an edit made here that has not reached the provider yet
(`updatedAt` past `syncedAt` — the same comparison `push()` uses). Unlinking
clears the flag: a row with nothing left to mirror is an ordinary local event
from then on.

Existing rows default to `mirrored = false`, which errs the safe way — a
pre-existing mirror is unlinked rather than deleted, never the reverse.

### Verification

The distinction was untested in *both* directions, which is how it survived.
Five assertions were added as a new group in `npm run test:calendar`:

- a pulled row records that it is a mirror
- an event created here survives being deleted in Google
- a mirror holding an unsynced local edit is unlinked, with the edit intact
- an untouched mirror is deleted, leaving no ghost row
- unlinking a local event is not counted as a removal

30 checks → 35, all passing. The two that had been failing were one defect with
two symptoms: the second counted the ghost row the first left behind.

---

## v0.4 — voice as a conversation

Hands-free dictation that acts on each sentence as you finish it, including
editing and deleting things that already exist, and a spoken sign-off.

### The loop

Click **Voice** once. After that it listens continuously: detects speech onset,
notices the ~1s pause that ends a sentence, runs the command, and goes straight
back to listening. No press-to-talk — the Record/Stop pair is gone.

Say **"That'll be all"** (or "that's it", "stop listening", "I'm done",
"goodbye") and it turns itself off. Matched per-sentence, so
`"Okay, that's it. That will be all."` stops but
`"That'll be all I need from the shop"` is a shopping list.

Utterance boundaries live in `src/lib/voice/utterance.ts` as a pure state
machine over (level, timestamp), so the timing rules are testable without a
microphone: a door slam is too brief to open an utterance, an "um…" is too brief
to close one, hysteresis stops breathing at the threshold from flapping the
state, and a 30s cap segments a monologue rather than dropping its tail.

### Editing and deleting by voice

The router previously only had `CREATE_*` intents, so an edit request created a
*second* copy. Saying "the previous note should say t-shirt idea not teacher
idea" produced two notes with the wrong text still in the first.

Added `UPDATE`, `DELETE`, `COMPLETE`, each carrying a `target` the user
describes in their own words ("the gym one", "the previous note") and, for
updates, a `patch` — including `replace: {from, to}` for in-place wording fixes.

**The model never sees or invents an id.** It describes; `src/lib/server/resolve.ts`
finds the row. Scoring is deliberately boring and explainable — exact title 100,
title-contains 80, then token overlap, with body text worth a third of a title
match — because when you say "delete the dentist one" you need to predict what
goes. Near-ties return `ambiguous` and ask instead of guessing.

### Safety, because dictation mishears

Whisper turns "Remind" into "Find" and "4 PM" into "4 AM", and hands-free mode
has no confirmation step. So:

- **Deletes are undoable.** The delete returns a snapshot; the activity row
  offers *Undo delete*, and `POST /api/undo` recreates it. The snapshot
  round-trips through the client, so it is re-validated server-side and written
  under the session's user id, never one supplied in the body.
- **Destructive resolution is stricter.** A non-destructive "the last one" may
  fall back to recency; a delete may not. If the description matches nothing,
  nothing is deleted.
- **The kind comes from the utterance, not the model.** "the note" / "my goal"
  is read by regex and overrides the model's guess. Without this, "delete the
  note about no regrets" deleted an unrelated *task* — observed, and the reason
  the override exists.

### Fixed while testing this

- **"Note saved." when nothing was saved.** The model can return `CREATE_NOTE`
  with no note object; the reply was hard-coded and claimed success anyway. The
  payload is now filled from the utterance, and replies report what actually
  happened.
- **Whisper hallucinations became tasks.** On near-silence the local model emits
  "Thank you for watching. Please subscribe. Thank you. Bye. Bye." — a string of
  stock phrases that slipped past a whole-string filter and was filed as a task
  called *Subscribe*. Now rejected when every sentence is boilerplate.
- **Every dictated sentence was submitted twice.** `reactStrictMode`
  deliberately double-invokes state updaters to expose impurity, and `submit()`
  was being called inside one.
- **One sentence became two identical tasks.** Deduped within an utterance —
  duplicates also made "I finished the gym task" genuinely ambiguous.
- **Model dates lose to chrono on edits**, as they already did on creates.
  Asked to move something to "Friday morning" a 1B model returns tomorrow at
  09:00 — a value that parses cleanly, so nothing downstream can tell it is the
  wrong day.

### Live interim text: built, off by default

Words appearing *while* you speak needs a fast transcriber. Two findings:

1. **Brave's Web Speech API is non-functional.** The object exists — so a naive
   feature-detect reports it as supported — but it errors `network` because
   Brave ships without Google's speech backend. Probed directly; Chrome works.
2. **Whisper `small` takes 2–7s per pass on CPU**, longer than most sentences.
   Even a 1s clip costs ~1.7s in fixed overhead. Partials would land after you
   stopped talking, flash text that then changes, and starve the final pass.

So partials are gated behind `WHISPER_FAST_MODEL`. Unset (the default),
dictation still works — you get the text when you stop. Point it at
`Systran/faster-whisper-tiny.en` and live text turns on, with the accurate model
still doing the final pass.

> The Whisper container currently has **no DNS** (`127.0.0.11` failing), so it
> cannot pull that model. Same root cause blocks `ollama pull`. Worth fixing at
> the Docker level.

### Verification

`npm run test:unit` covers utterance timing, sign-off matching, target scoring,
in-place correction, and the edit/delete parsing — 119 assertions. The
hands-free loop, the sign-off, and the undo path were each driven in a real
browser with speech fed through a fake microphone.

---

## v0.3 — correctness pass

Everything below came out of actually running the stack (Postgres + Ollama +
Whisper via docker-compose) and driving every route. Each item is a defect that
reproduced, not a refactor.

### Verification added

Nothing existed to run before this, so the failures below were invisible.

| Command | What it covers |
| --- | --- |
| `npm run test:unit` | 50 assertions: timezone arithmetic, the deterministic parser, RRULE normalization, model-output coercion |
| `npm run smoke` | 37 checks over HTTP against a running server: every page, full CRUD, cross-guest isolation, the NL pipeline, rate limits, graceful degradation |
| `npm test` | typecheck + unit |
| `npm run lint` | now actually runs — see below |

Both suites report Ollama/Whisper as *skipped* rather than failed when absent,
so they pass on a bare `docker compose up postgres`.

### Fixed: identity

**Session race dropped users into a phantom account.** `currentUser()` did
find-then-create on the cookie id. The middleware primes that cookie, so a
single first page load fires several concurrent requests carrying the same new
id — they raced, and every loser hit `Unique constraint failed on the fields:
(id)`, logged "DB unavailable", and returned an in-process guest with no `User`
row behind it. Now an `upsert`, with a re-read as a second line of defence.
(`src/lib/session.ts`)

### Fixed: time

The app stores a `timezone` per user and then ignored it everywhere.

- **`DailyBriefing.forDate` was written a day early.** It's a `@db.Date`
  column, and the code passed server-local midnight, so any server east of UTC
  truncated to the previous calendar day — the daily dedupe key drifted and the
  UI showed the wrong date.
- **"Due today" meant the server's today**, on the dashboard, the briefing, and
  the calendar's fortnight window.
- **Relative dates resolved against the server's wall clock.** "tomorrow at
  7pm" gave 19:00 server time to every user, whichever zone they were in — and
  for a user near midnight, the wrong day entirely.

New `src/lib/time.ts` owns this: `dayRangeIn`, `dateKeyIn`, `hourIn`,
`weekdayIn`, and `parseDateInTz` (a reference-instant round trip, since
chrono-node only parses in server-local time). Threaded through the dashboard,
the calendar, the briefing, the extractor, and the fallback parser.

### Fixed: the AI paths

- **`/api/ai/plan-goal` returned a bare 500 with Ollama down** — the only AI
  route with no fallback. Now a 503 carrying an actionable message, and the UI
  shows it instead of a generic "Planning failed".
- **A failed plan wiped the existing one.** The route deleted all milestones and
  tasks *before* checking that the new plan had any content. An empty result now
  leaves the current plan alone (502).
- **The planner failed silently.** A schema mismatch and "the model had nothing
  to say" produced identical empty results and identical silence. Now logged
  with the validation errors and the raw output — which is how the next two were
  found.
- **One invented enum value discarded a whole plan.** Models emit `LANGUAGE`,
  `SELF-REFLECTION`, `Medium`, and `2026-09-27` for a datetime. Strict enums
  rejected the entire nested object. New `src/lib/ai/schema.ts` coerces at the
  *model* boundary — synonyms mapped, unknowns defaulted, date-only strings
  promoted — while `lib/validation.ts` stays strict at the *HTTP* boundary,
  where junk deserves a 400.
- **Malformed RRULEs were stored verbatim.** Observed: `"RRULE: FREQ=3,INTERVAL=3"`
  — a stray prefix, an invalid frequency, and commas for semicolons. Anything
  reading `Task.rrule` back through the `rrule` library would throw.
  `normalizeRRule` repairs what's recoverable and returns null for what isn't; a
  null recurrence beats a corrupt one.
- **The planner returned `{}` on small models.** The prompt had no example
  output. Added a one-shot example; goal planning now works on gemma3:1b.
- **The LLM lost recurrences the keyword parser catches.** "every 3 days"
  came back with no rrule at all. The extractor already repaired missing dates
  with chrono; it now does the same for recurrence.
- **Ollama health lied.** `present` used `startsWith` on the model family, so
  `OLLAMA_MODEL=gemma3:4b` reported installed when only `gemma3:1b` was pulled.
  Now an exact match (with implicit `:latest`), plus the `ollama pull` command
  as a hint. Settings grew a distinct amber state — `ok: true` only ever meant
  "the service answered".
- **`/api/voice/transcribe` 500'd on a non-multipart body.** Now 400.

### Fixed: data flow

**The dashboard's "Today" list silently became every task.** The page
server-renders a filtered set, but the client store polled unfiltered
`/api/tasks` every 30 seconds — so half a minute after landing, "Today" showed
the whole account, done tasks and next year's included. Added a `scope=today`
filter, shared between the server component and the poll via
`src/lib/queries.ts` so the two can't drift. Overdue tasks are now in that
scope: the briefing says "start with what's overdue", and they weren't on the
list it was talking about.

### Fixed: rate limiting

Budgets covered the two cheap endpoints (chat, extract) and none of the
expensive ones. Goal planning — a long synchronous generation that rewrites a
plan — was unlimited, as were the briefing and 25MB Whisper uploads. Now
cost-tiered: plan 5/min, transcribe 12/min, briefing 10/min, chat and extract
30/min. The limiter's `Map` also never evicted, which with per-cookie guest
users is an unbounded leak; it now sweeps.

### Fixed: dead ends

- Two **"Connect Google Calendar"** links pointed at a Settings panel that v0.2
  deleted along with the auth layer. Replaced with copy that's true.
- **`npm run lint` never ran.** No ESLint config existed, so it dropped into the
  interactive "How would you like to configure ESLint?" prompt and hung in any
  non-tty shell. Added `eslint.config.mjs` (flat config, eslint 9); fixed the 3
  real errors it found. Clean.

### Fixed: security patches

`npm audit` reported 13 advisories, 1 critical. `next 15.0.3 → 15.5.23` clears
the critical plus postcss and sharp; nanoid, tsx, eslint, and
`@tiptap/extension-link` also bumped. Exact pins kept.

Three moderate advisories remain and require **Next 16** — a major upgrade, left
as a deliberate decision rather than done silently.

### Fixed: the seed

`npm run db:seed` wrote to a standalone `demo@lifeos.local` user that no browser
session could ever see — the app looked empty on a fresh install. It now seeds
the guest you're actually browsing as (most recent, or `SEED_USER_ID=<id>`), and
covers goals with milestones, notes with a backlink, calendar events, and an
overdue task, so every page has something in it. It also creates the `Memory`
HNSW index that CHANGES v0.2 listed as outstanding.

### Fixed: the docs

README and ARCHITECTURE still described the auth layer v0.2 removed. The worst
of it was ARCHITECTURE §9, which claimed "All API routes verify `auth()` on
every call" and that `AUTH_SECRET` was required for production. There is no
auth. That section now states the real trade-off: whoever holds a `lifeos_uid`
cookie *is* that user, no route returns 401, and what genuinely is enforced is
per-`userId` query scoping on every route (verified by the smoke test). The
README quick-start no longer asks for Google OAuth credentials it doesn't use.

### Known limits, unchanged

- No auth. Deliberate, now documented honestly rather than aspirationally.
- Goal planning is synchronous (~20s on a small model). Belongs on a queue.
- Rate limiting is per-process; it doesn't hold across replicas.
- Small models are weak at intent: gemma3:1b files "learn Spanish in 6 months"
  as a task rather than a goal. The prompts are fine; the model isn't.

---

## v0.2 — Refactor changes

Local-first, no sign-in. Next 15 stable. Premium landing redesign.

## Why this exists

Five real problems from v0.1:

1. **`headers()` / `cookies()` async errors** — Auth.js v5 beta + Next 15 are incompatible. Fixed by removing Auth.js entirely.
2. **`next.config.ts` rejected** — fixed by switching to `next.config.mjs`.
3. **Forced Google OAuth** — fixed by making sign-in optional (currently absent). Guest mode is the default.
4. **Middleware blocked routes** — rewritten to do exactly one thing: pre-warm the user cookie.
5. **Landing felt static and redundant** — five distinct sections, real scrollspy, magnetic buttons, auto-playing demo.

## Files: removed

```
src/lib/auth.ts                                 ← Auth.js wrapper
src/middleware.ts                               ← was a redirect gate
src/app/(auth)/signin/page.tsx                  ← sign-in page
src/app/api/auth/[...nextauth]/route.ts         ← NextAuth handler
src/app/api/calendar/google/connect/route.ts    ← OAuth bootstrap
src/app/api/calendar/google/callback/route.ts   ← OAuth callback
src/app/api/calendar/sync/route.ts              ← needed the OAuth tokens
src/lib/calendar/google.ts                      ← imported googleapis
src/lib/calendar/sync.ts                        ← provider adapter
src/components/layout/providers.tsx             ← <SessionProvider> wrapper
next.config.ts                                  ← replaced by .mjs
```

> The calendar **internal model** (`CalendarEvent`, the dashboard widget, the
> 14-day view) still works. We only dropped the parts that required OAuth.

## Files: added

```
next.config.mjs                                 ← stable JS config
src/middleware.ts                               ← cookie-priming only
src/lib/session.ts                              ← 60-line guest-by-default session
src/components/landing/scrollspy-nav.tsx        ← active-section nav
src/components/landing/magnetic-button.tsx      ← spring-physics CTA
src/components/landing/live-demo.tsx            ← auto-playing dialogue
src/components/landing/capabilities-grid.tsx    ← asymmetric feature grid
src/components/landing/system-diagram.tsx       ← dark pipeline section
```

## Files: changed

### `package.json`
- Removed: `next-auth`, `@auth/prisma-adapter`, `googleapis`, `google-auth-library`, `@upstash/ratelimit`, `@upstash/redis`, `openai`, `bcryptjs`, `@types/bcryptjs`, `@radix-ui/react-toast`, `react-day-picker`
- Pinned: every dep to an exact version (no `^`) — reproducible installs
- Next: `15.0.2` → `15.0.3` (stable)
- React stays at 18.3 (Next 15 supports both 18 and 19; 18 is more stable with TipTap & next-themes)

### `prisma/schema.prisma`
- **Removed**: `Account`, `Session`, `VerificationToken` models
- **User**: `email` is now nullable; new `isGuest Boolean @default(true)` field
- All other models unchanged

### `.env.example`
- Removed: `AUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `UPSTASH_*`
- Required to run: only `DATABASE_URL`. Everything else has sensible defaults.

### `src/lib/server/ratelimit.ts`
- Dropped Upstash branch. Memory-only. Honest about the trade-off in a comment.

### `src/components/layout/sidebar.tsx`
- Takes `user` as a prop (no more `useSession`)
- Active item uses Framer `layoutId` for a sliding background pill
- Sign-out and avatar dropdown removed (no auth means no sign-out)

### `src/app/(app)/layout.tsx`
- No auth gate. Renders unconditionally with a "guest mode" banner.

### `src/app/(app)/settings/page.tsx` + `settings-content.tsx`
- Removed "Connect Google Calendar" panel
- Profile editor saves through `/api/me`
- AI health checks (Ollama, Whisper) preserved

### All 18 API routes
- `auth()` → `currentUser()`
- `session.user.id` → `user.id`
- No `Unauthorized` 401 responses — every route is open
- The four `ai/*` routes had a duplicate `prisma.user.findUnique` to fetch `timezone`; that's now provided by `currentUser()` so the duplicate is removed

### `src/app/page.tsx` (the landing — full rewrite)

Five sections, each visually distinct:

| Section | Tone | Purpose |
| --- | --- | --- |
| **Hero** | Warm cream, ambient gradient | First impression. Editorial serif headline. Magnetic CTA. |
| **Demo** | Slight off-white | Auto-playing three-turn dialogue. **The "aha".** |
| **Capabilities** | Soft beige | Four asymmetric cards (col-span 2/1/1/2). Stagger reveal. |
| **System** | Dark graphite | The architecture pipeline. Radically different visual. |
| **Closing** | Cream + grain | One serif sentence. One magnetic button. |

**Scrollspy nav**: IntersectionObserver tracks the active section. The underline animates between links via Framer `layoutId`. Backdrop blur kicks in at scroll > 40px. No more "Features" + "How it works" pointing to the same place.

## Migrating from v0.1

If you have an existing v0.1 install and want to upgrade in place rather than
re-extract:

```bash
# 1. Drop the removed packages
npm uninstall next-auth @auth/prisma-adapter googleapis google-auth-library \
  @upstash/ratelimit @upstash/redis openai bcryptjs @types/bcryptjs \
  @radix-ui/react-toast react-day-picker

# 2. Pull the new files (everything in this CHANGES list)

# 3. Migrate the DB
#    Either reset (loses local data) or run a migration:
npx prisma migrate dev --name remove_auth_add_guest

# 4. Drop the old auth cookie if any, then:
npm run dev
```

## What still needs work

Honest list, sorted by priority:

1. **Calendar OAuth** — when you do want Google Calendar back, write a fresh
   `lib/calendar/google.ts` against the new session layer (~60 lines).
2. **Goal planner runs synchronously** — fine for demo, queue it in prod.
3. **No vector index on `Memory`** — add HNSW once row count grows.
4. **Sign-in upgrade path** — there's no flow today to convert a guest into
   a Google-authed account. Schema supports it (`isGuest: false`); UI doesn't.
