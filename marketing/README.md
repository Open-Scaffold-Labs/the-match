# The Match — Marketing Page

Static single-page marketing site for **https://the-match.openscaffoldlabs.com**
(URL decided 2026-06-06, see `wiki/POST-LAUNCH-TODO.md` #23 — do NOT use the
app origin or `thematch.app` here).

## Contents

- `index.html` — the whole page (no build step, no dependencies).
- `assets/` — screenshots resized/compressed from `wiki/assets/app-store-2026-07/`
  (720px wide, JPEG q82, 26–70 KB each). Regenerate with:
  `sips -Z 720 -s format jpeg -s formatOptions 82 <src>.png --out assets/<name>.jpg`

## Deploy (one-time setup)

1. Vercel → Add New Project → import `Open-Scaffold-Labs/the-match` **again**
   (a second project from the same repo).
2. Set **Root Directory = `marketing`**, Framework Preset = **Other** (static).
   No build command, output dir = `.`.
3. Project → Domains → add `the-match.openscaffoldlabs.com`.
4. DNS for `openscaffoldlabs.com`: CNAME `the-match` → `cname.vercel-dns.com`.
5. After it's live: swap social bios / share-card CTAs / GolfNow affiliate
   materials to this URL (POST-LAUNCH-TODO #23).

Pushes to `main` that touch `marketing/` auto-deploy once the project exists.
