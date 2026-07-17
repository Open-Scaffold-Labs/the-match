# Scorecard Ingester — Build Spec

**Date:** 2026-07-15 · **Author:** Dale Raaen (via Claude session)
**Status:** Queued — first build after the 2026-07-17 Friday on-course test
**Origin:** Dale wanted USGA/GHIN score import; research showed golfers can't
export their own GHIN record (Excel export is admin-portal-only; the GHIN API
is licensed to tech providers). The scorecard photo is the universal input —
no admin, no license, works for the shoebox archive and Friday's paper card.

## Shape

Photograph a paper scorecard → Claude vision parses it → deterministic
validation → human review grid → existing round-save path. GHIN screenshots
and pasted score-history text are just alternate inputs to the same parser.

1. **Capture** — "Import a round" (Profile, next to GamePlan/Practice):
   camera/upload (multi-photo for front/back), or paste text. Express body
   limit is already 10mb (Eagle Eye images).
2. **Parse** — `POST /api/rounds/ingest`: Claude vision (CADDIE_MODEL), forced
   tool use → `{ courseName, date?, teeName?, holePars?, players: [{ name,
   scores[], out?, in?, total?, flags[] }] }`. **Never-guess rule:** an
   unreadable cell returns `null` + a flag, not an invention.
3. **Validate (ours, not the model's)** — per row: Σ front nine vs written
   OUT, Σ back vs IN, Σ all vs TOT. Mismatch → red flag on the cells involved.
   Same lib/tests discipline as gameplan/voice (`server/src/lib/ingest/`).
4. **Review** — editable grid rendered from the parse; golfer corrects cells,
   picks WHICH ROW IS THEM, sets/confirms date + course (course picker w/
   community-add for unknown courses), then confirms. Nothing writes before
   this.
5. **Save** — existing round-create path, `source: 'scorecard'` (needs a
   `source` column or metadata key on tm_rounds — check before building),
   historical `date` honored. Feeds the handicap engine + GamePlan course
   history immediately.

## Honest limits

- Paper cards carry no putts/lies/toPin → imported rounds strengthen handicap
  + course history, **not SG** (fact model stays live-capture-only).
- Handwriting varies wildly — the review grid is load-bearing, not optional.
- GHIN hole-by-hole exists only for rounds POSTED hole-by-hole; many are
  total-only. Total-only rounds still import (as 18-hole totals) for handicap.

## Later

- Partner rows: if a name on the card matches a Match friend, offer them
  their row (consent flow — they confirm in-app).
- Batch mode for the shoebox: N photos → N review cards in a queue.
- Test data: Dale's real paper scorecards.
