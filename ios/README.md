# The Match — native shell + Apple Watch app

Phase W0 scaffold (strategy: `~/Projects/The-Match-AppleWatch-Strategy.docx`,
wiki log 2026-07-16). Two targets, one brain: the iOS app is a thin WKWebView
shell around the production PWA (mic capture granted so voice works); the
watch app is native SwiftUI, **standalone-first** — it logs in with email +
4-digit PIN against `/api/v1/auth/login`, keeps the JWT in the keychain, and
talks to the same API as every other client.

## Build (no Apple Developer account needed for simulators)

```bash
brew install xcodegen                # once
cd ios && xcodegen generate          # .xcodeproj is generated, not committed

export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project TheMatch.xcodeproj -scheme TheMatch \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The `TheMatch` scheme builds and embeds the watch app. First build on a new
machine needs the watchOS simulator runtime:
`xcodebuild -downloadPlatform watchOS` (~4 GB).

## Run on the watch simulator

```bash
APP=$(ls -d ~/Library/Developer/Xcode/DerivedData/TheMatch-*/Build/Products/Debug-watchsimulator/TheMatchWatch.app | head -1)
WATCH=$(xcrun simctl list devices available | grep -m1 "Apple Watch" | sed -E 's/.*\(([A-F0-9-]{36})\).*/\1/')
xcrun simctl boot "$WATCH"; xcrun simctl install "$WATCH" "$APP"
xcrun simctl launch "$WATCH" com.openscaffoldlabs.thematch.watchkitapp
```

First boot: `w0-first-boot.png`.

## Device / TestFlight (needs Dale)

Apple Developer Program enrollment ($99/yr) → set `DEVELOPMENT_TEAM` +
automatic signing in Xcode → archive + upload. Until then: simulator-only.

## Roadmap (W-phases from the strategy paper)

- **W0 (this)** — project scaffold, standalone login → profile.
- **W1** — hole card (F/C/B, par, SI, net dot), digital-crown scoring, putt
  chips, haptic saved-chip, workout session + battery telemetry.
- **W2** — voice on the wrist: dictation → `/api/voice/parse` (existing,
  zero new endpoints) → same executor semantics → haptic/glance/AirPods TTS.
- **W3** — watch GPS distances, geofenced hole-advance haptics + GamePlan
  tee-brief glances, complication/Smart Stack.
- **W4** — App Intents ("Hey Siri, tell The Match…"), swing-detect nudge,
  App Store submission.
