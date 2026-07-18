// Watch login (Phase W0) — standalone: email once (dictation/scribble),
// then the 4-digit PIN. Same /auth/login the phone uses; JWT → keychain.
// W0 keeps it deliberately plain; the phone-handoff via WatchConnectivity
// arrives with the shell pairing work.

import SwiftUI

struct LoginView: View {
    var onLoggedIn: () -> Void

    @State private var email = ""
    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("THE MATCH")
                    .font(.system(size: 12, weight: .heavy))
                    .kerning(2.5)
                    .foregroundStyle(Color(red: 0.96, green: 0.84, blue: 0.54))

                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)

                TextField("4-digit PIN", text: $pin)
                    .textContentType(.password)

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button(action: signIn) {
                    if busy { ProgressView() } else { Text("Sign In").fontWeight(.bold) }
                }
                .disabled(busy || email.isEmpty || pin.count < 4)
                .tint(Color(red: 0.79, green: 0.63, blue: 0.25))
            }
        }
    }

    private func signIn() {
        busy = true
        error = nil
        Task {
            do {
                _ = try await APIClient.shared.login(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    pin: pin.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                busy = false
                onLoggedIn()
            } catch {
                busy = false
                self.error = error.localizedDescription
            }
        }
    }
}

#Preview { LoginView(onLoggedIn: {}) }
