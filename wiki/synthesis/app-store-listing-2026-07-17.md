---
type: synthesis
created: 2026-07-17
updated: 2026-07-17
tags: [app-store, listing, aso, marketing, launch, active]
---

# The Match — App Store Listing Package + Get-Noticed Playbook (2026-07-17)

> **Status: DRAFT for Matt's sign-off.** Nothing here is submitted anywhere.
> Companion to [[synthesis/app-store-readiness-gameplan-2026-07-16]] (Phase 3 checklist).
> ASO grounded in a same-night research pass (agent, ~16 sources, mid-2026 mechanics);
> competitor apps referenced generically per the no-competitor-names rule.

## 1 · Screenshots — CAPTURED ✅ (2026-07-17, iPhone 17 Pro Max sim, 1320×2868 = required 6.9" size)

All in `wiki/assets/app-store-2026-07/`, real account data, no debug chrome, post full-bleed/scorecard-fix build.

Proposed order (Apple allows 10; first 3 show in search results — lead with scroll-stoppers):

| Slot | File | Proposed caption (captions are INDEXED for search since June 2025 — keyword real estate) |
|---|---|---|
| 1 | 02-eagle-eye-rangefinder | "GPS rangefinder with plays-like distances" |
| 2 | 03-live-match-scorecard | "Live scorecard — every player, every hole" |
| 3 | 09b-ai-caddie-answer | "A caddie that knows YOUR real distances" |
| 4 | 08-gameplan-strategy | "GamePlan: your hole-by-hole strategy, built tonight" |
| 5 | 06-rivalry-matt-vs-daniel | "Rivalries tracked round after round" |
| 6 | 04-match-board | "Tour-style leaderboard for your group" |
| 7 | 07-practice-focus-areas | "Practice plans built from your leaks" |
| 8 | 05-profile-handicap | "Handicap index + score trend" |
| 9 | 01-home-dashboard | "Your season at a glance" |
| 10 | 02b-eagle-eye-club-arcs | "Your club distances, on the map" |

Captions require framed marketing images (text is part of the uploaded image, not a form field).
V1 can ship raw screenshots; the caption pass is a fast follow worth doing — indexed text.
Spare: 09-ai-caddie (empty-state variant).

## 2 · Store copy (DRAFT — all limits verified)

**App name (30 max):** `The Match: Golf Scorecard` *(25)*
Rationale: brand + the highest-volume LOW-difficulty term in the category ("golf scorecard" — measurably soft while "gps/rangefinder" head terms are incumbent-locked). Name is the heaviest-weighted ASO field.

**Subtitle (30 max):** `Match Play, Skins & Leagues` *(27)*
Rationale: spends its characters on the games/social cluster — highest-intent, most winnable, and the app's actual differentiator. No word repeats from the name (repeats earn zero).

**Keyword field (100 max, hidden):**
`handicap,tracker,strokes,gained,gps,rangefinder,nassau,wolf,scramble,caddie,friends,score,card,ai` *(97)*
Rules applied: no repeats of name/subtitle words, singulars only, no spaces. "score" + "card" as
separate tokens cover the two-word "golf score card" search (measured difficulty ~3 — the softest
high-intent term in the category; the compound "Scorecard" in the name does NOT match it). "ai" +
"caddie" cover "ai caddie"/"golf caddie" (emerging, low competition). "gps/rangefinder" live here
for phrase-permutation association without burning title space. Deliberately NOT using
"betting/bets" in any visible metadata (review sensitivity) — formats speak for themselves
(nassau, wolf, skins). ("stats" dropped — generic, weakest of the set — to fit card+ai.)

**Promotional text (170 max — changeable anytime without a build):**
`New: GamePlan writes your hole-by-hole strategy the night before your round, and The Caddie makes club calls from YOUR real distances. Rally your foursome.` *(154)*

**Description (4000 max — first three lines carry ~all the weight):**

```
Golf is better with something on the line. The Match turns every round with
your friends into a live match — real-time scorecards, tour-style
leaderboards, and rivalries that carry from round to round.

START A MATCH IN SECONDS
Share a 4-letter code and your whole group is on one live scorecard. Stroke
play, match play, skins, stableford, best ball — with net scoring from real
handicaps, so every game is fair and every hole matters.

A RANGEFINDER THAT KNOWS YOUR GAME
GPS distances to the green, hazards, and any point you tap — plus plays-like
numbers that account for elevation, wind, and temperature. Your own club
distances drawn right on the hole map.

YOUR NUMBERS, WORKING FOR YOU
Strokes Gained analytics show exactly where you lose shots. The Caddie
answers club calls from YOUR measured distances. GamePlan builds a
hole-by-hole strategy the night before you play. Practice plans target the
leaks in your game — not generic drills.

RIVALRIES & LEAGUES
Head-to-head records against every friend. Season-long leagues with
standings your whole crew checks all week. A handicap index computed from
every round you post.

NEVER LOSE A ROUND
Scores save through dead zones and dropped signals. Enter it once — it's
recorded.

Free to play. Grab your foursome and settle it on the course.
```

## 3 · App Review notes + demo account (Matt chose: dedicated review account)

**Plan:** create `reviewer@openscaffoldlabs.com` (4-digit PIN login — note for Matt/Dale: seed
via normal signup, then play in: 2 solo rounds w/ putts+shots (SG unlocks), 1 completed
2-player match vs a seed account (rivalry + podium), 1 GamePlan for a real course, club
distances filled in MyBag). Keep credentials out of git — enter only in App Store Connect's
review-notes field.

**Draft review notes (for the App Review Information box):**

```
The Match is a live golf scoring + GPS app. Demo account (pre-seeded with
rounds, a completed match, stats, and a saved GamePlan):
  Email: [reviewer email]   PIN: [4 digits]

Location: used only while the app is open, for GPS distances on the course
map (Play tab). Works anywhere — the map centers on any selected course, so
you can review it from your desk (pick any course; e.g. "Pebble Creek").

Multiplayer: matches are joined via private 4-letter codes between friends.
No public rooms, no strangers, no chat with non-friends.

Account deletion: Profile → Settings → Delete Account (hard delete).
No purchases. No real-money wagering: game formats (skins, nassau) tally
points/strokes only — the app processes no money.
```

## 4 · Age rating + URLs + privacy

- **Age rating questionnaire:** expect **4+**. All "None" (violence, mature themes, etc.).
  The one to answer carefully: *Simulated Gambling → None* — skins/nassau are score-keeping
  formats; the app moves no money and simulates no casino games. (Also why visible metadata
  says "money games/skins," never "betting.")
- **Marketing URL:** `https://the-match.openscaffoldlabs.com` (decided 2026-06-06, POST-LAUNCH
  #23). ⚠️ **Page must be LIVE before submission** — Apple checks listing links.
- **Support URL:** `https://the-match.openscaffoldlabs.com/support` (build with the marketing
  page: a contact email + FAQ stub satisfies Apple).
- **Privacy policy URL:** currently `https://the-match-roan.vercel.app/privacy.html` (exists).
  Move/mirror to the marketing domain when it's built; content review still owed (gameplan
  Phase 2).
- **Nutrition label:** must match `PrivacyInfo.xcprivacy` — email + precise location + user
  content, all App-Functionality, no tracking. (Compliance task from the 07-16 handoff.)

## 5 · Get-noticed playbook (research synthesis — full agent report in session log context)

**ASO mechanics that matter in 2026:** name > subtitle > keyword field, zero credit for
cross-field repeats; screenshot-caption text INDEXED (June 2025); Custom Product Pages rank
organically for assigned keywords (July 2025, 70 keywords) — build CPPs per persona
(games-with-friends / league commissioner / stats+SG); in-app events are indexed AND
featurable; ratings VELOCITY + conversion + install momentum are ranking inputs → in-app
rating prompt at the round-end happy moment is an ASO feature (post-ceremony, after Save —
ties into tonight's end-round work).

**Top actions for a two-person team (ranked, from the research):**
1. Metadata build-out above + rating prompt at round end — compounding, free.
2. **League/outing commissioner outreach** — "your league runs free in the app"; one
   commissioner = 8–40 sticky installs. The leagues feature is the structural wedge no
   incumbent owns.
3. **Shareable score-card loop** — the branded round-summary share image, one tap, with the
   app name + join code watermarked. Every group chat becomes acquisition. (Share card
   exists — add the watermark/join-code polish.)
4. **Apple featuring nomination** (App Store Connect → Featuring → Nominations) 4–6 weeks
   ahead, paired with an in-app event; editors score UX, design, uniqueness, accessibility,
   product-page quality + love a two-person-team story. Seasonal hooks: majors weeks,
   Masters week (early April = documented download surge).
5. Nano/micro golf creator seeding — free premium + codes; the proven format is a real
   foursome money-match filmed with the live leaderboard on screen.
6. Golf-media "best golf apps" roundups + the app-review series at the major review site —
   refresh every spring; pitch at launch and again in March.
7. TestFlight cohort → day-one ratings, all launch channels concentrated in 72 hours
   (velocity density is a ranking signal).
8. Custom product pages per keyword cluster.
9. Reddit/forums: 90/10 genuine participation; the big golf sub bans self-promo links —
   answer "what app for skins?" threads with disclosure instead.
10. Pro-shop QR counter cards — cheap, local, compounding.

**Timing:** ship NOW (July = peak rounds-played; every week is word-of-mouth season). Run an
in-app event against the remaining 2026 calendar (Open Championship/FedEx). Treat
**mid-March→April 2027 (Masters week)** as the real growth launch: featuring nomination
late Feb, creator wave, roundup pitches, commissioner blitz. Winter = pre-sell league
commissioners for 2027 + build the review base in the Sun Belt.

## 6 · Open items before submission (tracked in the gameplan checklist)

- [ ] Matt signs off on copy (§2) — then it goes into App Store Connect verbatim
- [ ] Build marketing page + /support at the-match.openscaffoldlabs.com (page must be live)
- [ ] Create + seed the reviewer account; creds into App Store Connect only
- [ ] Privacy.html content review + nutrition-label answers entered
- [ ] App icon 1024×1024 final check (repo `icons-wip`/`brand-kit`)
- [ ] Framed screenshots w/ indexed captions (fast-follow; raw shots OK for v1)
- [ ] Rating prompt at round end (small build task — ASO input)
- [ ] Featuring nomination + first in-app event (post-submission)
