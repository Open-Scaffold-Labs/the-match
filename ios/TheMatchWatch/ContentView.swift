// Auth switch — keychain token decides the surface. (Phase W0)

import SwiftUI

struct ContentView: View {
    @State private var loggedIn = APIClient.shared.isLoggedIn

    var body: some View {
        if loggedIn {
            HomeView(onSignOut: {
                APIClient.shared.logout()
                loggedIn = false
            })
        } else {
            LoginView(onLoggedIn: { loggedIn = true })
        }
    }
}

#Preview { ContentView() }
