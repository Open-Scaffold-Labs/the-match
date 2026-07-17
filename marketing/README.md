# The Match — Marketing Page

Static single-page marketing site for **https://the-match.openscaffoldlabs.com**
(URL decided 2026-06-06, see `wiki/POST-LAUNCH-TODO.md` #23 — do NOT use the
app origin or `thematch.app` here).

## Contents

- `index.html` — the live page: **editorial design** (champagne-brief language —
  Fraunces serif on ivory, gold micro-labels, numbered feature index, animated
  Eagle Eye flyover in the cover phone). Promoted to root 2026-07-17 after
  content parity with the original dark page. Google Fonts is the only
  external dependency.
- `dark/index.html` — the original Augusta-at-night page, kept at `/dark`.
- `editorial/index.html` — redirect to `/` (the old preview URL).
- `assets/` — screenshots resized/compressed from `wiki/assets/app-store-2026-07/`
  (720px wide, JPEG q82, 26–70 KB each). Regenerate with:
  `sips -Z 720 -s format jpeg -s formatOptions 82 <src>.png --out assets/<name>.jpg`

## Deploy — LIVE since 2026-07-17

Vercel project **`the-match-marketing`** (Open-Scaffold-Labs team), CLI-linked
from this folder (`.vercel/`, gitignored). `openscaffoldlabs.com` is registered
with Vercel on Vercel nameservers, so the `the-match` subdomain's DNS was
auto-provisioned when the domain was added to the project — no manual CNAME.

To redeploy after editing this folder:

```bash
cd marketing && vercel deploy --prod --yes
```

(This project is CLI-deployed, NOT git-integrated — pushes to `main` do not
auto-deploy it.)

Still open (POST-LAUNCH-TODO #23): swap social bios / share-card CTAs /
GolfNow affiliate materials to this URL.
