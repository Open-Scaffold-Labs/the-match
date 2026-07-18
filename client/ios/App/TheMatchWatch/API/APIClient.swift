// The Match watch — API client (Phase W0).
//
// Standalone-first: the watch talks DIRECTLY to /api/v1 over its own
// network with the user's JWT (design rule: phone optional, walker
// first-class). Same endpoints as every other client; the watch is a new
// terminal onto the same brain, never a fork.

import Foundation

struct TMUser: Decodable {
    // Production sends id as a STRING ("35") on the login path — verified
    // live 2026-07-17 (the watch's first real-world bug). Numbers from
    // Postgres arrive as strings on several paths; accept both everywhere.
    let id: Flexible<Int>
    let name: String?
    let email: String?
    let handicap: Flexible<Double>?
}

struct LoginResponse: Decodable {
    let token: String
    let user: TMUser
}

struct ProfileResponse: Decodable {
    let user: TMUser
}

/// Decodes a value that may arrive as its type OR as a string.
struct Flexible<T: Decodable & LosslessStringConvertible>: Decodable {
    let value: T
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(T.self) { value = v; return }
        let s = try c.decode(String.self)
        guard let v = T(s) else {
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "not a \(T.self): \(s)")
        }
        value = v
    }
}

enum APIError: LocalizedError {
    case http(Int, String?)
    case notLoggedIn

    var errorDescription: String? {
        switch self {
        case .http(let code, let message): return message ?? "Request failed (\(code))"
        case .notLoggedIn: return "Not signed in"
        }
    }
}

final class APIClient {
    static let shared = APIClient()
    static let baseURL = URL(string: "https://the-match-roan.vercel.app/api/v1")!
    private static let tokenKey = "tm_token"

    // Patient session for the wrist (see note in request()).
    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.waitsForConnectivity = true
        cfg.timeoutIntervalForResource = 60
        return URLSession(configuration: cfg)
    }()

    var token: String? { Keychain.get(Self.tokenKey) }
    var isLoggedIn: Bool { token != nil }

    func logout() { Keychain.delete(Self.tokenKey) }

    func login(email: String, pin: String) async throws -> TMUser {
        let body = ["email": email, "pin": pin]
        let response: LoginResponse
        do {
            response = try await request("auth/login", method: "POST", body: body, authorized: false)
        } catch let e as URLError where e.code == .timedOut || e.code == .networkConnectionLost {
            // One automatic retry — the first attempt often just warmed the route.
            response = try await request("auth/login", method: "POST", body: body, authorized: false)
        }
        Keychain.set(response.token, for: Self.tokenKey)
        return response.user
    }

    func profile() async throws -> TMUser {
        let response: ProfileResponse = try await request("profile")
        return response.user
    }

    // ── Core request ─────────────────────────────────────────────────────────
    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil,
        authorized: Bool = true
    ) async throws -> T {
        var req = URLRequest(url: Self.baseURL.appending(path: path))
        req.httpMethod = method
        req.timeoutInterval = 30
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized {
            guard let token else { throw APIError.notLoggedIn }
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        // waitsForConnectivity: on a fresh install watchOS can take many
        // seconds deciding between phone-proxy and Wi-Fi; racing a timer
        // produced Dale's field timeout (2026-07-17). Wait, then one retry.
        let (data, resp) = try await Self.session.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            if code == 401, authorized { logout() } // expired token → clean re-login
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw APIError.http(code, message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
