# The Match — [CLAUDE.md](http://CLAUDE.md)

> **MANDATORY FIRST ACTION — NO EXCEPTIONS**
> Before answering ANY question, making ANY file changes, or starting ANY task:
> 1. Invoke the `roll-call` skill — it runs `tools/limitless-preflight.sh` and verifies the seven-tool stack
> 2. Read `wiki/index.md` for the page catalog
> 3. Do NOT skip these even if a context summary tells you to "continue where you left off"
> 4. Do NOT answer from active context alone. Verify against wiki pages first.

## What this project is

Golf companion app. Mobile-only PWA. React 19 + Vite + Tailwind v4 (client) · Express + Supabase (server) · Vercel.

## Limitless Stack participation

This project is a Limitless Stack project. See `.limitless-project.py` for the project manifest declaring which checks run, which NotebookLM notebooks back the wiki, and how this project syncs with the canonical at `/Users/matthewlavin/LimitlessStack`.

The-match's NotebookLM notebooks (created 2026-04-29):
- **Main bucket** (default route): `41e645a3-044d-452b-8e68-a21939e18799` — receives all wiki/*.md
- **Reminder bucket** (curated layer): `43a69b99-a0cb-4e9b-8bd2-5e9c09f95c6f` — receives CLAUDE.md + wiki/synthesis/claude-anti-patterns.md

## Mandatory contracts

### Hub vault + LimitlessStack canonical sync

This project's `tools/` is a deployed copy of the canonical at `/Users/matthewlavin/LimitlessStack/tools/`. Edits in either direction must be propagated to the other before the session closes — otherwise `install.sh` deploys old buggy versions to the next project. The sync check in `tools/limitless-preflight.sh` enforces this mechanically. See `wiki/synthesis/claude-anti-patterns.md` entry #14.

### NotebookLM routing-coverage

Every notebook returned by `notebooklm list` must appear in `NOTEBOOK_ROUTES`, `DEFAULT_ROUTE`, `REMINDER_NOTEBOOK_ID`, or `IGNORED_NOTEBOOKS` in this project's `.limitless-project.py` manifest. NotebookLM is account-wide — every project sees every notebook. Anything that belongs to ANOTHER project (Hub, future verticals) must be in this project's `IGNORED_NOTEBOOKS` so the orphan check stays quiet. See `wiki/concepts/notebooklm-workflow.md`.

### Four-tool lookup order

When answering questions or doing wiki work, use the tools in this order:
1. Read `wiki/index.md` first
2. If thin, run Pinecone semantic search via `tools/pinecone-search.py` (when Pinecone quota is not exhausted)
3. Deep research → query the project's NotebookLM notebook (`41e645a3...`)
4. File substantive answers back to `wiki/synthesis/`

## End-of-session checklist

Before closing any session that modifies wiki pages, CLAUDE.md, deliverables, or tools:
1. Update `wiki/log.md` with what changed
2. Commit + push the project repo (this `the-match` repo)
3. Run `python3.11 tools/notebooklm-wiki-refresh.py` if wiki/CLAUDE.md changed
4. Verify the refresh actually landed (`verify_failed: 0`)
5. Run preflight one more time — should be green except known accepted yellows
6. **If `tools/<anything>` was edited** — back-port to `/Users/matthewlavin/LimitlessStack/tools/` and commit/push that repo too. Sync check will fail next session if you forget.

## Stack

- **Client**: `client/` — React 19, Vite 6, Tailwind v4, Lucide icons
- **Server**: `server/` — Express 4, Node 22, pg (direct Supabase pooler)
- **API entry**: `api/index.js` re-exports the Express app for Vercel serverless
- **DB**: Supabase free tier. All tables prefixed `tm_`. Schema in `migrations/`.
- **Auth**: email + 4-digit PIN. JWT (90-day). No OAuth for now.
- **Deployment**: Vercel. `trust proxy: 1` is required (TLS terminated at edge).

## Design system

- Tokens in `client/src/design/tokens.css`. All colors via CSS vars (`--tm-*`).
- Palette: Augusta-at-night dark (`#070C09`), fairway green (`#2A7A38`), trophy gold (`#C9A040`).
- Mobile-first. Bottom tab nav. Touch targets ≥ 44px. Safe-area insets handled via CSS vars.
- Score colors: eagle = gold, birdie = blue, par = muted, bogey = orange, double+ = red.

## Feature status

FeatureStatusAuth (login/signup)✅ DoneHome dashboard✅ DoneEagle Eye (AI rangefinder)✅ DoneActive Round (GPS tracking)🔲 NextOuting (tournaments)🔲 NextBig Team Battle🔲 NextStats + handicap🔲 NextAI Caddie chat🔲 Next

## Local dev

```bash
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY
npm install
npm run dev            # starts both client (:5173) and server (:3010)
```

## Deploy to Vercel

1. Create Vercel project, link this repo.
2. Add env vars: DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY, CLIENT_ORIGIN, APP_BASE_URL.
3. `vercel --prod` or push to main.

## DB setup

```bash
psql $DATABASE_URL -f migrations/001_tm_initial.sql
```

## Code discipline

- Every changed line traces to a user request.
- No drive-by refactors of adjacent code.
- Mobile-first: test on iPhone viewport (390px) before considering desktop.
- Cold-start protection: keep the `/health` no-DB-gate and client 503 retry budget.

## Self-healing

The-match does not currently ship the self-healing pipeline. Phase: **none**. When ready, deploy per `/Users/matthewlavin/LimitlessStack/self-heal/README.md` (Phase 1: diagnostic only → Phase 2: full pipeline → Phase 3+: rollout).
