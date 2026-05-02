export const TABS = {
  HOME:    'home',
  EYE:     'eye',
  OUTING:  'outing',
  // Replaced BAG with LEAGUES on 2026-05-02: My Bag content is now a
  // card on Home; this slot hosts the paid-tier League surface
  // (LeaguesHub for Elite users, LeaguesPaywall for free users).
  // BAG is retained as a route-level value so deep links to '?tab=bag'
  // still resolve to the My Bag landing on Home.
  LEAGUES: 'leagues',
  BAG:     'bag',
  TOUR:    'tour',
}
