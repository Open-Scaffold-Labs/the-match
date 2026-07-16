---
type: synthesis
created: 2026-07-16
updated: 2026-07-16
tags: [app-store, ios, launch, packaging, compliance]
---

# The Match — App Store Readiness Gameplan (2026-07-16)

> **Purpose:** the reference doc for getting The Match from "web app on Vercel" to
> "approved native app on the Apple App Store." Written after confirming the repo
> has **no native iOS shell yet** — so this plan starts at step zero (the wrapper
> Apple actually reviews) and walks through every Apple requirement current as of
> July 2026.

## TL;DR

- The **hard part is already built**: the web app has GPS, live scoring, voice logging, an AI caddie, community courses, and offline handling — more than enough real functionality to clear Apple's "not just a website" bar.
- The **missing piece is the native shell**. Today there is no Xcode project, no Capacitor/Cordova/Expo, no `Info.plist`. That wrapper is the first duck and everything else (permissions, push, privacy manifest) hangs off it.
- **Recommended packaging: Capacitor.** It reuses the entire existing web client, gives real native bridges (GPS, camera, mic, push, later Apple Watch), and uniquely gets us to **Android for near-free** — which matters a lot for the "biggest golf app in the country" goal.
- Two Apple requirements are **already satisfied**: in-app account deletion exists, and a `privacy.html` exists. Most remaining work is native plumbing + store paperwork, not new product.

---

## Build progress — session 2026-07-16 (branch `feat/ios-capacitor-shell`)

**Done + verified this session** (nothing committed/pushed yet — all local on the branch):

- ✅ **Capacitor 8.4.2 added** to the `client` workspace; native iOS project generated at `client/ios` (`npx cap add ios` succeeded; Capacitor 8 uses Swift Package Manager, no CocoaPods needed). Config: `client/capacitor.config.json` (bundled web assets, appId `com.openscaffold.thematch` — placeholder to confirm).
- ✅ **API-origin fix** (`client/src/lib/api.js` + `client/src/main.jsx`) — the #1 wrap-breaker. A build-time `VITE_API_ORIGIN` + a startup fetch shim route every root-relative `/api` and `/health` call (incl. ~a dozen that bypass the api helper) to the deployed backend on native. **No-op on web** (verified: test origin present in a native build, absent in the web build). Web build/lint/tests unaffected.
- ✅ **Permission usage strings** in `Info.plist` — location (when-in-use), camera, microphone, all specific/user-facing — plus `ITSAppUsesNonExemptEncryption=false`.
- ✅ **Privacy manifest** `PrivacyInfo.xcprivacy` (baseline: email + precise location + user content; UserDefaults required-reason CA92.1).
- ✅ **Native bootstrap** (`client/src/lib/native.js`) — status bar style, splash dismiss, Android back-button — all guarded, no-op on web. Safe-area handling already correct (`viewport-fit=cover` + `env()` tokens).
- ✅ **Web unaffected**: `npm run build` ✓, `npm run lint` ✓ (exit 0), test suites green, `npx cap sync ios` ✓.
- ✅ **Native app compiles** — `xcodebuild ... -sdk iphonesimulator ... build` → **BUILD SUCCEEDED** (exit 0). Bundle verified: all three permission strings + `ITSAppUsesNonExemptEncryption` present in the built `Info.plist`, and the web app (`public/index.html`) is bundled. (Note: `cap add ios` needs Capacitor's SwiftPM cache intact; a killed mid-download left a corrupt artifact once — fix was `rm -rf ~/Library/Caches/org.swift.swiftpm` then rebuild.)
- ✅ **`PrivacyInfo.xcprivacy` now ships in the bundle** — `cap add ios` doesn't auto-register it, so it was added to the App target's resources build phase (via the `xcodeproj` gem) and **verified present in the rebuilt `.app`**.
- ✅ **Ran on a simulator (iPhone 17 Pro) — the login screen renders natively** (screenshot captured). Prod-pointed bundle: `VITE_API_ORIGIN=https://the-match-roan.vercel.app` (backend confirmed live: `/health` → `{status:ok, db:true}`). **CapacitorHttp enabled** so native API calls bypass the server's single-origin CORS (`cors({ origin: CLIENT_ORIGIN })` would reject `capacitor://localhost`).

**Runtime findings (from the sim launch) — corrected after measuring:**

- ✅ **First-paint speed is FINE — earlier "~11s" alarm was a measurement error.** The ~11.5s came from a *cold-booted simulator's* first-ever WKWebView init, not the app. Measured on a **warm relaunch: the login screen is fully rendered by ~2s.** Also confirmed the heavy deps are ALREADY lazy — MapLibre (`await import('maplibre-gl')` in HoleMapGL) and the 24 MB ONNX/background-removal (`await import('@imgly/background-removal')` in PlayerCard) are dynamic imports, NOT on the startup path. So there is no "24 MB on launch" problem; that diagnosis was wrong.
- ✅ **Splash-until-ready shipped anyway (correct hygiene, not a band-aid).** `launchAutoHide:false` + `hideSplash()` from App.jsx's first paint (+ gold spinner) guarantees no blank/white flash on any cold start, slow network, or low-end device — regardless of load time. Good native launch behavior to keep.
- 🟡 **Optional real optimization (not urgent):** App.jsx eagerly imports every page, so the main bundle is ~1.18 MB (includes all of EagleEye + HoleMapGL). `React.lazy` on the heavy routes (EagleEye especially) would shrink the initial parse and help *genuine* cold-device / low-end launches. Worth doing, but it's optimization — not the emergency the cold-start number made it look like.
- 🟡 **API round-trip not yet proven.** The bundle loads and the login screen renders, but an actual authenticated call from the native app hasn't been confirmed (no test creds used). CapacitorHttp + origin are wired; needs a real login (or a debug ping) to confirm end-to-end.

**NOT yet done / needs a device or Matt** (honest gaps — do not assume these work):

- ⚠️ **Native GPS/camera/mic rely on the WKWebView web-API bridge** + the Info.plist strings (not native Capacitor plugins yet). Standard and should work, but **unverified on device** — background GPS especially may want the native Geolocation plugin later.
- ⚠️ **Push notifications (APNs)** not implemented yet (Apple Developer account already exists — see below — so this is buildable now, just not done).
- ⚠️ **`VITE_API_ORIGIN` prod domain is a placeholder** (`the-match.vercel.app`) — confirm the real production API domain.
- ⚠️ **Bundle ID `com.openscaffold.thematch` is a placeholder** — confirm before first submission (semi-permanent once published).
- ⚠️ **Not committed or pushed** — awaiting Matt's go-ahead (per the never-push-without-asking rail).

---

## The packaging decision (why Capacitor)

Three realistic ways to get a web app into the App Store, judged against the stated ambition — **be the biggest golf app in the country**, which implies (a) reach the whole market, not half of it, (b) preserve the differentiated features already built, (c) get to market before momentum is lost, and (d) leave room for deep native polish over time.

| Approach | What it is | Fit for The Match |
|---|---|---|
| **Capacitor** ✅ | Wraps the existing React/Vite app in a WKWebView with a native plugin layer (GPS, camera, mic, push, haptics, Health, and an Apple Watch companion path). | **Recommended.** Reuses 100% of the current client + all of Dale's recent work (SG, voice, GamePlan, WebGL hole maps). Ships to **both iOS and Android from one codebase**. Native where it counts, web where it's fine. Not a dead end — individual screens can be swapped to native later. |
| **Hand-rolled Swift WKWebView** | A custom native container we write and maintain ourselves. | Basically Capacitor minus the ecosystem. You'd rebuild every native bridge (camera/GPS/mic/push) by hand and own the maintenance. Rarely worth it. iOS-only. |
| **Full React Native rewrite** | Rebuild the UI natively in RN. | Best long-term native *feel*, but a multi-month rewrite that throws away the web client and the WebGL flyover map work. Wrong move pre-launch — it delays the store and re-litigates things that already work. |

**The honest tradeoff with Capacitor**, named plainly (not hand-waved): a WKWebView app has a lower ceiling on "native feel" than a fully-native UI, and some things — an **Apple Watch app, Live Activities, home-screen widgets, deep sensor work** — must be written in native Swift *regardless of which wrapper you pick*. Capacitor doesn't remove that; neither does React Native fully. But those are additive companion surfaces you build *after* launch, not reasons to delay the core.

**Why Capacitor actually serves the "biggest" goal better than a rewrite:** market leadership in this category is won on features, data coverage, distribution, and — critically — **being on Android too**. An iOS-only strategy caps you at roughly half the U.S. smartphone market on day one. Capacitor gets you both stores from the codebase you already have. That's the growth argument, not just the speed argument.

> **Recommendation: build the iOS (and Android) shell with Capacitor.** Owner of the native build is **TBD** (open question below) — confirm who's driving it before shell work starts.

---

## Already done (confirmed in repo, 2026-07-16)

- ✅ **In-app account deletion** — `server/src/routes/auth.js` hard-deletes the account; `client/src/components/SettingsModal.jsx` has the user-facing delete flow. *(Apple requires this for any app with account creation — done.)*
- ✅ **Privacy policy page** — `client/public/privacy.html` exists. *(Needs a content review + a stable public URL for the store listing — see Phase 2.)*
- ✅ **Real native-grade features** — geolocation (heavy use), camera (Eagle Eye), microphone (voice), and push scaffolding are all in the web app. This is what clears Guideline 4.2.
- ✅ **Offline discipline** — CLAUDE.md already mandates no browser-framed fallbacks and proper offline states (the exact thing reviewers test with Airplane Mode).

---

## Phased checklist

### Phase 0 — Foundation (blockers; do first)
- [x] **Apple Developer Program — already enrolled.** Dale set this up; **FireHazmat is already shipped on the App Store**, so the account, signing infrastructure, and App Store Connect org all exist and the team has a proven submission playbook to reuse. This is a major accelerator — the biggest external dependency is already solved.
- [x] **Decide + scaffold the Capacitor shell** — add Capacitor to the repo, generate the iOS project, get the web app loading in the WKWebView on a device. *Owner: TBD.*
- [ ] **Build against the iOS 26 SDK** — as of **April 28, 2026**, App Store Connect requires apps be built with the iOS 26 SDK or later. Use current Xcode. *Owner: TBD.*
- [ ] **App identifiers** — bundle ID, App ID, provisioning profiles, signing certs.

### Phase 1 — Native integrations
- [ ] **Permission usage-description strings** in `Info.plist` (Apple rejects missing/vague ones):
  - `NSLocationWhenInUseUsageDescription` — GPS yardages & shot tracking
  - `NSCameraUsageDescription` — Eagle Eye shot capture
  - `NSMicrophoneUsageDescription` — voice round logging
  - `NSMotionUsageDescription` — if walking/step detection uses motion
- [ ] **Native geolocation** via the Capacitor Geolocation plugin (more reliable than web geolocation in a webview — and the recent GPS "watch resurrection" bugs are exactly the class native handling fixes).
- [ ] **Push notifications over APNs** (native), replacing/augmenting web push. Register token, wire to the existing notification backend.
- [ ] **Airplane-Mode pass**: confirm no blank white screen / no browser error page when offline. This is the #1 web-wrapper rejection trigger.

### Phase 2 — Privacy & compliance
- [ ] **Privacy manifest** (`PrivacyInfo.xcprivacy`) — required for new submissions. Declare data collected + any third-party SDKs.
- [ ] **Required-reason API declarations** — declare approved reasons for any "required reason" APIs (UserDefaults, file timestamp, boot time, disk space, active keyboard). Capacitor/plugins may pull these in; audit and declare.
- [ ] **Privacy "nutrition label"** in App Store Connect — data types collected (location, email, usage) and linkage.
- [ ] **Privacy policy** — review `privacy.html`, host at a stable public URL, link it in the listing (required).
- [ ] **Verify account deletion end-to-end on device** — reachable in ≤ a few taps from settings; deletes the full record.
- [ ] **Encryption compliance (ITSAppUsesNonExemptEncryption)** — almost certainly "no" (standard HTTPS only), but must be declared.

### Phase 3 — Store listing assets
- [ ] **App name + subtitle + keywords** (App Store SEO — matters for the "biggest" goal).
- [ ] **Description + promotional text.**
- [ ] **Screenshots** for required device sizes (6.9" / 6.5" iPhone at minimum) — polished, showing GPS, scoring, SG, voice, caddie.
- [ ] **App icon** (1024×1024) — check the `icons-wip/` and `brand-kit/` folders already in the repo.
- [ ] **Age rating questionnaire.**
- [ ] **Support URL + marketing URL.**

### Phase 4 — Pre-submission QA
- [ ] **TestFlight beta** — internal (Matt + Dale) then external testers; this is the real on-device round test that POST-LAUNCH-TODO #25 already flags.
- [ ] **Device matrix** — a few real iPhones / iOS versions; on-course GPS + voice + scoring end-to-end.
- [ ] **Reviewer demo account** — a pre-seeded login for Apple's reviewer (they won't create golf rounds themselves).
- [ ] **Crash/ANR sweep**, 60fps check on maps, no dead links.

### Phase 5 — Submit
- [ ] Submit for review, respond fast to any rejection, keep a rejection-response log.

---

## Guideline 4.2 (minimum functionality) — risk read

**Low risk.** The frequent web-wrapper rejection is for apps that are "just a website." The Match is not: it has GPS course mapping, live multiplayer scoring, Strokes Gained analytics, voice logging, an AI caddie, and offline states. As long as the shell (a) uses **native** location/camera/mic/push rather than only web APIs, (b) never shows a **browser error or blank screen offline**, and (c) has **no Safari-like chrome** (loading bars, address hints), it clears 4.2 comfortably. The build discipline in CLAUDE.md already points the right way here.

---

## Open questions for Matt & Dale
1. ~~Apple Developer account~~ — **resolved: already enrolled** (Dale; FireHazmat is live on the App Store). Reuse the same org + signing + submission playbook.
2. **Android at the same time, or iOS first?** Capacitor makes both cheap, but each store is its own review + assets. Recommend iOS first, Android as a fast follow.
3. **Who owns the native shell build?** Not yet decided. (Do not assume — this needs an explicit call from Matt.)
4. **Target submission date** — Dale's 2026-07-15 log mentioned "open items before Friday"; where does the store push sit against the current roadmap?

---

*Next concrete step: Matt confirms the Capacitor direction + who owns the native shell, and kicks off Apple Developer enrollment (Phase 0). Once an owner is assigned, they scaffold the Capacitor iOS project so we have something real to iterate the compliance checklist against.*
