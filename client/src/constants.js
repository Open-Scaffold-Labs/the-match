export const TABS = {
  HOME:    'home',
  EYE:     'eye',
  OUTING:  'outing',
  // 2026-07-09 — Phase 0 nav restructure (start-match-unified-flow plan):
  //   - LEAGUES removed as a top-level tab; Leagues now lives inside the
  //     Match (OUTING) tab behind a `Matches | Leagues` segmented toggle.
  //     A stale persisted 'leagues' tab value is remapped to OUTING in
  //     App.jsx's readPersistedTab.
  //   - PROFILE promoted from a Home sub-view (homeView==='profile') to
  //     its own bottom-nav tab.
  // BAG is retained as a route-level value so deep links to '?tab=bag'
  // still resolve to the My Bag landing (2026-05-02).
  PROFILE: 'profile',
  BAG:     'bag',
  TOUR:    'tour',
}
