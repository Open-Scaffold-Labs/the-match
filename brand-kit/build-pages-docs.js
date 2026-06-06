const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, PageBreak, BorderStyle, AlignmentType, ImageRun } = require("docx");
const K = require("./brandkit.js");
const { C, SERIF, SANS, CONTENT_W, T } = K;

const DIR = __dirname;
const PAGE = {
  size: { width: 12240, height: 15840 },
  margin: { top: 1440, right: 1530, bottom: 1440, left: 1530 },
};
const COVER_PAGE = {
  size: { width: 12240, height: 15840 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
};

// full-bleed cover image (8.5x11in = 816x1056 px at 96dpi)
function coverImage() {
  return new Paragraph({ spacing: { after: 0 }, children: [ new ImageRun({
    type: "png", data: fs.readFileSync(DIR + "/cover.png"),
    transformation: { width: 816, height: 1056 },
    altText: { title: "The Match", description: "Social Media Strategy cover", name: "cover" },
  }) ] });
}
// full-width banner for the one-pager (content width 9180 DXA = 612px; height keeps 5.30 ratio)
function bannerImage() {
  return new Paragraph({ spacing: { after: 160 }, children: [ new ImageRun({
    type: "png", data: fs.readFileSync(DIR + "/banner.png"),
    transformation: { width: 612, height: 231 },
    altText: { title: "The Match", description: "Social media plan banner", name: "banner" },
  }) ] });
}

const docDefaults = {
  background: { color: C.CREAM },
  styles: { default: { document: { run: { font: SANS, size: 21, color: C.BODY } } } },
  numbering: K.numbering,
};

// ===================================================================
//  COVER (full strategy)
// ===================================================================
function coverChildren() {
  const out = [];
  out.push(new Paragraph({ spacing: { before: 700, after: 0 },
    tabStops: [{ type: "right", position: CONTENT_W }],
    children: [
      new TextRun({ text: "GOLFNOW AFFILIATE PROGRAM", font: SANS, color: C.GOLDTX, bold: true,
        size: 17, allCaps: true, characterSpacing: 70 }),
      new TextRun({ text: "\tM", font: SERIF, color: C.GOLD, size: 30 }),
    ] }));
  out.push(new Paragraph({ spacing: { before: 1500, after: 130 },
    children: [
      new TextRun({ text: "——   ", font: SANS, color: C.GOLD, size: 18 }),
      new TextRun({ text: "SOCIAL MEDIA STRATEGY · 2026", font: SANS, color: C.GOLDTX, bold: true,
        size: 18, allCaps: true, characterSpacing: 60 }),
    ] }));
  out.push(K.display("The Match", { size: 96, after: 120 }));
  out.push(new Paragraph({ spacing: { after: 60, line: 320 }, children: [
    new TextRun({ text: "Turning every round into shareable content — and shareable content into booked tee times.",
      font: SERIF, italics: true, color: C.GREEN2, size: 28 }),
  ] }));
  out.push(K.hairline(260, 240));
  out.push(K.statStrip([
    { n: "3", label: ["Lead", "channels"] },
    { n: "1", label: ["Owned share", "loop"] },
    { n: "8", label: ["Core features", "live"] },
    { n: "41M+", label: ["US golfers"] },
    { n: "0", label: ["Paid-spend", "dependence"] },
  ]));
  out.push(new Paragraph({ spacing: { before: 1600 },
    tabStops: [{ type: "right", position: CONTENT_W }],
    children: [
      new TextRun({ text: "PREPARED FOR THE GOLFNOW AFFILIATE TEAM", font: SANS, color: C.MUTED,
        size: 15, allCaps: true, characterSpacing: 50 }),
      new TextRun({ text: "\tTHE MATCH · INC.", font: SANS, color: C.MUTED, size: 15,
        allCaps: true, characterSpacing: 50 }),
    ] }));
  out.push(new Paragraph({ spacing: { before: 30 },
    tabStops: [{ type: "right", position: CONTENT_W }],
    children: [
      new TextRun({ text: "MOBILE GOLF COMPANION APP", font: SANS, color: C.MUTED, size: 15,
        allCaps: true, characterSpacing: 50 }),
      new TextRun({ text: "\tTHE-MATCH-ROAN.VERCEL.APP", font: SANS, color: C.MUTED, size: 15,
        allCaps: true, characterSpacing: 50 }),
    ] }));
  return out;
}

// ===================================================================
//  FULL STRATEGY — body
// ===================================================================
function strategyBody() {
  const c = [];

  // Executive Summary
  c.push(...K.section("EXECUTIVE SUMMARY", ["A category-defining", "content engine."]));
  c.push(K.lede([
    T("The Match is a mobile golf companion app built for the way friends actually play: live head-to-head scoring on a tournament-grade scoreboard, an AI rangefinder, handicap tracking, and the social layer that ties a foursome together. Our marketing thesis is simple — ", { size: 23 }),
    T("the product is the content engine.", { size: 23, bold: true, color: C.GREEN2 }),
  ]));
  c.push(K.body([
    T("Every match The Match scores ends on a screen with a one-tap “share to social” button that exports a branded, broadcast-style result card and a live link. Players post their own wins; their golf buddies see it; the buddies download the app to settle the next match. That loop is the heart of the strategy."),
  ]));
  c.push(K.subhead("Where GolfNow fits"));
  c.push(K.body([
    T("A match doesn’t end the conversation — it starts the next one. The moment a round is logged, the natural next action is "),
    T("“when are we playing again, and where?”", { italics: true, color: C.GREEN2 }),
    T(" The Match already surfaces a Book a Tee Time entry point powered by GolfNow on the home screen and in the tee-time scheduler. Our social content manufactures that intent at scale and routes it into the app, where the booking happens through GolfNow."),
  ]));
  c.push(...K.pullQuote("Golf is deeply social and deeply competitive. We’re not marketing an app feature — we’re marketing bragging rights, and bragging rights travel."));
  c.push(K.subhead("Strategy at a glance"));
  c.push(K.table(
    ["Lever", "What we do", "Outcome"],
    [
      ["Owned viral loop", "Every match ends with a share-to-social card + live link", "Free, authentic reach from real players"],
      ["Lead channels", "Instagram / Reels, TikTok, X", "Attention where golfers already are"],
      ["Content pillars", "Rivalry & Results, The Tech, Golf Culture", "A repeatable, on-brand calendar"],
      ["Referral flywheel", "In-app invite links credit free Elite time", "Lower CAC; members recruit members"],
      ["GolfNow conversion", "In-app Book a Tee Time after every round", "Bookings driven by post-round intent"],
    ],
    [2050, 4380, 2750]
  ));

  // 1. Product
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION ONE", ["Eight features.", "One flywheel."]));
  c.push(K.lede([T("A cohesive, beautifully designed mobile platform — and the surfaces our content puts on camera. This is what ships today; we don’t market vaporware.", { size: 23 })]));
  c.push(K.featureGrid([
    { title: "Augusta-style scoreboard", idx: "LIVE", body: "Tournament-grade scorecard with animated score reveals, birdie circles and bogey squares, and real per-hole pars pulled from the course." },
    { title: "Multi-format scoring", idx: "LIVE", body: "Stroke, match play, best ball, skins, stableford, and four-ball match play with live team standings — how every group actually competes." },
    { title: "Eagle Eye AI rangefinder", idx: "LIVE", body: "GPS distances, satellite course view, weather, and an AI club recommendation with a projected landing target. The strongest video hook." },
    { title: "Solo Round", idx: "LIVE", body: "Full live scoring for a round on your own, with auto-resume after interruptions. A daily-use habit driver, not just group play." },
    { title: "Stats & handicap", idx: "LIVE", body: "USGA-style handicap index, score-trend chart, club distances, and improvement milestones. Fuel for progress posts." },
    { title: "Live PGA Tour leaderboard", idx: "LIVE", body: "Real-time tournament scores with player photos — ties the brand to the pro game during tournament weeks." },
    { title: "Social graph", idx: "LIVE", body: "Friends, followers, a friends-playing-now live feed, and in-app spectator mode. Network effects and a reason to invite buddies." },
    { title: "Tee-time scheduling + GolfNow", idx: "LIVE", body: "Schedule and invite friends to a tee time, with Book a Tee Time via GolfNow — the direct affiliate conversion surface." },
  ]));
  c.push(K.subhead("The built-in share-to-social loop"));
  c.push(K.body([T("This is the single most important asset for social marketing. The Match generates polished, branded 1080×1080 cards designed to post straight to Instagram, TikTok, and X:")]));
  c.push(K.bullet([T("Match-end share card — ", { bold: true, color: C.GREEN2 }), T("the end-of-match screen has a Save share image button plus a shareable live link; the card shows the winner, final score, a top-three podium, and the date.")]));
  c.push(K.bullet([T("Highlight cards — ", { bold: true, color: C.GREEN2 }), T("a celebration card fires automatically on a birdie, eagle, or hole-in-one, ready to share the moment it happens.")]));
  c.push(K.bullet([T("Year-in-golf recap — ", { bold: true, color: C.GREEN2 }), T("a season wrap-up card (rounds, best round, eagles, birdies, top course) — a Spotify-Wrapped-style annual moment.")]));
  c.push(K.bullet([T("PGA-style player cards — ", { bold: true, color: C.GREEN2 }), T("the avatar generator builds a tour-broadcast-style player photo with a country flag, so every user looks like a pro.")]));
  c.push(K.bullet([T("QR share + auto-join — ", { bold: true, color: C.GREEN2 }), T("a scannable code drops a friend straight into your match; invite links survive signup so new users land in the right place.")]));
  c.push(K.subhead("The referral flywheel"));
  c.push(K.body([T("The Match ships an in-app referral program: members share an invite link, and qualifying signups credit the referrer with free Elite time (the referred friend gets a head start too). Qualifying requires actually playing a round, which keeps the loop honest. Our most engaged players have a built-in incentive to recruit — we amplify it, we don’t have to build it.")]));

  // 2. Audience
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION TWO", "Who we’re speaking to."));
  c.push(K.lede([T("We market to the golfers most likely to play often, bring friends, and book tee times — which is exactly the GolfNow customer.", { size: 23 })]));
  c.push(K.table(
    ["Segment", "Who they are", "Hook"],
    [
      ["The Competitive Foursome", "Friend groups who play weekly and bet on it", "Live scoreboard + side bets (Nassau, skins)"],
      ["The Improver", "Mid-handicap golfers chasing a number", "Eagle Eye + stats + achievements"],
      ["The Content Golfer", "Follows GoodGood, Bob Does Sports, golf TikTok", "PGA-style cards + share-to-social"],
      ["The Organizer", "Plans the group’s rounds and trips", "Tee-time scheduling + GolfNow booking"],
    ],
    [2550, 3730, 2900]
  ));
  c.push(K.body([
    T("All four converge on the same action for GolfNow: "),
    T("they book tee times.", { bold: true, color: C.GREEN2 }),
    T(" Our content speaks to each, then funnels all of them to the same Book a Tee Time action."),
  ]));

  // 3. Pillars
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION THREE", "Three content pillars."));
  c.push(K.lede([T("Three pillars keep the calendar repeatable and on-brand. Every post maps to one — roughly a 40 / 35 / 25 split.", { size: 23 })]));
  c.push(K.subhead("Rivalry & Results · 40%"));
  c.push(K.body("The emotional core. Golf is more fun with something on the line, and The Match keeps score."));
  c.push(K.bullet("Match finishes pulled straight from the app’s share card — “Won on 18. Dormie no more.”"));
  c.push(K.bullet("Side-bet drama: Nassau presses, skins carryovers, the $5 that changed hands."));
  c.push(K.bullet("Friend-group rivalry skits — the sandbagger, the gimme-taker, the “forgotten” stroke."));
  c.push(K.subhead("The Tech · 35%"));
  c.push(K.body("Show, don’t tell. The app looks expensive on camera — use it."));
  c.push(K.bullet("Eagle Eye in action: point, get the number, get the club, hit the shot."));
  c.push(K.bullet("The Augusta-style board filling in live — satisfying, premium, instantly recognizable."));
  c.push(K.bullet("Feature reveals and 20-second “how it works” explainers, one feature at a time."));
  c.push(K.subhead("Golf Culture · 25%"));
  c.push(K.body("Earn the follow even when someone isn’t ready to download."));
  c.push(K.bullet("Tournament-week reactions, tied to the in-app live PGA leaderboard."));
  c.push(K.bullet("Relatable golf humor, hot takes, and polls (great for X)."));
  c.push(K.bullet("Bucket-list courses and “where should we play next” — a natural bridge to Book a Tee Time."));

  // 4. Playbooks
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION FOUR", ["Platform", "playbooks."]));
  c.push(K.lede([T("We lead with three channels: Instagram is the flagship because the share cards are made for it; TikTok is the discovery engine; X is for community and tournament-week conversation.", { size: 23 })]));
  c.push(K.subhead("Instagram / Reels — flagship"));
  c.push(K.body([T("The in-app share card is a native Instagram object. The end-of-match share flow exports a 1080×1080 card that drops straight into a feed post or Story, and the highlight and year-in-golf cards do the same.")]));
  c.push(K.bullet([T("Reels (3–4/week): ", { bold: true, color: C.GREEN2 }), T("Eagle Eye demos, board fill-ups, rivalry finishes, feature reveals.")]));
  c.push(K.bullet([T("Stories: ", { bold: true, color: C.GREEN2 }), T("reshare user-posted match cards (tag-to-be-featured), polls, link stickers to the app and to Book a Tee Time.")]));
  c.push(K.bullet([T("UGC engine: ", { bold: true, color: C.GREEN2 }), T("ask users to tag the brand when they post a share card; feature the best ones — our cheapest, most credible reach.")]));
  c.push(K.subhead("TikTok — discovery"));
  c.push(K.body([T("TikTok’s algorithm gives a new account real reach without a following, and it’s where golf content travels fastest. We re-cut the same source footage for TikTok’s pacing.")]));
  c.push(K.bullet([T("4–5 short videos/week, ", { bold: true, color: C.GREEN2 }), T("native-feeling, trend-aware, sound-on.")]));
  c.push(K.bullet([T("Series formats build watch-time: ", { bold: true, color: C.GREEN2 }), T("“Settle the match,” “Guess the yardage,” “Rate this finish.”")]));
  c.push(K.bullet([T("Creator seeding: ", { bold: true, color: C.GREEN2 }), T("send the app to mid-tier golf creators; let them run a real match and post the result card.")]));
  c.push(K.subhead("X (Twitter) — community"));
  c.push(K.body([T("“Golf Twitter” is a tight, vocal community, and X rewards real-time reaction. The in-app live PGA leaderboard makes us a credible voice during tournament weeks.")]));
  c.push(K.bullet([T("Daily presence: ", { bold: true, color: C.GREEN2 }), T("hot takes, polls, and replies — personality over promotion.")]));
  c.push(K.bullet([T("Tournament live-posting ", { bold: true, color: C.GREEN2 }), T("and Thursday–Friday “book the weekend” nudges with the GolfNow link.")]));
  c.push(K.subhead("Channel summary"));
  c.push(K.table(
    ["Channel", "Role", "Cadence"],
    [
      ["Instagram / Reels", "Flagship + owned share loop", "3–4 Reels + daily Stories"],
      ["TikTok", "Discovery engine", "4–5 videos / week"],
      ["X (Twitter)", "Community + tournament weeks", "Daily, surge on event days"],
    ],
    [2700, 4080, 2400]
  ));

  // 5. Cadence
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION FIVE", "A weekly rhythm."));
  c.push(K.lede([T("A sustainable cadence. One filming session a week produces footage that’s re-cut across all three channels.", { size: 23 })]));
  c.push(K.table(
    ["Day", "Instagram", "TikTok", "X"],
    [
      ["Mon", "Reel: Eagle Eye demo", "“Guess the yardage”", "Poll / recap take"],
      ["Tue", "Story: UGC reshare", "Rivalry skit", "Hot take + replies"],
      ["Wed", "Match-of-the-week card", "Feature reveal", "Match card repost"],
      ["Thu", "Reel: rivalry finish", "“Settle the match”", "“Book the weekend” + link"],
      ["Fri", "Story: poll + booking", "Course / bucket-list", "Tournament preview"],
      ["Sat–Sun", "Stories: live + play", "1 trend-driven short", "Live tournament posts"],
    ],
    [1100, 3060, 2620, 2400]
  ));

  // 6. GolfNow conversion
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION SIX", ["Driving GolfNow", "bookings."]));
  c.push(K.lede([T("The funnel is built so that booking a tee time through GolfNow is the natural next step once the content does its job.", { size: 23 })]));
  c.push(K.subhead("The funnel"));
  c.push(K.numbered("Attention — a Reel/TikTok/X post reaches a golfer."));
  c.push(K.numbered("Install — the share card and CTA drive a download; referral links credit the inviter."));
  c.push(K.numbered("Engagement — the golfer logs a round (solo or with friends)."));
  c.push(K.numbered("Intent — the round ends; the share card prompts “when/where next?” and pulls friends in."));
  c.push(K.numbered("Booking — the in-app Book a Tee Time (GolfNow) converts that intent into a reservation."));
  c.push(K.subhead("Why post-round intent converts"));
  c.push(K.body([T("Booking intent is highest right after a round and right after a group agrees to play again — and The Match owns both moments. Presenting GolfNow at the exact moment a group has decided to play is a materially better context than a cold ad. All affiliate links are disclosed per platform and FTC norms.")]));

  // 7. KPIs
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION SEVEN", "How we measure it."));
  c.push(K.lede([T("We measure the whole funnel — not vanity reach — so we can prove the affiliate value and optimize toward bookings.", { size: 23 })]));
  c.push(K.table(
    ["Funnel stage", "Metric", "Why it matters"],
    [
      ["Reach", "Views, reach, follower growth", "Top-of-funnel health"],
      ["Engagement", "Saves, shares, comments, watch-time", "Quality + algorithmic lift"],
      ["Owned loop", "User-generated share cards posted", "Free reach from real players"],
      ["Acquisition", "App installs; referral signups", "Audience → user conversion"],
      ["Activation", "Rounds logged per new user", "Are installs becoming golfers?"],
      ["Booking (GolfNow)", "Clicks to book; affiliate bookings", "The partnership’s revenue metric"],
    ],
    [2300, 3880, 3000]
  ));

  // 8. Rollout
  c.push(new Paragraph({ children: [new PageBreak()] }));
  c.push(...K.section("SECTION EIGHT", "A 90-day rollout."));
  c.push(K.table(
    ["Phase", "Focus", "Key actions"],
    [
      ["Days 1–30 · Foundation", "Set up and seed", "Brand the channels; standardize the share-card look; publish the first 12–15 posts; turn on the UGC ask; place GolfNow links."],
      ["Days 31–60 · Momentum", "Find what works", "Double down on top formats; begin TikTok creator seeding; start Thursday–Friday booking pushes; first KPI review."],
      ["Days 61–90 · Convert", "Optimize for bookings", "Scale winners; lean into tournament-week conversion; A/B test booking CTAs; report the full install→round→booking funnel."],
    ],
    [2300, 1980, 4900]
  ));
  c.push(...K.pullQuote("We have what most affiliates don’t: a product that makes its own shareable content and creates booking intent as a byproduct of play."));
  return c;
}

// ===================================================================
//  ONE-PAGER (strictly social media)
// ===================================================================
function onePager() {
  const c = [];
  c.push(bannerImage());

  c.push(K.eyebrow("The approach"));
  c.push(K.body([
    T("Our strategy turns The Match into its own content engine. Every match ends with a one-tap "),
    T("“share to social”", { bold: true, color: C.GREEN2 }),
    T(" button that exports a branded result card and a live link. Players post their wins, their golf buddies see it, and the buddies download the app to settle the next match. We lead with "),
    T("Instagram (Reels first), TikTok, and X", { bold: true, color: C.GREEN2 }),
    T(", amplify that owned share loop with our own channels, and grow from real players rather than paid spend."),
  ]));

  c.push(K.eyebrow("Channels"));
  c.push(K.table(
    ["Channel", "Role", "Lead content", "Cadence"],
    [
      ["Instagram / Reels", "Flagship + share loop", "Reels, match cards, Stories, UGC", "3–4 Reels + daily Stories"],
      ["TikTok", "Discovery engine", "Trend shorts, skits, tech demos", "4–5 / week"],
      ["X (Twitter)", "Community + events", "Takes, polls, live reactions", "Daily; surge on events"],
    ],
    [2150, 2150, 3080, 1800]
  ));

  c.push(K.eyebrow("Content pillars"));
  c.push(K.bullet([T("Rivalry & Results (40%) — ", { bold: true, color: C.GREEN2 }), T("match finishes from the in-app share card, side-bet drama, friend-group rivalry skits.")]));
  c.push(K.bullet([T("The Tech (35%) — ", { bold: true, color: C.GREEN2 }), T("the AI rangefinder and the tournament-style live scoreboard on camera; quick feature reveals.")]));
  c.push(K.bullet([T("Golf Culture (25%) — ", { bold: true, color: C.GREEN2 }), T("tournament-week reactions, golf humor, polls, and bucket-list course content.")]));

  c.push(K.eyebrow("The owned viral loop"));
  c.push(K.body([
    T("The app generates polished 1080×1080 cards made for social: the "),
    T("end-of-match share card", { bold: true, color: C.GREEN2 }),
    T(", auto-firing "),
    T("highlight cards", { bold: true, color: C.GREEN2 }),
    T(" on a birdie/eagle/hole-in-one, a "),
    T("year-in-golf recap", { bold: true, color: C.GREEN2 }),
    T(", and PGA-style player cards. We seed the behavior, keep the look consistent, and feature the best user posts — so much of our creative is made by players, for free."),
  ]));

  c.push(K.eyebrow("How we measure it"));
  c.push(K.body([T("Reach and follower growth by channel; engagement (saves, shares, comments, watch-time); user-generated share cards posted; and app installs driven from social — reviewed monthly so we double down on what works.")]));
  return c;
}

// ===================================================================
//  EMIT
// ===================================================================
function buildStrategy(path) {
  const doc = new Document({
    ...docDefaults,
    sections: [
      { properties: { page: COVER_PAGE }, children: [coverImage()] },
      { properties: { page: PAGE },
        headers: { default: K.runHeader("GOLFNOW AFFILIATE PROGRAM") },
        footers: { default: K.runFooter() },
        children: strategyBody() },
    ],
  });
  return Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path, b); console.log("WROTE " + path + " " + b.length); });
}

function buildOnePager(path) {
  const doc = new Document({
    ...docDefaults,
    sections: [
      { properties: { page: PAGE },
        footers: { default: K.runFooter() },
        children: onePager() },
    ],
  });
  return Packer.toBuffer(doc).then((b) => { fs.writeFileSync(path, b); console.log("WROTE " + path + " " + b.length); });
}

(async () => {
  await buildStrategy(process.argv[2]);
  await buildOnePager(process.argv[3]);
})();
