# Life OS

> An AI-native personal operating system for tasks, goals, notes and calendar. Type or speak one ordinary sentence — Life OS works out the structure.

Built around a single idea: the user should not have to translate an intention into the tool's vocabulary before the tool will accept it. You say what is on your mind; the system decides whether it is a task, several tasks, a goal, a note or an instruction to change something that already exists, fills in the due date, priority, category and recurrence rule, and writes a real row to a real database. A goal stated in one line is decomposed into ordered milestones with scheduled tasks beneath them.

Voice works the same way, without a press-to-talk button: it listens continuously, acts on each sentence as you finish it, and stops when you say "that'll be all".

Every piece of inference runs on your own hardware by default — Gemma 3 through Ollama for understanding, faster-whisper for speech, Postgres with pgvector for memory. The default configuration makes no outbound AI request and costs nothing per capture.

---

## Quick start

Two environment variables are required: `DATABASE_URL` and `AUTH_SECRET`. Everything else is optional, and each optional value's absence disables exactly one capability. There is no configuration in which the application fails to boot.

```bash
# 1. Install
npm install                # postinstall runs `prisma generate`

# 2. Configure
cp .env.example .env
npx auth secret            # generates AUTH_SECRET and writes it into .env

# 3. Database — Postgres 16 with pgvector
docker compose up -d postgres
npx prisma db push         # creates the schema and the vector/pgcrypto extensions

# 4. Run
npm run dev                # http://localhost:3010
```

Open the app, choose **Sign up**, and create an account with an email address and a password of at least eight characters. At this point everything works: with no model server running, a deterministic parser still handles dates, categories and recurrence.

Set your timezone in **Settings → Profile** before capturing anything. Every relative date — "tomorrow evening", "this Friday at 5pm" — resolves in the timezone on your account, not your browser's.

### Optional: the local AI stack

This is what makes capture feel intelligent rather than merely mechanical.

```bash
docker compose up -d ollama whisper
docker exec lifeos-ollama ollama pull gemma3            # or gemma3:1b on a laptop
docker exec lifeos-ollama ollama pull nomic-embed-text  # 768-dim embeddings for memory
```

**Settings → AI services** reports whether each one is reachable, and whether the configured model is actually pulled.

### Optional: Google sign-in and Calendar

These are two separate things, and confusing them is the usual source of failure.

- **Signing in with Google** needs only `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. A client ID is public by design — Google Identity Services hands the browser a signed ID token, which is verified against Google's public keys. No secret is involved.
- **Two-way calendar sync that outlives the current session** additionally needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, because Google only issues refresh tokens to the authorization-code flow.

With just the public client ID you can still connect a calendar for the current browser session; the interface labels it as such. `npm run check:google` diagnoses the configuration. Full setup steps, including the two URL boxes people mix up, are in `.env.example`.

### Optional: reminder phone calls

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`, leave `TWILIO_TWIML_URL` empty, and install `cloudflared`. The server opens a quick tunnel at boot and fills the URL in itself. Then save your number on the Today page. Two minutes before a calendar event starts, the phone rings and speaks the event name.

### Optional: demo data

```bash
npm run db:seed            # seeds the most recently created account, or SEED_USER_ID=<id>
```

### Try it

> "Remind me to submit the capstone report this Friday at 5pm"
> "Take vitamin B12 every 3 days"
> "Help me prepare for GATE in 4 months"
> "Mark the gym task done"
> "The previous note should say t-shirt idea, not teacher idea"

---

## What's in the box

```
src/
├── middleware.ts                 # Auth gate. Everything except /, /login, /signup,
│                                 #   /api/auth/* and the HMAC-signed /api/calls/twiml
├── instrumentation.ts            # Boot hook: the once-a-minute reminder sweep + tunnel
│
├── app/                          # Next.js 15 App Router
│   ├── page.tsx                  # Landing
│   ├── login/ · signup/          # Email+password and Google sign-in
│   ├── (app)/                    # Authenticated shell
│   │   ├── dashboard/            # Briefing, quick capture, today, calendar, goals
│   │   ├── assistant/            # Conversational chat + hands-free voice
│   │   ├── calendar/             # Fortnight strip and month grid
│   │   ├── notes/                # BlockNote editor with images and backlinks
│   │   ├── goals/                # Goal list and milestone detail
│   │   ├── settings/             # Profile, connected calendars, AI health, account
│   │   └── onboarding/
│   └── api/                      # 28 route handlers
│       ├── auth/[...nextauth]/   #   Auth.js handler
│       ├── auth/signup/          #   Registration (Auth.js has none for credentials)
│       ├── ai/                   #   chat · extract · plan-goal · briefing · health/*
│       ├── calendar/             #   google/{connect,callback,session} · sync
│       │                         #   events · events/[id] · accounts/[id]
│       ├── calls/twiml/          #   Signed TwiML spoken by the reminder call
│       ├── voice/transcribe/     #   Whisper gateway
│       ├── tasks/ · goals/ · notes/ · notes/images/ · events/ · me/ · undo/
│
├── components/
│   ├── ui/ · layout/ · landing/  # Primitives, shell, marketing page
│   ├── auth/                     # Sign-in form, Google button, calendar grant
│   ├── assistant/ · voice/       # Chat, hands-free dictation, recorder
│   ├── calendar/                 # Fortnight, month, event dialog, connected accounts
│   ├── dashboard/                # Briefing, quick capture, today, reminder calls
│   ├── goals/ · notes/ · tasks/
│
├── lib/
│   ├── auth.ts                   # Auth.js v5: Google ID token + email/password
│   ├── auth/google-id-token.ts   # Verifies a GIS token against Google's public keys
│   ├── session.ts                # currentUser() — the one place "who is this" is read
│   ├── db.ts                     # Prisma singleton, in-memory fallback
│   ├── env.ts                    # Capability detection. Never throws
│   ├── time.ts                   # Timezone-correct day boundaries and parsing
│   ├── queries.ts                # Query shapes shared by server components and routes
│   ├── validation.ts             # Zod schemas — strict, at the HTTP boundary
│   ├── ai/
│   │   ├── router.ts             #   recall → extract → act → remember → reply
│   │   ├── extractor.ts          #   Gemma + a deterministic parser, reconciled
│   │   ├── fallback-parser.ts    #   Runs with no model at all
│   │   ├── schema.ts             #   Lenient coercion, at the model boundary
│   │   ├── planner.ts · prompts.ts · memory.ts · ollama.ts
│   ├── calendar/
│   │   ├── google.ts · google-tasks.ts   # Calendar v3 and Tasks v1, via fetch
│   │   ├── sync.ts               #   pull → pullTasks → push → reap
│   │   ├── reconcile.ts          #   Pure conflict arbitration, unit-tested
│   │   └── tokens.ts · link.ts
│   ├── calls/
│   │   ├── reminders.ts          #   The sweep. Claims each event before dialling
│   │   ├── twilio.ts · sign.ts · tunnel.ts
│   ├── voice/
│   │   ├── utterance.ts          #   Segmentation as a pure state machine
│   │   └── whisper.ts · use-dictation.ts
│   ├── server/
│   │   ├── actions.ts            #   The only writer
│   │   ├── resolve.ts            #   "the gym one" → a row, by explainable scoring
│   │   └── ratelimit.ts
│   └── __tests__/                # 196 tests in 16 suites
│
└── stores/                       # Zustand: assistant, tasks, calendar-events, capture, ui

prisma/
├── schema.prisma                 # 17 models, 9 enums, pgvector + pgcrypto
└── seed.ts · seed-data.ts

scripts/
├── test-calendar-sync.ts         # 35 integration checks against a stand-in Google
├── mock-google.ts                # That stand-in: sync tokens, pagination, tombstones
├── check-google.mjs              # Diagnoses Google configuration
├── smoke.mjs                     # HTTP smoke test — see "Known limitations"
└── e2e-notes.mjs · kill-servers.sh

docker-compose.yml                # postgres+pgvector, ollama, whisper
Dockerfile                        # Multi-stage production image
```

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 App Router, React Server Components, Server Actions |
| Language | TypeScript, strict mode |
| Database | PostgreSQL 16 with pgvector and pgcrypto |
| ORM | Prisma 5 — 17 models, 9 enums |
| Auth | Auth.js v5 (NextAuth). Email/password with bcrypt cost 12, and Google via a verified Identity Services ID token. JWT sessions |
| LLM | Gemma 3 through Ollama, JSON mode, validated by Zod. With no model, a deterministic chrono-node parser handles dates, recurrence and categories |
| Embeddings | `nomic-embed-text`, 768 dimensions, stored as `vector(768)` and queried by raw cosine SQL |
| Voice | `faster-whisper-server`, behind an OpenAI-compatible contract |
| Calendar | Google Calendar v3 and Google Tasks v1, over `fetch` — no `googleapis` dependency |
| Telephony | Twilio Programmable Voice, over an HMAC-signed TwiML webhook |
| State | Zustand, with optimistic patch/revert |
| Editor | BlockNote |
| Styling | Tailwind CSS with in-tree primitives and custom design tokens |
| Motion | Framer Motion |
| Dates | date-fns, chrono-node, rrule |

See `ARCHITECTURE.md` for why each of these, and `CHANGES.md` for the defects found along the way.

---

## Development

```bash
npm run dev            # dev server on :3010
npm run build          # prisma generate && next build
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test:unit      # 196 tests in 16 suites
npm run test           # typecheck + unit
npm run test:calendar  # 35 integration checks (needs DATABASE_URL + Postgres)
npm run check:google   # diagnoses the Google client configuration
npm run db:push        # push schema without a migration file
npm run db:migrate     # create and apply a migration
npm run db:studio      # Prisma Studio
npm run db:seed        # demo data
```

### Testing

| Command | Covers | Result |
| --- | --- | --- |
| `npm run typecheck` | The whole codebase | Clean |
| `npm run lint` | The whole codebase | Clean |
| `npm run test:unit` | Utterance timing, sign-off matching, target resolution, extraction coercion, RRULE normalization, timezone arithmetic, conflict arbitration, Google ID token verification, reminder claiming, TwiML signing | 196 pass |
| `npm run test:calendar` | The real sync engine against a stand-in Google API and a real Postgres — sync tokens, pagination, tombstones, echo suppression, conflict arbitration, provenance, 410 recovery, token refresh | 35 pass |

`npm run test:calendar` creates everything under a throwaway user and removes it again in a `finally`, so it is safe against a development database. It exits with a skip message if no Postgres is configured.

### Known limitations of the test suite

Stated here rather than left to be discovered.

- **The HTTP smoke harness is obsolete (DEF-02).** `scripts/smoke.mjs` predates the authentication layer and does not sign in, so its checks now return 401. They are harness failures, not product defects — and incidentally evidence that the auth gate works. Recovering it means teaching it to sign in first.
- **There is no component test layer.** Interface behaviour was validated by driving a real browser, which is real evidence but is not repeatable in CI. This is the largest single gap.
- **Line coverage is not measured.** The suite targets identified risk rather than a coverage target. The figures above are test counts, not coverage percentages.
- **Extraction accuracy is observed, not benchmarked.** No labelled evaluation set exists yet.
- **Google is tested against a stand-in.** The mock implements the API surface the engine uses, but cannot reproduce undocumented live behaviour, quota effects or latency. Google Tasks has unit coverage only — the mock does not implement `/tasks/v1`.
- **Load and concurrency are untested.**

---

## Deployment

The app is a single container.

```bash
docker build -t lifeos .
docker run --env-file .env -p 3010:3010 lifeos
```

- **App** — Cloud Run, Fly.io, Railway, Render or your own VPS. Set `APP_URL` and `AUTH_URL` to the production URL.
- **Database** — Neon, Supabase, or any managed Postgres with the `vector` extension.
- **Ollama** — a machine with a GPU, on the same network. For higher throughput consider vLLM or a hosted gateway.
- **Whisper** — `faster-whisper-server` is fine on CPU for occasional captures; GPU for scale.

### Run one instance

Two things are per-process and do not hold across replicas:

- **Rate limiting** is an in-memory `Map`. It does not survive a restart and is not shared between instances.
- **The reminder sweep** runs on an interval inside the server process (`src/instrumentation.ts`). Each instance would start its own tunnel and its own sweep. The sweep itself is concurrency-safe — it claims each event in the database with a compare-and-swap before dialling — so the fix is to move the body behind an authorised route and drive it from a real scheduler.

---

## Security

- Every route except `/`, `/login`, `/signup`, `/api/auth/*` and `/api/calls/twiml` requires a session. Pages redirect to `/login` with a `callbackUrl`; API routes return 401.
- Passwords are stored only as bcrypt hashes at cost 12. Sign-in failures are indistinguishable from one another, and a duplicate signup returns the same message whether the existing account has a password or is Google-only, so neither endpoint enumerates accounts.
- A Google ID token is verified against Google's published keys, with the audience and nonce checked, and unverified email addresses refused.
- Every Prisma query filters by `userId`, and every `[id]` route resolves through `findFirst({ where: { id, userId } })` — returning **404, not 403**, so the existence of another user's row does not leak.
- `/api/calls/twiml` is world-reachable by necessity: Twilio has no session. Every request must carry an HMAC-SHA256 over the spoken message, keyed on `AUTH_SECRET` and compared in constant time. Without a valid signature the route renders an empty document.
- Google calendar consent is separable from identity — provider tokens live on `CalendarAccount`, so calendar access can be revoked without touching the account.
- Rate limits are cost-tiered: goal planning 5/min, calendar sync 10/min, briefing 10/min, transcription 12/min, chat and extraction 30/min.
- No `dangerouslySetInnerHTML` anywhere.

**Known:** provider access and refresh tokens are stored in plaintext `text` columns. Encrypting them at rest is the first item below.

---

## Roadmap

- [ ] Encrypt `CalendarAccount` tokens at rest
- [ ] Teach `scripts/smoke.mjs` to sign in, and restore it to CI (DEF-02)
- [ ] A component test layer, and coverage instrumentation
- [ ] A labelled evaluation set for extraction accuracy
- [ ] Move goal planning and briefing generation onto a job queue (pg-boss or BullMQ)
- [ ] Drive the reminder sweep from a real scheduler so the app can run more than one instance
- [ ] Wire semantic recall into the conversational reply and into a "search my notes" panel — the embeddings are written and queryable, but the retrieval result is not yet used
- [ ] Answer `QUERY` intents from the database rather than from the model
- [ ] Outlook calendar, against the existing `CalendarProvider` enum
- [ ] Push notifications via Web Push, as a quieter alternative to a phone call
- [ ] Mobile-first PWA shell with a share target

---
