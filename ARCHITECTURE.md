# Architecture

The README covers *what* is here. This covers *why*. Where a decision was forced by something that actually broke, the failure is named — those are the parts worth reading.

---

## 1. The core insight

Productivity tools fail because they ask the user to think like the tool. Notion makes you decide whether something is a page or a database row. Calendar apps make you decide whether something is an event or a task. Todoist asks for priority, label, due date and project before you have finished the thought.

The translation is trivial in isolation and substantial in aggregate, because it is paid on every single capture, at the moment the user is least willing to pay it — mid-thought, usually mid-something-else.

Life OS rejects that framing. The user types or speaks a sentence; the system decides what it is:

- **Intent classification** in the request path.
- **Date and time inference** in two passes, so the model's suggestion is validated rather than trusted.
- **Category, priority and recurrence** inferred from the same call.
- **Goals trigger a second pass** — the planner — which decomposes into milestones and scheduled tasks.

The obvious way to do this is to put a large language model in front of the form. That creates a second problem: the sentences a personal system receives are, by definition, the contents of a person's life. Streaming that to a third party for the convenience of not filling in a form is a poor trade, and it costs money per keystroke. So the constraint that shapes everything below is that **the model must be small enough to run on a laptop** — and small models are confidently wrong in specific, characterisable ways.

Most of this document is about designing around that.

---

## 2. System diagram

```
                         ┌──────────────┐
                         │   Browser    │
                         └──────┬───────┘
                                │ HTTPS
                                ▼
              ┌─────────────────────────────────┐
              │          Next.js 15             │
              ├─────────────────────────────────┤
              │  middleware.ts   auth gate      │
              │  /api/ai/*       router         │
              │  /api/calendar/* sync           │
              │  /api/voice/*    whisper        │
              │  /api/calls/*    signed TwiML   │
              │  /api/{tasks,goals,notes,…}     │
              │  instrumentation.ts  60s sweep  │
              └───┬─────────────┬───────────┬───┘
                  │             │           │
                  ▼             ▼           ▼
          ┌────────────┐  ┌──────────┐  ┌────────┐
          │ PostgreSQL │  │  Ollama  │  │Whisper │
          │ + pgvector │  │ gemma3   │  │ local  │
          └────────────┘  │ nomic    │  └────────┘
                          └──────────┘
                  │                          │
                  ▼                          ▼
          ┌───────────────┐          ┌──────────────┐
          │  Google APIs  │          │ Twilio Voice │
          │ Calendar v3   │          │              │
          │ Tasks v1      │          └──────────────┘
          │ Identity (ID) │
          └───────────────┘
            ── optional ──
```

Postgres, Ollama and Whisper all run on the user's own machine via `docker-compose`. Google and Twilio are capabilities, not requirements: `lib/env.ts` reports what is configured and every absent dependency disables exactly one feature.

---

## 3. Identity

### Why Auth.js with two Credentials providers, and no OAuth redirect

`src/lib/auth.ts` configures NextAuth v5 with the JWT session strategy and two providers, both modelled as Credentials:

- **`google`** — the browser obtains a Google Identity Services ID token; `lib/auth/google-id-token.ts` verifies it against Google's published JWKS, checking signature, issuer, audience, expiry and nonce, and refusing unverified email addresses.
- **`credentials`** — email and password, checked against `User.passwordHash` with bcrypt at cost 12.

Google's own OAuth provider was not used, because it needs a client secret. Modelling sign-in as an ID token verification means **the app is deployable with nothing secret on disk beyond `AUTH_SECRET`**. A client ID is public by design; it ships inside the page of every Google web app.

The cost is explicit and worth knowing: an ID token is proof of identity, not an API grant. It cannot be exchanged for calendar access. That is why calendar authorization lives separately, in `/api/calendar/google/connect`, and does require a secret. Keeping the two apart is also the right security shape — see §6.

A Credentials provider forces the JWT strategy, so there are no `Session` rows and no Prisma adapter; users are created and looked up directly in `authorize()`. The `Session` model is retained only for adapter compatibility if a provider needing database sessions is ever added.

Every `authorize()` returns `null` rather than throwing — on bad input, a missing user, an OAuth-only account, or a wrong password alike. Auth.js turns that into one generic "invalid credentials", so the endpoint does not leak which part failed. `/api/auth/signup` follows the same rule: a duplicate returns the same message whether the existing account has a password or is Google-only.

Google sign-in matches on the *verified* email, so signing in with Google after registering with a password lands on the same account rather than forking a second one. It fills in a name or avatar that was missing but never overwrites one the user has set.

### The gate

`src/middleware.ts` does one thing: everything except `/`, `/login`, `/signup`, `/api/auth/*` and `/api/calls/twiml` requires a session. Pages redirect to `/login` carrying a `callbackUrl`; API routes return 401.

`/api/calls/twiml` is public because Twilio has no session. It is not unprotected — see §7.

`src/lib/session.ts` is the single place the rest of the application asks "who is this". It reads the Auth.js JWT and joins it against the `User` row for the fuller profile every page needs. It **throws** rather than degrading when there is no session, because with the gate in place a missing session is a bug in the gate, not a case to handle.

---

## 4. The AI pipeline

Single source of truth: `src/lib/ai/router.ts`. Five stages.

### Stage 1 — Memory recall

The message is embedded with `nomic-embed-text` and cosine-searched against the user's `Memory` rows.

Retrieved context is deliberately **not** injected into the extraction prompt. The expected design was standard RAG; in practice the small model over-fitted to the retrieved example rather than reading the sentence in front of it, producing ambiguous structured output. Inverting that assumption was the correct answer and is the finding here most likely to generalise.

The recall result is currently passed to the reply step but not yet consumed there — a known incomplete edge, listed in the README roadmap.

### Stage 2 — Intent extraction

One Ollama call with `format: "json"` and `temperature: 0.1`, against a system prompt that states the schema, numbers the inference rules, gives five worked examples, and forbids prose around the JSON.

Three details that exist because of observed failures:

- **The reference time is truncated to the minute.** With seconds present, a model that echoes the injected timestamp produces a `dueAt` indistinguishable from a computed one.
- **"Today" and "tomorrow" are precomputed and injected.** 1B models get date arithmetic wrong.
- **The prompt forbids inventing identifiers.** "Describe the thing; the server finds it." See §5.

Output is parsed as JSON, falling back to the first `{…}` substring, then validated by Zod.

### The boundary rule: lenient at the model, strict at HTTP

`src/lib/ai/schema.ts` coerces at the *model* boundary; `src/lib/validation.ts` stays strict at the *HTTP* boundary, where junk deserves a 400.

This exists because a single invented enum value used to discard an entire nested plan. Models emit `LANGUAGE`, `SELF-REFLECTION`, `Medium`, and a bare `2026-09-27` where a datetime was asked for. So the model schemas map synonyms, default unknowns, and promote date-only strings — while an API client sending the same junk still gets rejected.

`normalizeRRule` is the sharpest case. Observed output: `"RRULE: FREQ=3,INTERVAL=3"` — a stray prefix, an invalid frequency, and commas for semicolons. It repairs what is recoverable, splits on a comma only when followed by `KEY=` so `BYDAY=TU,TH` survives, rejects a non-enum `FREQ` outright rather than guessing at a schedule, and validates the result through the `rrule` library. **A null recurrence beats a corrupt one.**

### Why dates are resolved twice

A model asked to move something to "Friday morning" returns tomorrow at 09:00 — a value that parses cleanly, validates cleanly, and is wrong. Nothing downstream can detect it.

So `extractor.ts` runs the deterministic parser *alongside* the model on every call and reconciles:

- If the deterministic parser read an action verb and the model did not, **the model's answer is discarded entirely.** Small models filed "the previous note should say X not Y" as a new task, silently duplicating data.
- The target *kind* prefers the deterministic reading, because kind is stated outright far more reliably than a 1B model infers it — and getting it wrong deletes from the wrong table.
- On a stated clock time in a single-task utterance, chrono's reading **overwrites** the model's. Single-task only: one utterance-wide time cannot be attributed across several tasks.
- A missing recurrence is repaired from the keyword parser, which catches "every 3 days" when the model returns nothing.

All chrono parsing goes through `lib/time.ts`, which shifts the reference instant by the difference between the user's zone and the server's, parses, then unshifts — because chrono only parses in server-local time. Before this existed, "tomorrow at 7pm" gave 19:00 *server* time to every user, and for a user near midnight, the wrong day.

### Stage 3 — Side effects

The router never touches Prisma. It calls `src/lib/server/actions.ts` — functions taking `userId` plus structured input. That keeps the router free of Prisma imports and makes the action layer callable from REST routes too; the manual "New goal" form uses the same `createGoalFromIntent` path as the assistant.

Tasks are deduplicated by title within one utterance before writing, because a small model splitting one sentence into two identical rows also made "I finished the gym task" genuinely ambiguous.

### Stage 4 — Memory write

Each created entity is embedded and stored in `Memory` with `kind` and `refId`, so a memory row can be reverse-linked to its source.

### Stage 5 — Reply

For the four creation intents the reply is **templated, computed from what was actually written** — no second LLM call. This saves a round trip, keeps the assistant's voice consistent, and makes it impossible for the reply to hallucinate about the database.

It also fixes a real defect: the reply for `CREATE_NOTE` used to be hard-coded, so a model response carrying the intent but no note object printed "Note saved." over a silent no-op. Replies now check what was created before claiming anything.

Only `CHITCHAT` and `UNKNOWN` reach the model for free-form text. `QUERY` currently echoes the model's own reply and does no retrieval — the clearest remaining gap in the taxonomy, and the obvious place for the recall layer from Stage 1.

### The planner

A goal becomes 3–7 milestones with 2–5 tasks each. The recovery ladder is deliberate: parse, then the embedded-`{…}` fallback, then probe for a container key (`plan`, `goal`, `result`, `data`) because models wrap the plan surprisingly often, then lenient validation, then filter blank titles.

Two guards, both from failures:

- **A failed plan used to wipe the existing one.** The route deleted milestones and tasks *before* checking the new plan had content. An empty result now returns 502 and leaves the current plan alone.
- **The planner used to fail silently.** A schema mismatch and "the model had nothing to say" produced identical empty results. Both are now logged with validation errors and the raw output — which is how the RRULE and enum defects above were found.

Re-planning deletes only `source: GOAL_PLAN` rows, so tasks the user added themselves under that goal survive. The `TaskSource` enum is the piece of provenance that makes this safe.

Planning from the chat path runs as a detached promise so the reply is not blocked; failures reach only the server log. That is honest but not good — it belongs on a job queue.

---

## 5. Editing by voice, and why the model never sees an identifier

Adding `UPDATE`, `DELETE` and `COMPLETE` to a system driven by a small model over a noisy channel is the riskiest thing in this codebase. Whisper turns "Remind" into "Find" and "4 PM" into "4 AM", and hands-free mode has no confirmation step.

**The model returns a target described in the user's own words — "the gym one", "the previous note" — never a row id.** `src/lib/server/resolve.ts` finds the row. A model that cannot name a row cannot be induced to name the wrong one.

Scoring is deliberately boring and explainable: exact title 100, title-contains 80, then token overlap, with body text worth a third of a title match — because when you say "delete the dentist one" you need to be able to predict what goes. Near-ties return `ambiguous` and the assistant asks instead of guessing.

Three safety rules, each earned:

- **Destructive resolution is stricter.** A non-destructive "the last one" may fall back to recency; a delete may not. If the description matches nothing, nothing is deleted.
- **The kind comes from the utterance, not the model.** "the note" / "my goal" is read by regex and overrides the model's guess. Without this, "delete the note about no regrets" deleted an unrelated *task* — observed, and the reason the override exists.
- **Deletes are undoable.** The delete returns a snapshot; the activity row offers *Undo*. The snapshot round-trips through the client, so it is re-validated server-side and written under the session's user id, never one supplied in the body.

---

## 6. Calendar synchronisation

Two APIs, one internal model. `CalendarEvent` is the app's own model; a provider sync writes *into* it rather than replacing it, so every read path stays provider-agnostic. Google Tasks is a separate API from Calendar Events, so rows carry `googleTaskListId` and the sync branches on it.

Google is called over plain `fetch` — no `googleapis` dependency. All base URLs are indirected through one environment variable, which is the seam that lets the integration harness point the *unmodified* engine at a stand-in.

### Two connection flows

- **Authorization code** (needs the client secret) — yields a refresh token, so sync survives indefinitely. The callback refuses to create an account when Google returns no refresh token, rather than creating one that dies silently in an hour. State is bound to the user id, so a session change mid-flow is rejected.
- **Browser-granted session** (no secret) — the access token is opaque, so every property is read back from Google's tokeninfo endpoint, and the audience is checked against our client ID to block token substitution. Stored with a null refresh token, which the schema documents as the marker for "session only"; the UI labels the account accordingly.

### Ordering, and why it matters

`pull → pullTasks → push → reap`. Pull runs first so that conflicts and unlinks discovered remotely are already known when push consults them — otherwise push would immediately undo a deletion observed seconds earlier in the same run.

`decide()` in `reconcile.ts` is a pure function, unit-tested independently of any network: no prior agreement means push; one-sided change wins; both sides changed is a **reported conflict**, resolved by timestamp with ties going to the remote, on the reasoning that a human editing in Google Calendar is more deliberate than a local autosave.

Echo suppression: every event we push carries a private marker naming its originating task. On the way back, a marked event updates the task and never becomes a second `CalendarEvent`. Without this a pushed task appears on the calendar twice.

`markSynced` uses raw SQL — `SET "syncedAt" = "updatedAt"` — on purpose. Going through Prisma's `update()` would fire `@updatedAt` and push `updatedAt` past `syncedAt` in the same statement, making every synced row look permanently dirty.

### Provenance needs its own column (DEF-01)

The defect worth understanding.

Cancelling an event in Google left the row in Life OS. The pull path read a non-null `syncedAt` as "this row carries local intent, so unlink rather than delete" — a guard meant to stop a Google-side tidy-up destroying an event the user created here. But `syncedAt` is stamped on every mirror the instant it is first pulled in, so it was non-null for pure mirrors too and the guard fired for all of them.

`syncedAt` answers *has this ever synced*, not *does the user own this*, and no column carried the second question.

So provenance got its own: `CalendarEvent.mirrored`, set true only on the two pull-**create** paths. Deliberately not on the update path — that also runs for our own pushed events coming back around, and marking those as mirrors would reintroduce the bug from the other side.

Both tombstone branches now call one predicate, `carriesLocalIntent()`, which treats a row as locally owned if it did not originate remotely, **or** if it is a mirror holding an edit made here that has not reached the provider yet. Unlinking clears the flag: a row with nothing left to mirror is an ordinary local event from then on. Existing rows default to `mirrored = false`, which errs the safe way — a pre-existing mirror is unlinked rather than deleted, never the reverse.

The distinction was untested in *both* directions, which is how it survived. Five assertions now cover it, taking the integration suite from 30 checks to 35.

---

## 7. Reminder calls

Two minutes before a calendar event starts, the phone rings and speaks the event name. It is the one part of the system a screen recording cannot fake.

### The sweep

`src/instrumentation.ts` runs an interval in the server process. For a single-instance, self-hosted deployment that is the honest fit: it starts with `npm run dev`, needs no external scheduler, and dies with the process. A global singleton guards it, because Next re-runs the boot hook on hot reload and without that the intervals stack up — one call per surviving timer.

The sweep never dials about the past, which matters after a restart backlog, and skips all-day events, which "start" at local midnight.

**Claim, then dial.** Each event is claimed with a compare-and-swap on `reminderCalledFor` before the call is placed; a concurrent sweep sees zero rows affected and backs off. Storing the *start time* rather than a boolean is what makes a rescheduled event earn a fresh call automatically. A dial failure leaves the claim standing — deliberate, because a reminder is worthless a minute late and retrying against a real phone line is worse than a missed call.

The whole tick is wrapped in a try/catch, because a throw would kill the interval and silently end all future reminders — the one failure mode worth swallowing.

### The webhook is public, so it is signed

Twilio must fetch the TwiML over the internet and carries no session, so `/api/calls/twiml` is exempt from the auth gate. Every request instead carries an HMAC-SHA256 over the spoken message, keyed on `AUTH_SECRET` and compared in constant time. Without a valid signature the route renders an empty document and says nothing about why — a world-reachable endpoint should not be a free megaphone.

The signature uses Web Crypto rather than `node:crypto`, because this module is reachable from `instrumentation.ts`, which Next also compiles for the edge runtime, where a `node:` import fails the entire build.

**The message is packed as base64url**, and this is not cosmetic. Twilio rewrites the URL before fetching it and decodes percent-escapes on the way, so a `%26` arrives as a bare `&` and truncates the parameter mid-sentence. Every event named "Design & Review" failed — and the failure looked like an unreachable server. base64url's alphabet has nothing a query-string parser can corrupt.

### The tunnel

The app runs on localhost; Twilio needs a public URL. When telephony is configured and no TwiML URL is set, the server starts a `cloudflared` quick tunnel at boot and publishes the result into the environment, which is all the wiring the rest of the code needs. It never rejects — a missing binary, a spawn error or a timeout resolves to "no tunnel", and calls still ring, just without naming the event.

URL detection scans both stdout and stderr, because which stream cloudflared announces on varies by version, and it explicitly ignores `api.trycloudflare.com`: cloudflared prints its own control-plane endpoint on startup, and a naive regex match sent every call to a host that knows nothing about us. That one is pinned by a regression test.

---

## 8. Voice

The API contract is **OpenAI-compatible**, which means `faster-whisper-server` and OpenAI's hosted Whisper are interchangeable without touching the route handler.

### Segmentation is a pure state machine

`src/lib/voice/utterance.ts` is a state machine over `(level, timestamp)` and nothing else — deliberately decoupled from the AudioContext so the timing rules are testable without a microphone. A door slam is too brief to open an utterance; an "um…" is too brief to close one; hysteresis between the start and sustain thresholds stops breathing at the boundary from flapping the state; and a 30-second cap segments a monologue rather than dropping its tail. Levels are RMS, not peak, because peak reacts to every transient.

### One recorder per utterance, re-transcribed whole

Live text is produced by re-transcribing the whole utterance-so-far, never by stitching chunks. Two reasons: a `MediaRecorder` puts container headers only in its first chunk, so a middle slice is undecodable; and Whisper needs surrounding context, so independently-decoded slices garble every boundary.

Interim transcripts are **built but off by default**, behind `WHISPER_FAST_MODEL`. A pass on the default `small` model takes 2–7 seconds on CPU — longer than most sentences — so partials would arrive stale, visibly correct themselves, and starve the final pass. Browser `SpeechRecognition` was rejected outright: Brave ships the object so a naive feature-detect reports it as supported, but it errors `network` because Brave ships without Google's speech backend.

### Filters, because dictation mishears

On near-silence the local model emits stock phrases — "Thank you for watching. Please subscribe." A whole-string filter let that through and it was filed as a task called *Subscribe*. Transcripts are now rejected when *every* sentence is boilerplate, and when three or more sentences are identical.

The sign-off is matched **per sentence, anchored**, never as a substring: "that'll be all" ends the session, but "that'll be all I need from the shop" is a shopping list. A multi-sentence utterance stops only if every sentence is a sign-off, so "That's it. Also remind me to call Sam" still executes.

---

## 9. Database design

### The Task table is heavier than typical

Tasks carry recurrence (`rrule`), hierarchy (`parentId`), goal linkage, external sync (`externalId`, `calendarAccountId`, `syncedAt`), provenance (`source`) and scheduling. The breadth is intentional: keeping tasks as the central atom — rather than separate `Reminder`, `Event` and `Habit` tables — means the extractor has one target type to learn and the UI has one rendering pipeline.

Recurrence is RFC 5545 RRULE strings, not a custom schema, so future occurrences can be generated at read time without materialising rows.

### Memory and pgvector

Prisma does not type the `vector` type, so the column is declared `Unsupported("vector(768)")` and queried with parameterised raw SQL. 768 is correct for `nomic-embed-text`; changing the embedding model without changing the schema breaks every insert at the database level.

### Time is a column, not an afterthought

`DailyBriefing.forDate` is a true `DATE`. It used to be written from server-local midnight, so any server east of UTC truncated to the previous calendar day and the daily dedupe key drifted. Day boundaries, "due today", and the fortnight window all resolve through `lib/time.ts` in the user's zone.

### Everything degrades

`lib/db.ts` never throws on import: with no `DATABASE_URL` it returns an in-memory store with the same surface. `lib/env.ts` returns a capability report rather than validating-and-exiting. The result is that no missing optional dependency can prevent the application from booting — it reports what is missing on the Settings screen instead.

---

## 10. Frontend conventions

**Server Components by default.** Pages that render lists from Prisma are server components; interactive widgets are explicit client islands. Server fetches, serialises props, client takes over.

**Optimistic updates.** The task store snapshots, patches locally, and reverts if the API fails. This is the difference between "snappy" and "an AI app that feels slow even though the model is fast."

**Design tokens, no shadcn install.** Tokens are HSL CSS variables consumed by Tailwind. The primitives are written in-tree rather than pulled in, because the design language diverges from shadcn defaults — warm whites and graphite darks rather than slate.

Pairing an italic serif display face with a neutral sans is the single most distinctive choice in the design, and it is what stops Life OS looking like every other app of its kind.

**Motion is sparing** — list enter/exit, progress fill, step transitions. No hover micro-interactions. The vibe is calm.

One React-specific defect worth recording: `reactStrictMode` deliberately double-invokes state updaters to expose impurity, and `submit()` was being called inside one — so every dictated sentence was sent twice.

---

## 11. What this codebase deliberately doesn't do

- **No agentic loops.** The model is not asked to call tools and decide what to do next. It produces structured output; the application executes it. Faster, more reliable, easier to debug — and it is what makes the "no identifiers" rule in §5 enforceable.
- **No streaming.** Replies for the common intents are templated and one sentence long. There is nothing to stream.
- **No client-side inference.** WebGPU is interesting and not yet stable enough here.
- **No drag-and-drop calendar.** When scheduling is added it will be by dictation — "move my gym session to Thursday" — rather than mouse acrobatics.

---

## 12. Where to extend

| You want to… | Touch this |
| --- | --- |
| Add an intent type | `ai/prompts.ts` (schema), `validation.ts` (Zod), `ai/router.ts` (dispatch), `server/actions.ts` (side effect) |
| Add an LLM provider | Wrap it behind the `ollamaChat` interface, then env-switch in `extractor.ts` / `planner.ts` |
| Add Outlook | A second adapter alongside `calendar/google.ts`; `CalendarProvider` is already an enum for this reason |
| Answer `QUERY` from the database | `router.ts` — the recall layer in `ai/memory.ts` is written and queryable, and is the intended source |
| Move planning off the request thread | `server/actions.ts` and `/api/ai/plan-goal` — both call the same `planGoal()` |
| Run more than one instance | Move the body of the tick in `instrumentation.ts` behind an authorised route; it already claims events safely |
| Add push notifications | A `PushSubscription` model, a subscribe route, and a worker beside the reminder sweep |

The boundaries are drawn so that each of these is additive rather than invasive.

---

## 13. Honest limitations

- **Provider tokens are stored in plaintext.** Encrypting them at rest is the first item on the roadmap.
- **Rate limiting is per-process and in-memory.** It does not hold across replicas or survive a restart.
- **The reminder sweep is per-process.** Safe under concurrency, but not correct across instances.
- **Goal planning from the chat path is fire-and-forget.** Failures reach only the log.
- **Semantic recall is written but not read.** Every chat turn pays an embedding round trip and an unindexed vector scan whose result is not yet used.
- **`QUERY` does no retrieval.** "What's due tomorrow?" is currently answered by the model rather than the database.
- **The HTTP smoke harness is obsolete** — it predates the auth layer and does not sign in (DEF-02).
- **English only.** The prompts and the deterministic parser are English, though dictation offers other languages.
- **Google Testing-mode constraints apply.** While the OAuth client is unverified, only listed test users may grant calendar scopes, and refresh tokens expire after seven days. Google policy, not an application defect.
