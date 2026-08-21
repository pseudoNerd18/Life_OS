# Life OS

> An AI-native operating system for tasks, goals, notes, and calendar. Type or speak naturally — Life OS does the structure.

Built around a simple idea: the user shouldn't translate intent into forms. They tell the assistant what's on their mind; the assistant figures out whether it's a task, a goal, a note, or a calendar event, fills in due dates, priorities, recurrence rules, and categories, and writes it to a real database. Voice works the same way — Whisper transcribes, the model extracts, the UI lets you review before commit.

The whole stack runs locally if you want it to. Gemma via Ollama for understanding, `faster-whisper-server` for voice, Postgres + pgvector for memory.

---

## Quick start

```bash
# 1. Install deps
npm install

# 2. Configure — DATABASE_URL is the only required variable
cp .env.example .env

# 3. Bring up Postgres (the only hard dependency)
docker compose up -d postgres

# 4. Create the schema
npx prisma db push

# 5. Run
npm run dev
```

Open `http://localhost:3010`. There is no sign-in — a guest account is minted
on your first visit and stored in a cookie.

### Optional: the local AI stack

The app runs without either of these; extraction falls back to a deterministic
parser and voice capture is simply unavailable.

```bash
docker compose up -d ollama whisper
docker exec lifeos-ollama ollama pull gemma3            # or gemma3:1b for a laptop
docker exec lifeos-ollama ollama pull nomic-embed-text  # embeddings for memory
```

Settings → AI health shows whether each one is reachable.

### Optional: demo data

```bash
npm run db:seed
```

Seeds tasks, a planned goal with milestones, notes, and calendar events into the
**guest account you're currently browsing with** (the most recently created
guest), so load the app in a browser first. Override with `SEED_USER_ID=<id>`.

### Try it

Type into the assistant or Quick Capture:

> "Remind me to go to the gym tomorrow evening"
> "Help me prepare for GATE in 4 months"
> "Take vitamin B12 every 3 days"

---

## What's in the box

```
src/
├── app/                          # Next.js 15 App Router
│   ├── page.tsx                  # Landing
│   ├── layout.tsx                # Root (fonts, theme, toast)
│   ├── globals.css               # Design tokens
│   ├── (app)/                    # App shell (no auth gate)
│   │   ├── layout.tsx            # Sidebar + guest-mode banner
│   │   ├── dashboard/            # Briefing + today + goals + events
│   │   ├── assistant/            # Conversational chat + voice
│   │   ├── calendar/             # 14-day combined view
│   │   ├── notes/                # TipTap rich editor
│   │   ├── goals/                # Goal list + milestone view
│   │   ├── settings/             # Profile, AI health, calendar
│   │   └── onboarding/           # 3-step welcome flow
│   └── api/
│       ├── ai/
│       │   ├── chat/             # Main conversational endpoint
│       │   ├── extract/          # Voice preview pipeline
│       │   ├── plan-goal/        # Generate milestones+tasks
│       │   ├── briefing/         # Morning briefing
│       │   └── health/{ollama,whisper}/
│       ├── voice/transcribe/     # Whisper gateway
│       ├── tasks/                # CRUD + [id]
│       ├── notes/                # CRUD + [id]
│       ├── goals/                # CRUD + [id]
│       ├── events/               # Combined task+event feed
│       └── me/                   # User profile
│
├── components/
│   ├── ui/                       # shadcn-style primitives
│   ├── layout/                   # Sidebar, Providers, Onboarding, Settings
│   ├── landing/                  # (reserved — landing inlined for now)
│   ├── assistant/                # Chat + composer
│   ├── voice/                    # MediaRecorder + meter
│   ├── tasks/                    # TaskRow
│   ├── notes/                    # Workspace + TipTap editor
│   ├── calendar/                 # CalendarView
│   ├── goals/                    # NewGoal, GoalDetail
│   └── dashboard/                # Briefing, QuickCapture, TodayTasks, etc.
│
├── lib/
│   ├── db.ts                     # Prisma singleton, in-memory fallback
│   ├── session.ts                # Guest-by-default current user
│   ├── env.ts                    # Capability detection (never throws)
│   ├── time.ts                   # Timezone-correct day boundaries
│   ├── queries.ts                # Query shapes shared by RSC + API routes
│   ├── utils.ts                  # cn(), date formatters
│   ├── validation.ts             # Zod schemas
│   ├── ai/
│   │   ├── ollama.ts             # Ollama client
│   │   ├── prompts.ts            # Extraction, planner, briefing system prompts
│   │   ├── extractor.ts          # Gemma + chrono-node date fallback
│   │   ├── planner.ts            # Goal → milestones + tasks
│   │   ├── memory.ts             # pgvector raw-SQL retrieval
│   │   └── router.ts             # Top-level orchestrator
│   ├── voice/whisper.ts          # OpenAI-compatible Whisper gateway
│   └── server/
│       ├── actions.ts            # DB mutations the AI router calls
│       └── ratelimit.ts          # In-memory rate limiter
│
├── stores/                       # Zustand
│   ├── assistant.ts              # Chat + voice state
│   ├── tasks.ts                  # Optimistic task store
│   └── ui.ts                     # Sidebar, command palette
│
└── middleware.ts                 # Primes the guest cookie; blocks nothing

prisma/
├── schema.prisma                 # 18 models, pgvector + pgcrypto extensions
└── seed.ts                       # Demo tasks, goals, notes, events

scripts/
└── smoke.mjs                     # End-to-end HTTP smoke test

docker-compose.yml                # postgres+pgvector, ollama, whisper
Dockerfile                        # Multi-stage Next.js image
```

---

## Stack

| Layer       | Choice                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| Framework   | Next.js 15 (App Router, Server Components, Server Actions)                      |
| Language    | TypeScript strict                                                               |
| Database    | Postgres 16 + pgvector + pgcrypto                                               |
| ORM         | Prisma 5                                                                        |
| Auth        | None — local-first. A cookie-scoped guest user is created on first visit          |
| LLM         | Gemma via Ollama (local), model name configurable. No model? A deterministic chrono-node parser handles dates, recurrence and categories |
| Embeddings  | `nomic-embed-text` (768-dim) via Ollama, stored as `vector(768)` in `Memory`    |
| Voice       | `faster-whisper-server` (local, OpenAI-compatible)                              |
| Calendar    | Internal `CalendarEvent` model only. Google/Outlook sync was removed in v0.2 with the auth layer — see CHANGES.md |
| State       | Zustand                                                                         |
| Editor      | TipTap with StarterKit, TaskList, Link, Placeholder                             |
| Styling     | Tailwind CSS + custom design tokens (no shadcn install step — primitives in-tree) |
| Motion      | Framer Motion                                                                   |
| Validation  | Zod                                                                             |
| Dates       | date-fns + chrono-node + rrule                                                  |
| Rate limit  | In-memory only, per-process (see the note in `lib/server/ratelimit.ts`)          |

See `ARCHITECTURE.md` for the why.

---

## Development

```bash
npm run dev          # Next dev server
npm run db:studio    # Prisma Studio (data browser)
npm run db:migrate   # Create + apply migration
npm run db:push      # Push schema (no migration file)
npm run typecheck    # tsc --noEmit
npm run lint
npm run db:seed      # demo data into the current guest account
npm run smoke        # end-to-end HTTP smoke test against a running dev server
```

### Smoke test

`npm run smoke` drives a running server over HTTP: every page, full CRUD on
tasks/goals/notes, cross-guest isolation, the natural-language pipeline, the
briefing's timezone handling, and graceful degradation when Ollama and Whisper
are absent. Ollama/Whisper checks report as skipped rather than failing.

```bash
npm run dev
npm run smoke                                  # or BASE_URL=http://localhost:3010 npm run smoke
```

### Adding/changing models

Set `OLLAMA_MODEL=gemma3:27b` (or `llama3.2`, `qwen2.5:14b`, etc.) and pull it inside the Ollama container:

```bash
docker exec lifeos-ollama ollama pull gemma3:27b
```

The extractor uses JSON mode where available and falls back to substring-extraction if the model adds prose around the JSON.

### Voice

Default is the local `faster-whisper-server` from docker-compose, set to `small` for CPU. For GPU + better quality, set `WHISPER__MODEL=Systran/faster-whisper-large-v3` and uncomment the GPU section. To switch to OpenAI: `WHISPER_MODE=openai`.

### Calendar

The `CalendarEvent` model, the dashboard widget and the 14-day view all work,
but nothing syncs into them yet: Google/Outlook OAuth was removed in v0.2 along
with the auth layer. `CalendarAccount` and the provider enum are still in the
schema, so re-adding a provider is a self-contained job — see the top of
CHANGES.md → "What still needs work".

---

## Deployment

The Next.js app is a single container. The reference deploy is:

- **App**: Cloud Run / Fly.io / Railway / Render / your VPS
- **Database**: Neon, Supabase Postgres, or any managed Postgres with the `vector` extension
- **Ollama**: A box with a GPU (preferably) — same network as the app. For higher throughput consider vLLM or a hosted gateway.
- **Whisper**: same — `faster-whisper-server` is fine on CPU for occasional captures, GPU for scale.

```bash
docker build -t lifeos .
docker run --env-file .env -p 3010:3010 lifeos
```

Set `APP_URL` to your production URL.

Two things to know before exposing this to a network: there is **no
authentication** — anyone holding a `lifeos_uid` cookie value is that user — and
rate limiting is per-process in-memory, so it does not hold across replicas.

---

## Roadmap

- [ ] Re-add calendar sync against the new session layer (Google first, then Outlook)
- [ ] Background job queue (BullMQ or pg-boss) — move goal planning + briefing off the request thread
- [ ] WebSocket / SSE channel for cross-device task sync
- [ ] Push notifications via Web Push + service worker
- [ ] Vector-search-powered "ask my notes" panel
- [ ] Smart rescheduling — when a task is missed, the planner shifts subsequent dependents
- [ ] Mobile-first PWA shell + share target (capture from iOS share sheet)
- [ ] Optional sign-in, upgrading a guest in place (`User.isGuest` already models it)
- [ ] Upgrade to Next 16 — three moderate advisories (postcss, sharp) are pinned behind that major
- [ ] Unit tests for `lib/time.ts` and the fallback parser; `npm run smoke` covers the HTTP surface only

---

## License

MIT.
