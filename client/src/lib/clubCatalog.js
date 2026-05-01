// Curated catalog of golf clubs by category, brand, and model. Used by
// the My Bag club picker so users select their actual clubs from a
// known list rather than free-text input.
//
// Coverage: major OEMs, recent flagship lines (roughly 2022-2025). Not
// exhaustive — when a player's club isn't here, we'll add it. Each
// category maps to the 14 fixed bag slots defined in
// migrations/009_tm_user_clubs.sql.
//
// (2026-05-01 — initial seed)

// ─── Slot definitions ────────────────────────────────────────────────────────
// Order matters — UI renders slots in this order.
export const SLOTS = [
  { key: 'driver',   label: 'Driver',     category: 'driver' },
  { key: '3w',       label: '3 Wood',     category: 'fairway' },
  { key: '5w',       label: '5 Wood',     category: 'fairway' },
  { key: '7w',       label: '7 Wood',     category: 'fairway' },
  { key: 'hybrid_1', label: 'Hybrid 1',   category: 'hybrid' },
  { key: 'hybrid_2', label: 'Hybrid 2',   category: 'hybrid' },
  { key: 'iron_3',   label: '3 Iron',     category: 'iron' },
  { key: 'iron_4',   label: '4 Iron',     category: 'iron' },
  { key: 'iron_5',   label: '5 Iron',     category: 'iron' },
  { key: 'iron_6',   label: '6 Iron',     category: 'iron' },
  { key: 'iron_7',   label: '7 Iron',     category: 'iron' },
  { key: 'iron_8',   label: '8 Iron',     category: 'iron' },
  { key: 'iron_9',   label: '9 Iron',     category: 'iron' },
  { key: 'pw',       label: 'Pitching Wedge', category: 'wedge' },
  { key: 'gw',       label: 'Gap Wedge',  category: 'wedge' },
  { key: 'sw',       label: 'Sand Wedge', category: 'wedge' },
  { key: 'lw',       label: 'Lob Wedge',  category: 'wedge' },
  { key: 'putter',   label: 'Putter',     category: 'putter' },
]

// Map slot key → readable label (and back). Used by both UI and server
// validation surfaces.
export const SLOT_LABELS = Object.fromEntries(SLOTS.map(s => [s.key, s.label]))

// Lookup: which category does this slot belong to.
export const SLOT_CATEGORY = Object.fromEntries(SLOTS.map(s => [s.key, s.category]))

// ─── Catalog: { category: { brand: [models] } } ──────────────────────────────
export const CATALOG = {
  driver: {
    Callaway:   ['Paradym', 'Paradym Triple Diamond', 'Paradym Ai Smoke', 'Paradym Ai Smoke Triple Diamond', 'Elyte', 'Elyte Triple Diamond', 'Rogue ST Max', 'Rogue ST Max LS'],
    TaylorMade: ['Stealth 2', 'Stealth 2 Plus', 'Stealth 2 HD', 'Qi10', 'Qi10 Max', 'Qi10 LS', 'Qi35', 'Qi35 Max', 'Qi35 LS'],
    Titleist:   ['TSR1', 'TSR2', 'TSR3', 'TSR4', 'GT1', 'GT2', 'GT3', 'GT4'],
    Ping:       ['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G440 Max', 'G440 LST', 'G440 SFT'],
    Cobra:      ['Aerojet', 'Aerojet LS', 'Aerojet Max', 'Darkspeed', 'Darkspeed LS', 'Darkspeed Max', 'DS-Adapt LS', 'DS-Adapt Max'],
    Mizuno:     ['ST-Z 230', 'ST-X 230', 'ST-Max 230', 'ST-Z 240', 'ST-X 240', 'ST-G'],
    Srixon:     ['ZX5 Mk II', 'ZX7 Mk II', 'ZX5 LS Mk II'],
    Wilson:     ['Dynapwr', 'Dynapwr Carbon'],
  },

  fairway: {
    Callaway:   ['Paradym', 'Paradym Triple Diamond', 'Paradym Ai Smoke', 'Elyte', 'Rogue ST Max', 'Rogue ST Max Heaven'],
    TaylorMade: ['Stealth 2', 'Stealth 2 Plus', 'Stealth 2 HD', 'Qi10', 'Qi10 Max', 'Qi10 Tour', 'Qi35'],
    Titleist:   ['TSR2', 'TSR3', 'GT2', 'GT3'],
    Ping:       ['G430 Max', 'G430 LST', 'G430 SFT', 'G440 Max', 'G440 LST', 'G440 SFT'],
    Cobra:      ['Aerojet', 'Aerojet LS', 'Aerojet Max', 'Darkspeed', 'Darkspeed LS', 'Darkspeed Max'],
    Mizuno:     ['ST-Z 230', 'ST-X 230', 'ST-Max 230'],
    Srixon:     ['ZX Mk II'],
  },

  hybrid: {
    Callaway:   ['Paradym', 'Apex Pro 24', 'Apex 24', 'Elyte', 'Rogue ST Max'],
    TaylorMade: ['Stealth 2', 'Stealth 2 Plus', 'Qi10', 'Qi10 Tour', 'Qi35'],
    Titleist:   ['TSR2', 'TSR3', 'GT2', 'GT3'],
    Ping:       ['G430', 'G430 HL', 'G440', 'G440 HL'],
    Cobra:      ['Aerojet', 'Aerojet One Length', 'Darkspeed', 'Darkspeed Max'],
    Mizuno:     ['CLK Hybrid'],
    Srixon:     ['ZX Mk II'],
  },

  iron: {
    Callaway:   ['Apex Pro 24', 'Apex 24', 'Apex CB 24', 'Apex MB 24', 'Paradym Ai Smoke', 'Paradym Ai Smoke HL', 'Paradym X', 'Rogue ST Max', 'Rogue ST Max OS'],
    TaylorMade: ['P770 (2024)', 'P790 (2024)', 'P7MC (2023)', 'P7MB (2023)', 'P-770', 'Qi (2024)', 'Qi HL', 'Stealth', 'Stealth HD'],
    Titleist:   ['T100 (2025)', 'T150 (2025)', 'T200 (2025)', 'T350 (2025)', 'T100 (2023)', 'T150 (2023)', 'T200 (2023)', 'T350 (2023)', '620 MB', '620 CB'],
    Ping:       ['Blueprint S', 'Blueprint T', 'i230', 'i530', 'i525', 'G430', 'G440'],
    Cobra:      ['King Tour', 'King Tour MIM', 'King MIM Tour', 'Forged Tec X', 'Darkspeed', 'Aerojet', 'Limit3d'],
    Mizuno:     ['JPX 925 Tour', 'JPX 925 Forged', 'JPX 925 Hot Metal', 'JPX 925 Hot Metal Pro', 'JPX 923 Tour', 'JPX 923 Forged', 'JPX 923 Hot Metal', 'Pro 241', 'Pro 243', 'Pro 245', 'MP-20 MMC'],
    Srixon:     ['ZX5 Mk II', 'ZX7 Mk II', 'ZX4 Mk II', 'ZXi5', 'ZXi7'],
    Wilson:     ['Staff Model Blade', 'Staff Model CB', 'Staff Model Utility', 'Dynapwr Forged', 'D9 Forged'],
  },

  wedge: {
    Titleist:   ['Vokey SM10', 'Vokey SM9', 'Vokey WedgeWorks'],
    Cleveland:  ['RTX 6 ZipCore', 'RTX ZipCore', 'CBX 4 ZipCore', 'CBX Full-Face 2', 'Smart Sole 4'],
    TaylorMade: ['MG4', 'MG4 Tiger Woods', 'Hi-Toe 3', 'MG3'],
    Callaway:   ['Opus', 'Opus Platinum', 'Jaws Raw', 'Jaws Full Toe', 'Mack Daddy CB'],
    Ping:       ['S159', 'Glide 4.0', 'Glide Forged Pro'],
    Mizuno:     ['T24', 'T22', 'ES21'],
    Cobra:      ['King MIM Tour', 'Snakebite', 'Snakebite-X'],
  },

  putter: {
    'Scotty Cameron': ['Newport', 'Newport 2', 'Newport 2 Plus', 'Phantom 5', 'Phantom 5.5', 'Phantom 7', 'Phantom 9', 'Phantom 11', 'Super Select Newport', 'Super Select Newport 2', 'Super Select Squareback 2', 'Super Select Fastback 1.5', 'Super Select GoLo 6.5'],
    Odyssey:    ['Ai-One Cruiser', 'Ai-One #1', 'Ai-One #7', 'Ai-One Milled', 'Ai-One Square 2 Square', 'White Hot OG', 'White Hot OG #7', 'Toulon Las Vegas', 'Toulon Atlanta', 'Toulon Daytona'],
    TaylorMade: ['Spider Tour V', 'Spider Tour Z', 'Spider Tour X', 'Spider GTX', 'TP Reserve B11', 'TP Reserve M27', 'TP Hydro Blast'],
    Ping:       ['Anser 2', 'Anser 4', 'Tyne 4', 'Tyne H', 'Tyne C', 'Kushin C', 'Mundy', 'DS72', 'Fetch'],
    Bettinardi: ['Studio Stock 28', 'Studio Stock 38', 'Inovai 6.0', 'Inovai 8.0', 'Queen B 6', 'Queen B 11', 'BB1', 'BB8'],
    'L.A.B.':   ['DF3', 'Mezz.1 Max', 'Mezz.1', 'Link.1', 'OZ.1i'],
    Cobra:      ['King 3D Printed Agera', 'King 3D Printed Grandsport-35', 'King Vintage Nova', 'King Vintage Sport-45'],
  },
}

// Helpers --------------------------------------------------------------

export function brandsFor(category) {
  return Object.keys(CATALOG[category] ?? {}).sort()
}

export function modelsFor(category, brand) {
  return CATALOG[category]?.[brand] ?? []
}

export function categoryForSlot(slot) {
  return SLOT_CATEGORY[slot] ?? null
}
