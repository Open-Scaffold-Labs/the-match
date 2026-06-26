---
type: synthesis
created: 2026-06-25
updated: 2026-06-25
tags: [the-match, profile, gender, club-distances, foundation, build-spec]
---

# The Match — Player-Data Foundation: gender field + effortless distance entry

*Build-ready spec. Prepared 2026-06-25. Triggered by Matt: a national-scale golf app needs real player attributes, not workarounds. Two pieces — a proper gender/tee-gender field, and a frictionless club-distance entry flow (now that the own-club arcs depend ONLY on entered distances).*

> **The bar:** biggest golf app in the country — usability, accuracy, visual flow. Verify, don't claim. No guessing of player data.

---

## 1. Why this matters

- **Gender** isn't cosmetic: it drives correct **tee handling** (men's vs women's tees → different yardages), **course/slope rating + handicap math**, and women's-appropriate defaults. Getting it wrong is the kind of error a serious golfer notices immediately. Today there is **no gender field** (verified — `tm_users` has id/email/name/pin_hash/role/handicap + later-added avatar/handicap/home_course/bio; no gender anywhere in client or schema). We worked around its absence in 3.3; the right fix is to add it.
- **Distance entry**: the 3.3 arcs now use **only the player's entered `avg_yards`** (handicap guessing was removed). So the feature is empty until the player fills their bag — making entry effortless and actively prompting it is the unlock.

---

## 2. Grounded facts (verified this session)

- `tm_users` columns confirmed (migration 001 + later adds): no gender. Column-add pattern exists (003/004/012 used `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- `USER_PUBLIC_COLUMNS` (`server/src/lib/user.js`) is the **single source** of what the user object returns — `/api/auth/me`, `middleware/auth`, and `profile` GET/update all `SELECT … RETURNING ${USER_PUBLIC_COLUMNS}`. Adding `gender` here propagates it everywhere the `user` object is read (incl. the EagleEye `user` prop).
- `POST /api/profile/update` destructures `{ home_course, bio, handicap, name }` and updates via `COALESCE`. Gender slots in identically.
- UI: profile edit = `SettingsModal.jsx`; onboarding = `OnboardingWizard.jsx` (+ `onboarding_steps` JSON, migration 012); bag entry = `MyBag.jsx`. The Eagle Eye ARCS empty state already opens the bag sheet (shipped 3.3 correction).

---

## 3. Slice sequence — each ships independently, builds+lints+checks clean

### Slice 1 — Gender on the data model (migration + server)
- Migration `030_tm_users_gender.sql`: `ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS gender TEXT;` (nullable — never required; values constrained in the app to `'male' | 'female'`, room for more later). Append-only; **applied by hand via `psql` (Claude has access, mirrors 029).**
- Add `'gender'` to `USER_PUBLIC_COLUMNS`.
- `profile/update`: accept `gender`, validate against an allowlist (`male`/`female`/null — ignore anything else), update via the same `COALESCE`-style guard so omitting it never wipes it.
→ **verify:** migration applied (column exists); `node --check`; curl `profile/update` sets + returns gender; invalid value rejected/ignored; omitting gender preserves it.

### Slice 2 — Gender control in profile (`Home.jsx` profile-edit form)
*(Audit correction: the profile edit — handicap/bio/name — lives in `Home.jsx` ~L2303 calling `post('/api/profile/update')`, not SettingsModal. `SettingsModal` handles account/delete.)*
- A clean segmented control (Male / Female) in the profile edit, reading `user.gender`, saving via `profile/update`. Optional, with a neutral unset state. Tokens, ≥44px targets, tabular-nums n/a.
→ **verify:** renders current value; change persists + reflects in the returned user; build+lint.

### Slice 3 — Gender in onboarding (`OnboardingWizard.jsx`)
- Collect gender at the appropriate onboarding step (it already collects handicap + first club). Keep it skippable (not a hard gate) — never block onboarding on it. Persist via the same route; mark the step in `onboarding_steps` if that pattern is used.
→ **verify:** appears in the flow; selection persists; skipping doesn't break completion; build+lint.

### Slice 4 — Effortless distance entry + prompts (`MyBag.jsx` + Eagle Eye empty state)
- Make entering a club's `avg_yards` frictionless in MyBag (clear numeric entry, sensible keyboard, save-on-blur) and give the **empty/zero-distance state a strong CTA** ("Set your club distances to see your shot zones on the map").
- The ARCS toggle already opens the bag when empty (3.3); ensure that lands on a state that obviously invites entering distances.
→ **verify:** entering a distance persists + immediately powers the arcs; empty state reads as an invitation, not a dead end; build+lint.

**Cross-cutting gates:** `npm build` + ESLint `no-undef` + `node --check` on changed server files → push to beta → reproduce on the real deployed app (Claude-in-Chrome) → audit-before-claim.

---

## 4. Risk register

| # | Risk | Severity | Mitigation |
|---|---|:--:|---|
| G1 | **Migration wipes/locks** | 🔴 | `ADD COLUMN IF NOT EXISTS`, nullable, no default backfill needed; append-only new file; applied narrowly by hand + verified before next slice |
| G2 | **Gender becomes a hard gate** → onboarding friction (a top incumbent complaint pattern) | 🟡 | Optional everywhere; skippable in onboarding; null is a valid state; never block on it |
| G3 | **Invalid/garbage gender value** | 🟡 | Server allowlist (`male`/`female`/null); ignore anything else; client offers only valid choices |
| G4 | **Omitting gender on an unrelated profile save wipes it** | 🔴 | COALESCE/guard so an absent field preserves the stored value (mirror the existing handicap/bio pattern) |
| C1 | **`USER_PUBLIC_COLUMNS` drift** — add in one place, miss another | 🟡 | It's the single shared list; adding `gender` there covers /me + auth + profile uniformly (verified) |
| C2 | **server-only-in-client / id-coerce / api shadowing** | 🟡 | Standing conventions; lint `no-undef` + `node --check`; grep `api.` before new calls |
| P1 | **Privacy** — gender is personal | 🟡 | Optional, minimal storage, only in the user's own profile; no third-party exposure |
| U1 | **Distance entry still feels like a chore** | 🟡 | Frictionless entry + strong prompt; the accurate long game (auto-derive from shots) is the deferred follow-up |
| B1 | **Backward-compat** — existing users have null gender | 🟢 | Null handled gracefully everywhere; tees/behaviour default exactly as today until set |

---

## 5. Progress checklist

> ☐ not started · ◐ in progress · ☑ done

- ☑ Recon (schema, USER_PUBLIC_COLUMNS, profile route, UI components)
- ☑ Spec + risk register (this doc)
- ☑ Audit the plan (audit-before-claim caught the profile-edit-is-in-Home.jsx correction; design-critique on the segmented control)
- ☑ Slice 1 — migration 030 + USER_PUBLIC_COLUMNS + profile route (migration applied + column verified; node --check clean)
- ☑ Slice 2 — gender control in the Home profile-edit form (build+lint clean)
- ☑ Slice 3 — gender folded into the onboarding handicap step (no renumber; build+lint clean)
- ◐ Slice 4 — distance-entry prompts already present (Home "tap to manage distances" + ARCS→bag); deeper UX polish a light follow-up
- ☑ Verified on the deployed app: `/api/auth/me` returns `gender` (null default) — full data path confirmed in prod. Wrap done.

## 6. Deferred (flagged)

- **Auto-derive club distances from tracked shots** (trimmed mean of real strikes) — the zero-effort accurate version; needs shot-tracking infra. The real long-game after this foundation.
- **Gender-aware tee defaults** — once the field exists, wire it into tee selection/defaults (separate slice).
- **Tournament Mode** (USGA legality) — still open from 3.1/3.3.

---

*Sources: codebase recon this session — `migrations/001`, `server/src/lib/user.js` (USER_PUBLIC_COLUMNS), `server/src/routes/profile.js`, `server/src/routes/auth.js`, `SettingsModal.jsx`, `OnboardingWizard.jsx`, `MyBag.jsx`. Migration pattern mirrors 003/004/012/029.*
