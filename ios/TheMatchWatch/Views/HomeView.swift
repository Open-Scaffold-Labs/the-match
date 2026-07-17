// Watch home (Phase W0) — proves the standalone loop: keychain JWT →
// /api/v1/profile over the watch's own network. W1 replaces the placeholder
// with the hole card + digital-crown scoring.

import SwiftUI

struct HomeView: View {
    var onSignOut: () -> Void

    @State private var user: TMUser?
    @State private var error: String?

    private let gold = Color(red: 0.96, green: 0.84, blue: 0.54)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text("THE MATCH")
                        .font(.system(size: 11, weight: .heavy))
                        .kerning(2.5)
                        .foregroundStyle(gold)

                    if let user {
                        Text(user.name ?? "Golfer")
                            .font(.title3.bold())
                        if let hcp = user.handicap?.value {
                            Text(String(format: "Handicap %.1f", hcp))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Divider()
                        // W1 lands here: hole card, crown scoring, putts,
                        // match status. W2: the mic.
                        Label("Scorecard arrives in W1", systemImage: "flag")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Label("Voice arrives in W2", systemImage: "mic")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(.red)
                        Button("Retry") { load() }
                    } else {
                        ProgressView()
                    }

                    Button("Sign Out", role: .destructive, action: onSignOut)
                        .font(.footnote)
                        .padding(.top, 8)
                }
            }
        }
        .task { load() }
    }

    private func load() {
        error = nil
        Task {
            do { user = try await APIClient.shared.profile() }
            catch {
                self.error = error.localizedDescription
                if !APIClient.shared.isLoggedIn { onSignOut() } // expired → login
            }
        }
    }
}

#Preview { HomeView(onSignOut: {}) }
