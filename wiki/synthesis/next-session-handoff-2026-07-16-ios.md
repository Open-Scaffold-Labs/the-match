---
type: synthesis
created: 2026-07-16
updated: 2026-07-16
tags: [handoff, ios, app-store, capacitor, active]
---

# HANDOFF (ACTIVE) — iOS App Store push · pick up at Listing Package (item 1)

> **For the next session.** Read this + [[synthesis/app-store-readiness-gameplan-2026-07-16]]
> (the master checklist, kept current) + the 2026-07-16 entries in [[../log]] before doing
> anything. Matt has greenlit the priority order below — **start with item 1**.

## Where things stand (all verified, not aspirational)

**On `main` (merged, deployed):**
- Native iOS shell (Capacitor 8.4.2) at `client/ios` — builds (`BUILD SUCCEEDED`), runs on the
  iPhone 17 Pro simulator, **logs into prod with real data** (CapacitorHttp bypasses the
  server's single-origin CORS; API origin `https://the-match-roan.vercel.app` baked via
  `VITE_API_ORIGIN` at native build time — web builds leave it unset, verified no-leak).
- Bundle id **`com.openscaffoldlabs.thematch`** (matches FireHazmat's namespace; verified in
  the built .app). Permission strings + `PrivacyInfo.xcprivacy` ship in the bundle.
- Splash-until-ready + gold spinner; code-split startup bundle 1,175KB → 588KB.

**On branch `feat/ios-native-capabilities` (pushed, NOT merged):**
- Native geolocation shim (`client/src/lib/geolocation.js`) adopted in EagleEye + ActiveRound
  live watches — web path byte-identical, native path uses @capacitor/geolocation.
- Native push (APNs) — client `registerNativePush()`, server `POST/DELETE
  /api/notifications/register-native`, **migration 048 tm_native_push_tokens (NOT applied to
  prod)**, AppDelegate token hooks, `App.entitlements` template, remote-notification bg mode.
  **Missing:** Xcode Push capability (needs Apple account), APNs .p8 key, the server SEND path
  (see item 2), migration 048 applied.
- OTA (Capgo): NOT in the tree (uninstalled; config + notifyAppReady wiring reverted) — see
  "OTA status" below.

## OTA status — ✅ RESOLVED (late 2026-07-16, same session)

Xcode's GUI resolver ground through the throttled Alamofire clone (~40 min at ~2%/min) and
**all Capgo packages resolved + cached** (Alamofire 5.12.0, BigInt 5.7.0, ZIPFoundation 0.9.20,
Version 0.8.0). The two wiring pieces were re-applied (capacitor.config.json `CapacitorUpdater`
`{autoUpdate:false, resetWhenUpdate:true}` + `notifyAppReady()` in `lib/native.js`). Verified:
lint 0 / web build 0 / `xcodebuild` **BUILD SUCCEEDED** (35s — cache warm) / app runs on the
sim with Capgo live (CapgoUpdater init + CapgoBundleCleanup in the device log; profile renders
with live backend data). Committed on `feat/ios-native-capabilities`.

Root cause of the original failures (audited, evidence in log): the machine's GitHub transfer
rate was throttled — NOT a version conflict, NOT Capgo's encryption. Packages are now cached,
so future builds don't refetch.

**Still open on OTA:** Capgo backend decision with Matt (Cloud ~$14/mo vs self-host) + account
+ `CAPGO_*` config before the first real OTA update ships. `autoUpdate` stays false until then
— the CAPABILITY is in the binary (required for the first submitted build), inert until
configured. One benign log line to know about: `CapgoUpdater: Semaphore wait timed out after
0ms` at launch — expected with no update server configured.

## Priority order (Matt-approved)

### 1 — App Store listing package  ← START HERE
- **Screenshots**: the sim (iPhone 17 Pro, device id B781E199-E966-454A-BD20-E20FA5084A07) has
  the app installed; Matt's account logs in (he consented to Claude using his login this way;
  ask again before reusing). Capture: Home dashboard, Eagle Eye rangefinder on a course, live
  match scorecard, Stats/SG card, GamePlan. `xcrun simctl io <sim> screenshot <path>`.
  Apple needs 6.9" (iPhone 17 Pro renders 1206×2622 — check current required sizes).
  Screenshots must show real-looking data, no debug chrome.
- **Store copy**: name ("The Match"), subtitle (~30 chars), keyword field (100 chars),
  description, promotional text. Angle: rivalry/competition-first golf app — GPS rangefinder +
  Strokes Gained + live matches with friends. NO competitor names anywhere (Matt's standing
  rule — generic descriptors only).
- **App Review notes + demo account**: reviewers need a working login with seeded data (a
  round, a match, SG stats). Decide with Matt: dedicated review account vs seeded test user.
- Age rating questionnaire answers + support URL + marketing URL (ask Matt which domain).
- Park all of it in `wiki/synthesis/` (e.g. `app-store-listing-2026-07-NN.md`) for Matt's
  sign-off; the gameplan Phase-3 checklist tracks the items.

### 2 — Push send path (server)
`server/src/lib/push.js` currently sends WEB push only. Add an APNs sender (`apns2` npm pkg or
`node-apn` successor — verify current best lib) reading `tm_native_push_tokens`, gated on env
(`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY` or .p8 path, bundle id `com.openscaffoldlabs.thematch`)
— inert until Matt adds the key from the Apple Developer account (enrollment exists; FireHazmat
shipped). Fan out wherever web push is sent today (grep `sendPushToUser` / `web-push` call sites)
so both channels fire. Also: **apply migration 048 to prod** (Matt applies by hand per repo rules).

### 3 — Compliance paperwork
App Store Connect privacy nutrition-label answers must MATCH `PrivacyInfo.xcprivacy` (email +
precise location + user content, all App-Functionality, no tracking). Draft the questionnaire
answers + age rating into the wiki for Matt.

## Rails that bit this session (don't relearn)
- **Ask Matt before commit/push/merge; work on branches** (`feat/ios-*`). He approves merges.
- **Never use the sandbox Bash for git/Mac work** — Desktop Commander (`mcp__desktop-commander__start_process`).
- **Xcode is click-tier only** via computer-use (no typing) — fine for watching resolution +
  clicking Build/Run.
- audit-before-claim: verify (build output, bundle contents, screenshots) before reporting.
  Two corrected-this-session examples live in the log: the "11s slow app" was simulator
  cold-boot (warm = ~2s), and "heavy encryption tree" mis-blamed Capgo (real cause: throttled
  Alamofire clone).
- `xcodebuild` first run after a cache clear re-resolves ALL SwiftPM packages — don't kill it
  mid-fetch (a killed download corrupts `~/Library/Caches/org.swift.swiftpm` → "already exists
  in file system" → clear that cache to fix).
- End-of-session: wiki log entry, task files (`wiki/my-tasks/mlav1114.md` + Hub convention),
  commit+push, NotebookLM refresh per CLAUDE.md checklist.

## Fast context anchors
- Gameplan/checklist: `wiki/synthesis/app-store-readiness-gameplan-2026-07-16.md`
- This session's log entries: `wiki/log.md` §2026-07-16 (two entries: shell Phase 0 + native
  capabilities/OTA audit)
- Branches: `main` (shell merged) · `feat/ios-native-capabilities` (geo+push, unmerged,
  possibly dirty with the Capgo retry)
- Sim: iPhone 17 Pro `B781E199-E966-454A-BD20-E20FA5084A07` · prod: `the-match-roan.vercel.app`
