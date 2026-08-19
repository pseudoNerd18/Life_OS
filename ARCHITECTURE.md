# Architecture

This document explains the engineering decisions behind Life OS. The README covers _what_ is here; this covers _why_.

---

## 1. The core insight

Productivity tools fail because they ask the user to think like the tool. Notion makes you decide whether something is a page or a database row. Calendar apps make you decide whether something is an event or a task. Todoist asks you to fill in priority, label, due date, and project before you've even finished the thought.

Life OS rejects that framing. The user types or speaks a sentence. The system decides what it is. Specifically:

- **Intent classification** is performed by Gemma in the request path.
- **Date and time inference** is performed in two passes (Gemma + chrono-node) so the model's date suggestions are validated and fall back gracefully.
- **Categorization, priority, recurrence** are inferred from the same prompt — one call.
- **Goals trigger a second pass** — the planner — which decomposes the goal into milestones and recurring tasks.

This is the whole product philosophy: one sentence, one round trip to the model, structured rows in the database.

---

## 2. System diagram

```
                     ┌──────────────┐
                     │   Browser    │
                     │  (Next.js)   │
                     └──────┬───────┘
                            │ HTTPS
                            ▼
              ┌──────────────────────────┐
              │       Next.js 15         │
              │  App Router · Edge/Node  │
              ├──────────────────────────┤
              │  middleware   (cookie)   │
              │  /api/ai/*    (router)   │ ─────┐
              │  /api/voice/* (whisper)  │      │
              │  /api/{tasks,goals,…}    │      │
              └──────┬───────────────────┘      │
                     │                          │
        ┌────────────┴───────────┐              │
        ▼                        ▼              │
  ┌──────────┐            ┌──────────────┐      │
  │ Postgres │◄─Prisma───►│  AI Router   │──────┘
  │ pgvector │            └──┬───────┬───┘
  └──────────┘               │       │
                             ▼       ▼
                        ┌────────┐  ┌──────────────────┐
                        │ Ollama │  │ faster-whisper-  │
                        │ Gemma  │  │ server (or       │
                        │ nomic  │  │ OpenAI Whisper)  │
                        └────────┘  └──────────────────┘
                             ▲
                             │
                       (optional, by env)
                             │
                     ┌───────┴────────┐
                     │  Claude / GPT  │
                     │  reasoning     │
                     └────────────────┘
```

Every piece except the optional reasoning escalation runs on machines you control.

---

## 3. The AI orchestration pipeline

Single source of truth: `src/lib/ai/router.ts`.

### Stage 1: Memory recall (`recallSimilar`)

When a user sends a message, we embed it with nomic-embed-text and cosine-search the user's `Memory` rows. The top-k results aren't injected into the extraction prompt directly (extraction is intentionally context-poor for stability), but they're available to the conversational reply step and to UI affordances ("I noticed you mentioned X yesterday — should I link this to it?").

The decision to keep memory **out** of the extraction prompt is deliberate. LLMs tend to over-fit to retrieved context and produce ambiguous or wrong structured output. We sacrifice some recall in favor of more deterministic JSON.

### Stage 2: Intent extraction (`extractIntent`)

Single Ollama call to Gemma with `format: "json"` and a tight system prompt (`prompts.ts: INTENT_EXTRACTION_SYSTEM`). The prompt:

- Defines a strict schema.
- Lists seven inference rules (date parsing, RRULE generation, category mapping, etc.).
- Forbids prose around the JSON.

The result is validated by Zod (`extractedIntentZ`). On failure we attempt substring recovery (`{ ... }`), then return `UNKNOWN` if even that fails.

**Why two passes for dates.** The model is good at producing plausible-looking ISO timestamps but occasionally drifts (wrong year, off-by-one timezone). We post-process with chrono-node on the original user string. If the model's date is invalid or absent and chrono finds one, we substitute. If both produce a date, we trust the model. This gives a noticeable robustness lift without a second LLM call.

### Stage 3: Side-effect execution (`src/lib/server/actions.ts`)

The router never writes to Postgres directly. It calls into `actions.ts` — pure functions that take `userId` plus structured input. This keeps the router free of Prisma imports and makes the action layer trivially callable from REST routes too (the manual "New goal" form uses the same `createGoalFromIntent` path).

### Stage 4: Memory write

For each created entity (task, goal, note) we embed a short description and store it in `Memory` with `kind` and `refId`. The `refId` lets us reverse-link memory rows back to their source entity when the user opens that entity later.

### Stage 5: Conversational reply

For the four common intents (CREATE_TASK, CREATE_TASKS, CREATE_GOAL, CREATE_NOTE) we return a templated reply — no LLM call. This saves ~300ms per turn and keeps the assistant's voice consistent. Only CHITCHAT and UNKNOWN go to the LLM for a free-form reply.

### Optional: reasoning escalation

Gemma is fast but not always strong enough for ambiguous multi-step requests. If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, the router can be extended to escalate (current code doesn't auto-escalate — it's left as a hook). The recommended trigger: `intent === "UNKNOWN" && message.length > 80`.

---

## 4. The voice pipeline

`src/lib/voice/whisper.ts` exposes a single function with two implementations switched by env. The crucial design choice: the API contract is **OpenAI-compatible** (multipart/form-data with a `file` field), which means `faster-whisper-server` and OpenAI Whisper are interchangeable without touching the route handler.

```
User taps Mic
   ↓
MediaRecorder (browser) → audio/webm Blob
   ↓
POST /api/voice/transcribe (multipart)
   ↓
whisper.transcribe() → text
   ↓
Returned to client → editable preview
   ↓
User clicks Confirm → POST /api/ai/chat with the transcript
   ↓
Standard AI router pipeline
```

The voice flow is **always preview-before-commit**. The user sees the transcription, can edit it, and the structured-extraction is performed at the chat step — not in the voice step. This matches the demo in the brief: record → transcribe → "Extract tasks" → review → save.

The browser-side audio meter (`VoiceRecorder` component) runs off a real `AnalyserNode` so the recording indicator pulses with actual mic input. Small detail, large polish dividend.

---

## 5. Calendar architecture

Two key design choices.

> **Status:** external sync is not wired up in v0.2. Dropping the auth layer
> took the Google OAuth flow with it (`lib/calendar/google.ts`,
> `lib/calendar/sync.ts`, `/api/calendar/*`). What follows describes the shape
> the schema still supports and what re-adding it should look like.

**Internal model, external mirror.** `CalendarEvent` is the app's own model and
works today — the dashboard widget, the 14-day view, and the combined
`/api/events` feed all read it. A provider sync would write into it rather than
replacing it, keeping every read path provider-agnostic.

**Scope separation.** A future sign-in should request only `openid email
profile`; calendar access belongs behind a separate, explicitly granted consent.
Provider tokens live on `CalendarAccount`, keyed
`@@unique([userId, provider, email])`, so calendar access can be revoked
without touching the account.

**Incremental sync.** Google's calendar API supports `syncToken` cursors that
return only changes since the last sync — hence `CalendarAccount.syncToken`.
Cancelled events come back with `status: "cancelled"` and the local mirror is
deleted. The first sync (no token) pulls 30 days back.

**Provider abstraction.** `CalendarProvider` is an enum (`GOOGLE`, `OUTLOOK`)
rather than a boolean precisely so a second adapter drops in against Microsoft
Graph without touching callers.

---

## 6. Database design

### The Task table is heavier than typical

Tasks carry many optional facets — recurrence (`rrule`), hierarchy (`parentId`), goal linkage (`goalId`, `milestoneId`), external sync (`externalId`, `calendarAccountId`), provenance (`source`), scheduling (`dueAt`, `startAt`, `durationMin`, `remindAt`). This bloat is intentional: keeping tasks as the central atom (rather than separate `Reminder`, `Event`, `Habit` tables) means the AI extractor has one target type to learn, and the UI has one rendering pipeline.

Recurrence is RFC 5545 RRULE strings, not a custom schema. We can generate next occurrences with `rrule` lib at read time without materializing future rows.

### Goals and Milestones

A goal is a long-horizon record. Milestones are ordered children (`orderIdx`). Tasks reference both `goalId` and `milestoneId`. When the planner runs, it deletes prior `GOAL_PLAN`-sourced tasks and milestones, then writes a fresh plan — but it preserves `MANUAL`-sourced tasks the user added themselves under that goal. The `source` enum on `Task` is the key piece of provenance that makes this safe.

### Memory and pgvector

Prisma doesn't natively type the `vector` type, so we declare `embedding Unsupported("vector(768)")` in the schema and use raw SQL for the cosine-similarity query. The schema gets `extensions = [vector, pgcrypto]` which Prisma 5 will create on `db push`/`migrate`.

768 dimensions is correct for `nomic-embed-text`. If you switch embedding models (e.g. `mxbai-embed-large` is 1024), update the schema accordingly.

### Conversations and Messages

Every chat turn is persisted. `Message.toolPayload` is a JSON column where we store the extracted intent — useful for replay, debugging, and any future fine-tuning data export.

### Why a cookie, not a session table

There is no auth. `middleware.ts` mints a random id into an httpOnly
`lifeos_uid` cookie on first request; `lib/session.ts` turns that into a `User`
row marked `isGuest: true`. No `Account`, `Session`, or `VerificationToken`
models — v0.2 removed all three along with Auth.js.

The identity write is an **upsert**, not find-then-create. A single first page
load fires several concurrent requests all carrying the same brand-new id;
find-then-create made them race, and every loser hit a unique-constraint error
on `id` and silently degraded to a phantom in-process guest whose writes had no
`User` row to point at.

The trade-off is explicit: whoever holds the cookie value *is* that user, and
there is no revocation. See §9.

---

## 7. Frontend conventions

### Server Components by default

Pages that render lists from Prisma are server components (e.g. dashboard, goals, calendar, notes). Interactive widgets (assistant chat, task row with optimistic updates, voice recorder) are client components with explicit `"use client"`. Server fetches data → passes serialized props → client takes over.

### Optimistic updates

The tasks store (`stores/tasks.ts`) snapshots state, applies the patch locally, then reverts if the API fails. This is the difference between "snappy" and "AI app that feels slow even though the model is fast."

### Design tokens, no shadcn install

Tokens live in `globals.css` as HSL CSS variables (`--background`, `--foreground`, `--primary`, etc.) and are consumed by Tailwind in `tailwind.config.ts`. The shadcn primitives are written in-tree (not pulled via `npx shadcn add`) because the project's design language diverges from shadcn defaults — warm whites and graphite darks rather than slate, plus priority/category accents.

Fonts are loaded via `next/font/google` to avoid layout shift:

- **Geist Sans** (body) — modern, technical, by Vercel
- **Geist Mono** (timestamps, code)
- **Instrument Serif** (display) — used italic for headings and "voice" moments. Pairing a serif italic display with a neutral sans is the single most distinctive aesthetic choice in the design; it's what stops Life OS from looking like every other shadcn app.

### Motion philosophy

Framer Motion is used sparingly: list item enter/exit, milestone progress bar fill, onboarding step transitions. We deliberately avoid micro-interactions on hover (the "wiggle on hover" pattern that plagues AI apps). The vibe is calm.

---

## 8. Performance & scaling notes

| Concern | Today | Future |
| --- | --- | --- |
| Goal planning blocks the request | Yes (fire-and-forget Promise) | Job queue (BullMQ on Redis or pg-boss) |
| Briefing generation | On-demand, cached per day | Cron pre-generates at user's local 6am |
| Calendar sync | On user request | Cron + Google push notifications via webhooks |
| AI rate limits | Per-user, 30/min | Tier by Pro/Free, configurable |
| Vector index | Default (no IVF/HNSW) | `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` once `Memory` exceeds ~10k rows |

The hot path (chat → extract → write task → reply) is one LLM call + one DB transaction. With `gemma2:9b` on a modest GPU this is sub-second.

---

## 9. Security

**There is no authentication.** This is a deliberate local-first trade-off, not
an oversight, and it is the thing to understand before exposing the app to
anything wider than localhost:

- Identity is a bearer token in disguise. Anyone who knows a `lifeos_uid` cookie
  value is that user, permanently — the ids are random 24-hex-char values and
  the cookie is `httpOnly` + `sameSite: lax`, but there is no rotation, no
  expiry beyond a year, and no revocation.
- Every route is open. No route returns 401; `currentUser()` simply creates an
  account if the cookie doesn't match one.
- What *is* enforced: every Prisma query filters by `userId`, and every
  `[id]` route resolves through `findFirst({ where: { id, userId } })`, so one
  guest cannot read or mutate another's rows even by guessing an id. It returns
  404, not 403 — no existence leak. `npm run smoke` asserts this.
- Rate limiting is in-memory and per-process, so it does not hold across
  replicas or survive a restart.
- No `dangerouslySetInnerHTML` anywhere.
- TipTap output is HTML; sanitize at render time if notes ever become shareable.
  Today the author is the only reader.

Before a real deployment: put it behind a network boundary you trust, or add an
auth layer. `User.isGuest` exists so a guest can be upgraded in place.

---

## 10. Cost optimization

Default config: $0 in API cost. Everything local.

When you escalate:

- **Embedding**: nomic-embed-text is local and free. Don't move to OpenAI text-embedding-3.
- **Extraction**: Gemma 3 / Llama 3.2 are sufficient. Use Claude Haiku as a cheap fallback if you must.
- **Reasoning**: Only escalate on `UNKNOWN` or messages over a length threshold. Claude Sonnet at $3/Mtoken in, $15/Mtoken out is reasonable for the ~1% of turns that need it.
- **Voice**: Local Whisper Small handles English well on CPU. Use Whisper Large or OpenAI's hosted API only for multilingual or long-form.

The architecture deliberately makes every cost lever per-env-var so you can A/B between local and hosted on the same deploy.

---

## 11. What this codebase deliberately doesn't do

- **No agentic loops.** The model isn't asked to call tools and decide what to do next. It produces structured output; we execute. This is faster, more reliable, and easier to debug.
- **No streaming responses.** Replies are short (one or two sentences) and deterministic for the common intents — there's nothing to stream. Streaming is a worthwhile future addition only if the optional reasoning escalation is enabled.
- **No client-side LLM.** Browser-based inference (WebGPU) is interesting but not yet stable enough for production. Server-side Ollama is the right place.
- **No drag-and-drop in calendar.** Yet. The 14-day strip is intentional minimalism — when we add scheduling, it'll be by dictation ("move my gym session to Thursday") rather than mouse acrobatics. That's a design choice, not a missing feature.

---

## 12. Where to extend

| You want to… | Touch this file |
| --- | --- |
| Add a new intent type | `src/lib/ai/prompts.ts` (schema), `validation.ts` (Zod), `router.ts` (dispatch), `actions.ts` (side effect) |
| Add another LLM provider | Wrap behind the `ollamaChat` interface in a new file, then env-switch in `extractor.ts` / `planner.ts` |
| Add Outlook calendar | Implement `CalendarProviderAdapter` in `lib/calendar/outlook.ts`, register in `adapterFor()` |
| Add push notifications | New table `PushSubscription`, new endpoint `/api/push/subscribe`, cron worker iterates notifications |
| Add agent actions (multi-step) | Move to streaming + tool-calling against Claude; keep extraction path as fast path |
| Add a "search my notes" feature | Use `recallSimilar` with `kinds: ["note"]` and render results |

The boundaries are deliberately drawn so each of these is additive, not invasive.
