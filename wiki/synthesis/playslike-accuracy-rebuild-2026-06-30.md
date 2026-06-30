---
type: synthesis
created: 2026-06-30
updated: 2026-06-30
tags: [the-match, eagle-eye, plays-like, accuracy, build-spec]
---

# Plays-Like Accuracy Rebuild — sourced coefficients (2026-06-30)

*Trigger: Matt found hole 6 (335 yd) showing "plays like 299 (−36)" — physically absurd. Root cause: the plays-like model was an unvalidated in-house heuristic (`geo.js`, 2026-06-06). This rebuild replaces the coefficients with sourced, physically-defensible values. Research: `plays-like-distance-research.md` + a physics pass (both this session, fully cited).*

## Headline findings
- **No major golf app/rangefinder publishes its plays-like math** (Arccos, 18Birdies, Garmin, Bushnell all proprietary; Garmin calls it "not predictable"). Our transparent per-factor breakdown is therefore a genuine differentiator — we just need the coefficients right.
- The accepted, sourced coefficients (Trackman, Titleist R&D, golf.com/Tutelman, Shot Pattern's June-2026 Trackman-derived model) are clear and below.

## What the old heuristic got wrong → corrected (all sourced)
| Factor | Old | New (sourced) | Source |
|---|---|---|---|
| Wind | symmetric ±1%/mph | **headwind +1.0%/mph, tailwind −0.5%/mph** (~2:1 asymmetry) | Trackman via GolfWRX; Shot Pattern (Trackman-derived) |
| Altitude | 2%/1000 ft | **1.16%/1000 ft** (×0.0116) | Titleist R&D (Aoyama, ×0.00116/ft); Trackman ~1%/1000 ft |
| Temp | 1%/10°F | **0.8%/10°F**, 70°F baseline | Andrew Rice/Trackman (~2 yd/10°F driver) |
| Elevation | 1 yd/3 ft both ways | **uphill 0.33 yd/ft, downhill ×0.67** (asymmetric) | probablegolfinstruction; caddiehq |
| Wind direction | along-shot cosine | unchanged (cosine component); crosswind = aim cue, not distance | aviation component math / golf-alcanada |

## Design decisions (audited)
1. **Additive model, not multiplicative.** The transparency UI (`playsLikeView`) requires the four factors `{wind, temp, alt, elevation}` to **sum** to the total. The research's "rigorous" multiplicative-density model would force an artificial decomposition anyway, and is only meaningfully different from additive at large *stacked* extremes (the temp×alt cross-term is <1 yd at realistic golf conditions). Additive-with-correct-coefficients is the right architecture here, not a shortcut.
2. **Caught a bug in the research agent's sample JS:** its `densityFactor = 1 + (ρ₀/ρ − 1)×0.4` is **inverted** — it makes hot/high (thin) air play *longer*, but thin air → ball flies farther → plays *shorter*. We did NOT implement that. The additive model below has every sign verified by hand.
3. **Sane caps per channel** (App-Store robustness — a bad sensor reading can't produce an absurd number): wind pct ∈ [−30%, +40%], temp ∈ ±10%, alt ∈ ±15%, elevation ∈ ±40 yd.
4. **Plays-like stays on the full tee distance** (Matt: a 335 drive is real). The −36 was the coefficients, not the reference distance.
5. **Temp baseline 70°F** kept (Titleist; Rice uses 75 — both defensible).
6. Mirror copies that must stay identical: **`client/src/lib/geo.js` + `client/src/pages/EagleEye.jsx`** (two copies). The server `routes/eagle-eye.js` is a *separate* LLM camera-analyze feature, out of scope.

## The model (additive; signs verified)
```
per-factor (all scale with baseYds except elevation, which is geometric yards):
  wind:      along = windSpeed·cos(shotBearing−windFromDeg)   // + head, − tail
             pct   = along≥0 ? 0.010·along : 0.005·along       // 1%/mph head, 0.5%/mph tail
             pct   = clamp(pct, −0.30, +0.40)
             wind  = pct · baseYds
  temp:      ((70−tempF)/10) · 0.008 · baseYds,  clamp ±10%·base   // colder → longer
  alt:       −(altFt/1000) · 0.0116 · baseYds,   clamp ±15%·base   // thinner → shorter
  elevation: elevDeltaFt≥0 ? ·(1/3) : ·(1/3)·0.67,  clamp ±40 yd   // uphill longer; downhill ⅔
  adj = wind + temp + alt + elevation
```

## Worked sanity checks (become unit-test assertions)
- 150 yd, 20 mph pure headwind, 70°F: wind +30 → **180** (unchanged; headwind side was already right).
- 150 yd, 20 mph pure tailwind: wind −15 → **135** (was −30; the fix).
- 150 yd, 20 mph crosswind: ~0.
- 150 yd, 50°F: +2 (was +3).
- 150 yd, 5000 ft: −9 (was −15).
- Asymmetry: 20 mph head (+30) ≈ 2× |20 mph tail (−15)|.
- Elevation: +30 ft → +10; −30 ft → −7 (downhill smaller).
- **Hole-6 realism:** 335 yd, 9 mph tailwind, 90°F → wind −15, temp −5 → adj ≈ **−20** (was −36).

## Honest residual
These are sourced rules-of-thumb, not a per-shot trajectory ODE solve. They're calibrated to typical conditions; extreme stacked conditions (high altitude + cold + strong wind) are first-order approximations. Marketing stance unchanged: never advertise a precision figure; the in-app number is a helpful estimate, not a laser. Future upgrade (deferred, not a shortcut-dodge): a true launch-condition trajectory model.
