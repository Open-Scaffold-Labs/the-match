# GolfNow Affiliate / Partner — Application Packet

> Prepared 2026-06-06 for submission at https://www.golfnow.com/business-partnership/form
> Applicant entity: **Open Scaffold Labs, LLC**. Submitter/signer: **Dale Raaen** (LLC Account Holder), per the same convention used for Apple Developer / Stripe / Supabase. Matt Lavin (Admin) is the product/technical contact.
> **Do not auto-submit** — submitting agrees the LLC to GolfNow's partner terms. Review, then submit manually.

---

## Field-by-field answers

Use these to fill the form. The form is JS-rendered; exact field labels may differ slightly — map by meaning.

| Field | Value |
|---|---|
| Business / Company name | Open Scaffold Labs, LLC |
| Contact name | Dale Raaen (Account Holder) — or Matt Lavin (product contact), per who submits |
| Contact email | draaen@mac.com (LLC account holder) |
| Product / app name | The Match |
| Website / app URL | https://the-match-roan.vercel.app |
| Business type / category | Mobile golf app (golf companion / social / scoring PWA) |
| Partnership type sought | Affiliate link tier now; Affiliate & Partner API (OAuth 2.0 / REST) as the app's tee-time feature matures |
| Stage / audience | Pre-launch — app fully built and deployed; preparing for public launch, with iOS App Store distribution planned |
| Country | United States |

If the form has a phone field and you want it populated, add the LLC's contact number — that's not on file in my records, so leave it to the submitter.

---

## Partnership description (paste into the "tell us about your business" / message field)

The Match is a mobile-first golf companion app, fully built and preparing for launch, by Open Scaffold Labs, LLC. Unlike GPS- or analytics-led golf apps, The Match is built around head-to-head rivalry: persistent win/loss records between specific playing partners, match history, and round-by-round score outcomes among the people golfers actually play with each week.

It's built for active, repeat golfers — the exact audience that books tee times frequently. The app already includes a "Book a Tee Time" entry point on its home screen, and we want to power that destination through GolfNow so our golfers can search and book live tee-time inventory by course and date directly from their rivalry/scoring workflow. We're preparing for public launch, including distribution through the iOS App Store.

We are seeking an affiliate/partner relationship in two phases:

1. **Now — affiliate links.** Route our existing in-app "Book a Tee Time" placement through a GolfNow affiliate link so bookings our users make are properly attributed, earning commission per round booked.
2. **Next — Affiliate & Partner API.** As our course-detail and tee-time features mature, integrate the GolfNow Affiliate & Partner API (OAuth 2.0, REST/JSON) to pull live inventory by course/date and present "Book a Tee Time" inline on course screens, with GolfNow handling payment and fulfillment.

We have the engineering capability in place (React 19 / Express / Supabase / Vercel stack, OAuth-capable) and an existing booking surface ready to be monetized through GolfNow. We'd welcome a conversation about the right tier and the sandbox/API onboarding path.

---

## Integration notes (internal — not for the form)

- The home-screen "Book a Tee Time" card currently links to a **bare** `https://www.golfnow.com/tee-times` URL (`client/src/pages/Home.jsx`) with no affiliate tracking — it sends GolfNow free traffic and earns $0 today. Step one post-approval: swap that href for the affiliate-tagged link.
- API docs / sandbox: https://affiliate.gnsvc.com/ (OAuth 2.0, REST/JSON, Node.js SDK exists).
- Commission: GolfNow's public affiliate page states a flat ~$3.00 per round booked; confirm the API-partner rate during onboarding (the whitepaper's "3–5%" assumption is unverified).
- Approval is reviewed (not instant self-serve) — expect a follow-up from GolfNow after the form.
- Roadmap home for the full API build: THE-MATCH-WHITEPAPER.md §9, Phase 4 ("Live GPS Course Maps + GolfNow Tee Times").
