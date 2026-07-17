// WKWebView wrapper for the PWA (Phase W0).
//
// Two things matter here beyond "show the site":
//  1. Media capture: the voice features (hold-to-talk, Round Mode WebRTC)
//     need getUserMedia inside the webview — we grant capture permission
//     via WKUIDelegate so the in-app experience matches Safari.
//  2. Persistence: default (non-ephemeral) website data store so tm_token
//     in localStorage survives relaunches exactly like the installed PWA.

import SwiftUI
import WebKit

struct WebShellView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        // Grant mic (and future camera) capture to our own origin only —
        // the voice stack depends on this; everything else keeps defaults.
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            let trusted = origin.host.hasSuffix("vercel.app") || origin.host.hasSuffix("openscaffoldlabs.com")
            decisionHandler(trusted ? .grant : .deny)
        }
    }
}
