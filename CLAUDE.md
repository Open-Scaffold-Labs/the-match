# The Match — [CLAUDE.md](http://CLAUDE.md)

Golf companion app. Mobile-only PWA. React 19 + Vite + Tailwind v4 (client) · Express + Supabase (server) · Vercel.

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
