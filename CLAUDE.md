# The Match — [CLAUDE.md](http://CLAUDE.md)

> **MANDATORY FIRST ACTION — NO EXCEPTIONS**
> Before answering ANY question, making ANY file changes, or starting ANY task:
> 1. Invoke the `roll-call` skill — it runs `tools/limitless-preflight.sh` and verifies the seven-tool stack
> 2. Read `wiki/index.md` for the page catalog
> 3. Do NOT skip these even if a context summary tells you to "continue where you left off"
> 4. Do NOT answer from active context alone. Verify against wiki pages first.

## What this project is

Golf companion app. React 19 + Vite + Tailwind v4 (client) · Express + Supabase (server) · Vercel.

> **🎯 TARGET: NATIVE iOS APP — APP STORE SUBMISSION.**
> The Match is being built to ship as a **native iOS app on the Apple App Store** and must be
> ready for App Store **review and approval**. It is NOT "just a PWA." The web app is packaged
> into a native iOS shell and runs inside **WKWebView** (Apple's WebKit engine) on a real user's
> iPhone. Practical consequences every session must keep in mind:
> - **Runtime is WKWebView on modern iOS (target iOS 15+ → WebGL2 guaranteed).** There is no
>   user-controllable "browser." Never write browser-framed fallbacks/messages (e.g. "use a newer
>   browser") — they're nonsensical in a native app and look broken to reviewers.
> - **Every decision is an App Store decision:** native-feel UX, smooth 60fps, no broken/empty
>   states, proper iOS permission prompts (location, camera) with usage strings, privacy policy,
>   offline resilience, no dead links, and enough first-party functionality to clear Apple's
>   "minimum functionality" guideline (4.2). Build like a reviewer will scrutinize it.
> - The Vercel-hosted web app is still the dev/beta surface (Matt tests on his phone), but the
>   bar is **App-Store-ready**, not "good enough for a web demo."

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
2. **Refresh the trust anchors.** Re-read this `CLAUDE.md` end-to-end and update any feature-status tables, "current state" prose, "shipped vs next" lists, or DB-setup / migration counts to match what actually shipped this session. The trust anchor must describe reality — every Claude session reads it as ground truth, so silent staleness here propagates as confidently-stated wrong facts. Same for `wiki/index.md`: it must list every page that exists in `wiki/`. The preflight's semantic checks (index completeness, template-placeholder detection, overdue-TODO scan) catch the obvious cases — but only the writer of the session knows whether a status claim is still true.
3. Commit + push the project repo (this `the-match` repo)
4. Run `python3.11 tools/notebooklm-wiki-refresh.py` if wiki/CLAUDE.md changed
5. Verify the refresh actually landed (`verify_failed: 0`)
6. Run preflight one more time — should be green except known accepted yellows
7. **If `tools/<anything>` was edited** — back-port to `/Users/matthewlavin/LimitlessStack/tools/` and commit/push that repo too. Sync check will fail next session if you forget.

## Stack

- **Client**: `client/` — React 19, Vite 6, Tailwind v4, Lucide icons
- **Server**: `server/` — Express 4, Node 22, pg (direct Supabase pooler)
- **API entry**: `api/index.js` re-exports the Express app for Vercel serverless
- **DB**: Supabase free tier. All tables prefixed `tm_`. Schema in `migrations/`.
- **Auth**: email + 4-digit PIN. JWT (90-day). No OAuth for now.
- **Deployment**: Vercel (dev/beta surface). `trust proxy: 1` is required (TLS terminated at edge).
- **Shipping target**: packaged as a **native iOS app for the App Store** (WKWebView shell over the web app). Vercel is where it's developed/tested; the App Store build is the product. See the App Store callout at the top of this file.

## Design system

- Tokens in `client/src/design/tokens.css`. All colors via CSS vars (`--tm-*`).
- Palette: Augusta-at-night dark (`#070C09`), fairway green (`#2A7A38`), trophy gold (`#C9A040`).
- Mobile-first, **iPhone-native feel** (this ships to the App Store). Bottom tab nav. Touch targets ≥ 44px. Safe-area insets handled via CSS vars. No desktop-isms; design for a hand-held iPhone in a WKWebView.
- Score colors: eagle = gold, birdie = blue, par = muted, bogey = orange, double+ = red.

## Where to find current state

**Static feature tables drift.** This file used to keep a `## Feature status` table; it went a week stale during active development before anyone noticed (`Push notifications: 🔲 Next` was sitting there long after they shipped on 2026-05-05). Removed 2026-05-07 — the live source is the wiki.

For the current state of the-match, read these files in order:

- `wiki/log.md` — chronological, append-only. Every shipped feature, refactor, and fix lands here as a `## [YYYY-MM-DD] <op> | <label>` entry. The most recent entries are the most current state.
- `wiki/POST-LAUNCH-TODO.md` — deferred items from polish-pass sessions, with one-line context + next concrete step per item.
- `wiki/synthesis/` — closed audits and one-off plans (e.g., `audit-2026-04-29.md`, `match-page-completion-plan.md`). Historical record of multi-session work.

The preflight enforces this contract: it scans `wiki/*TODO*.md` for overdue deadlines and warns. It also walks `wiki/*.md` against `wiki/index.md` and warns on unindexed pages. If the preflight is green and you've read the most recent log entry + both TODO files, you have current state.

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

## Push & branch discipline

`main` auto-deploys via Vercel on push. **The rule depends on the launch phase — and the only question that matters is: where does the team actually test?**

**CURRENT PHASE: BETA — the team tests through the deployed `main`, not through branches.** So right now:

- **Build-verified work → commit to `main` and push. This includes app/feature code (`client/`, `server/`).** `main` IS the beta test environment, so the code has to be on `main` for Matt to test it on his phone. **Holding features on a branch blocks testing** — don't do it. Docs / wiki / marketing go to `main` too, always.
- **The gate: it must build clean AND lint clean** — run `npm --prefix client run build` + `npm --prefix client run lint` + `node --check` on changed server files before pushing. **`build` passing is NOT enough: Vite compiles undefined identifiers fine, then they ReferenceError on the device.** A clean `vite build` shipped `estimateAltFromPressure` (a server-only function called from client code) to the beta on 2026-06-06 → white error screen. The `lint` script runs ESLint `no-undef` (config in `client/eslint.config.js`) and catches exactly that class. Build + lint + check, then push. Never push broken code; it breaks the beta env for everyone.
- Branches are only for genuinely experimental/risky spikes you explicitly want to stage separately — not the default for normal feature work.

**AT LAUNCH (when `main` = live users), flip to the strict rule:** untested runtime code goes on a feature branch until Matt has tested it AND triggers the deploy; only docs and proven code go straight to `main`; guard not-yet-tested features behind a flag so a merge can ship them dark.

Why this is written down: a 2026-06-06 session first left `main` stale (parked deploy-safe docs on branches), then **over-corrected** by holding build-verified beta features on a branch — which blocked Matt's testing, because the team tests through `main`. Both were wrong reads of the same question: *where does the team test?* In beta that's `main`, so build-verified code belongs on `main`. (Cross-referenced in the OpenScaffold wiki's `claude-anti-patterns.md`.)

## DB setup

Migrations live in `migrations/` as numbered SQL files (`001_*.sql` through `NNN_*.sql`, currently 34 of them — 028 added `tm_osm_cache` (durable Supabase cache of OSM/Overpass golf geometry, public Overpass hit at most once per course), 029 added `tm_elevation_cache` (USGS 3DEP DEM for plays-like), 030 added `tm_users.gender`, 031 added `tm_outings` per-player tee ratings, 032 added `tm_handicap_history` (365-day Low-HI), 033 added `tm_rounds.hole_handicaps` (solo rounds handicap like outing rounds), 034 added `tm_practice_logs` (data→practice loop)). Apply in order on a fresh database:

```bash
for f in migrations/*.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f"
done
```

For a single new migration on an existing database, apply just that file:

```bash
psql "$DATABASE_URL" -f migrations/0NN_<name>.sql
```

Migrations are append-only — never edit a numbered file. New schema changes go in a new file with the next number.

## Code discipline

- Every changed line traces to a user request.
- No drive-by refactors of adjacent code.
- Mobile-first: test on iPhone viewport (390px) before considering desktop.
- Cold-start protection: keep the `/health` no-DB-gate and client 503 retry budget.

## Framing & recommendation check (added 2026-06-27)

This is an active checkpoint, not background reading. Before writing any sentence
that characterizes a past or proposed decision as **"normal" / "the normal arc" /
"the natural arc" / "standard practice" / "for now" / "a future upgrade" / "the
simplest thing that ships" / "MVP then iterate" / "harden it later"** — STOP.
Those phrases are the trigger.

Run the standard-contradiction check: does this framing excuse a shortcut or
contradict this project's stated standard (build it right the first time; native
App-Store-grade quality; see anti-patterns #23 and #26)? If yes, **the framing is
the bug** — name the shortcut as a shortcut and build/recommend the higher bar.
Generic-industry wisdom ("ship MVP, iterate") does NOT override this project's
standard. This discipline applies to prose and recommendations, not only to
factual claims — i.e. audit-before-claim extends to *how you frame decisions*,
not just counts/completion/correctness.

Honest residual: this checkpoint lowers recurrence; it cannot fully prevent a
judgment-class slip (anti-pattern #23 was already on file the day Claude
reproduced it). Matt catching a bad framing remains a necessary backstop.

## Self-healing

The-match does not currently ship the self-healing pipeline. Phase: **none**. When ready, deploy per `/Users/matthewlavin/LimitlessStack/self-heal/README.md` (Phase 1: diagnostic only → Phase 2: full pipeline → Phase 3+: rollout).
