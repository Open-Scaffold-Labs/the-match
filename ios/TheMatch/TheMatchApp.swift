// The Match — iOS shell (Phase W0).
// A thin native container around the production PWA. Purpose: App Store
// presence, Watch companionship, and (W4) App Intents / Hey Siri. The web
// app remains the product; this shell must never fork its behavior.

import SwiftUI

@main
struct TheMatchApp: App {
    var body: some Scene {
        WindowGroup {
            WebShellView(url: URL(string: "https://the-match-roan.vercel.app")!)
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
        }
    }
}
