"""
Limitless Stack project manifest.

Lives at the root of any vault using the Limitless Stack tools.
The preflight script (tools/limitless-preflight.sh) and the refresh script
(tools/notebooklm-wiki-refresh.py) read configuration from here.

To re-create this manifest from scratch:
    /Users/matthewlavin/LimitlessStack/bin/limitless-stack-init <project_id> <target>

Schema:
  PROJECT_ID    — kebab-case unique identifier (REQUIRED)
  DESCRIPTION   — one-line human description
  CHECKS        — list of optional preflight checks. The mandatory checks
                  (claude_md, obsidian, notebooklm, sync_check, anti_patterns)
                  always run regardless of this list.
                  Optional checks: pinecone
  OBSIDIAN      — config dict
  PINECONE      — config dict (only if 'pinecone' in CHECKS)
  NOTEBOOKLM    — config dict (REQUIRED — every project must have a notebook)
  SYNC_CHECK    — config dict
"""

PROJECT_ID = "the-match"
DESCRIPTION = "Golf companion app — mobile-only PWA, React 19 + Vite + Tailwind v4 client, Express + Supabase server, Vercel deployment"

# Optional checks. Mandatory checks (claude_md, obsidian, notebooklm,
# sync_check, anti_patterns) always run regardless.
CHECKS = []

OBSIDIAN = {
    "wiki_dir": "wiki",
    "expected_min_pages": 5,
}

NOTEBOOKLM = {
    # Per-project routes: each tuple is (path_prefix, notebook_id, state_label, display_label).
    # Add an entry per wiki/apps/<name>.md that should mirror to a dedicated notebook.
    # Leave empty if all wiki content goes to the default bucket.
    "routes": [],

    # Default bucket — every wiki/*.md not matched by 'routes' lands here.
    # ID created via `notebooklm create the-match` on 2026-04-29 PM.
    "default": ("41e645a3-044d-452b-8e68-a21939e18799", "wiki", "wiki"),

    # Curated reminder bucket — read at session start. Files listed here are
    # mirrored into a small reminder notebook so the next session's first
    # NotebookLM query picks up project rules + recent mistakes.
    # ID created via `notebooklm create 'the-match Reminder'` on 2026-04-29 PM.
    "reminder": {
        "notebook_id": "43a69b99-a0cb-4e9b-8bd2-5e9c09f95c6f",
        "files": [
            "CLAUDE.md",
            "wiki/synthesis/claude-anti-patterns.md",
        ],
        "title_aliases": {
            "CLAUDE.md": "the-match-CLAUDE.md",  # disambiguate from other projects' CLAUDE.md
        },
    },

    # Notebooks that exist in NotebookLM but are intentionally NOT routed by THIS project.
    # NotebookLM is account-wide — every project sees every notebook. Anything that
    # belongs to ANOTHER project (or is a curated/reference bucket) goes here so
    # the orphan check stays quiet. Format: {notebook_id: "human description"}.
    "ignored": {
        # Owned by Hub vault (OpenScaffold wiki):
        "cdaa7a43-774e-4113-8288-207669dd981f": "OpenScaffold Wiki — owned by Hub vault",
        "ab4b7ccb-5d54-494d-a490-8072283107d2": "Limitless Stack Hub reminder — owned by Hub vault",
        "f376f6e8-0c5c-4a29-95ce-44e85fbf7b62": "FireHazmat — owned by Hub vault",
        "26a8db12-1543-4567-944d-c64a0d338acc": "OpenChiropractor — owned by Hub vault",
        "9c8f3df0-5ebe-4523-85c2-dfdcf4e7dd02": "OpenFirehouse Project Docs — owned by Hub vault",
        "0a072ead-e919-414a-80f7-27d5f1487afc": "OpenSalon — owned by Hub vault",
        "ca083f4f-afd8-438a-9da6-339dec7c87f8": "Limitless Stack Hub - Repo — owned by Hub vault",
        "e9337dea-f7cd-4fba-aabc-621d15ecc336": "TheMatch (Hub vault's mirror of wiki/apps/the-match.md) — owned by Hub vault, NOT this project's main notebook",
        # Curated reference notebooks (not wiki-mirrored anywhere):
        "733f98ef-ed33-42ca-a549-f6fc1731d5b5": "OpenScaffold Architecture (curated DOCX reference)",
        "1a0a0c47-e862-4fac-be42-70b75e0f883c": "OpenScaffold Business (curated DOCX reference)",
        "9830f04f-e29a-4c31-a758-d62867a9199f": "ERG Research (curated PDF reference)",
        "f386d513-5a6c-44e0-9a27-3d74340ebda6": "(untitled) empty test notebook",
        "75e0f097-9343-4a89-939b-1e1d9fd205cc": "(untitled) empty test notebook",
    },

    # Path prefixes that should NOT be mirrored to ANY notebook (e.g., raw
    # source summary pages that have a per-project notebook upstream).
    "exclude_paths": [
        # Handoffs are mirrored via the single wiki/synthesis/handoffs-rollup.md
        # source instead of one slot each (2026-07-06 — 50-source cap hit).
        "wiki/synthesis/next-session-handoff-",
        "wiki/synthesis/eagle-eye-tile-grid-handoff-",
        # F.5 sub-specs (all COMPLETE) are mirrored via the single
        # wiki/synthesis/f5-specs-rollup.md source (2026-07-10 — 50-source cap).
        # (NB: prefixes must not catch f5-specs-rollup.md itself — a broad
        # "f5-s" prefix excluded the rollup on first attempt, 2026-07-10.)
        # 2026-07-20 prune (50-cap, Matt-approved): 19 shipped/closed pages
        # mirrored via shipped-specs-rollup.md + closed-audits-rollup.md.
        # Full filenames (no prefixes) so the rollups themselves never match.
        "wiki/synthesis/course-handicap-match-strokes-2026-06-25",
        "wiki/synthesis/gender-handicap-wiring-2026-06-25",
        "wiki/synthesis/handicap-accuracy-audit-2026-06-25",
        "wiki/synthesis/per-player-gender-ratings-2026-06-25",
        "wiki/synthesis/player-data-foundation-2026-06-25",
        "wiki/synthesis/own-club-arcs-3.3-build-spec-2026-06-25",
        "wiki/synthesis/playslike-3.1-build-spec-2026-06-25",
        "wiki/synthesis/playslike-accuracy-rebuild-2026-06-30",
        "wiki/synthesis/range-rings-dispersion-build-spec-2026-07-02",
        "wiki/synthesis/live-putt-capture-outings-build-spec-2026-07-06",
        "wiki/synthesis/eagle-eye-tokenization-plan-2026-07-02",
        "wiki/synthesis/ee-stage-c-holemapgl-tokenization-build-spec-2026-07-07",
        "wiki/synthesis/eagle-eye-next-level-plan-2026-06-06",
        "wiki/synthesis/eagle-eye-premium-plan-2026-06-23",
        "wiki/synthesis/sg-map-tap-capture-build-spec-2026-07-02",
        "wiki/synthesis/audit-2026-04-29",
        "wiki/synthesis/audit-fixes-proposal-2026-04-29",
        "wiki/synthesis/audit-2026-05-07",
        "wiki/synthesis/match-page-completion-plan",
        "wiki/synthesis/f5-never-lose-your-round-build-spec-",
        "wiki/synthesis/f5-s2-",
        "wiki/synthesis/f5-s4-",
        "wiki/synthesis/f5-s5-",
        "wiki/synthesis/f5-s6-",
        # Pure-history pages excluded at the cap wall (2026-07-17 — notebook
        # hit 50/50 hard; refresh reported upload_failed:29). These are
        # superseded session records fully covered by wiki/log.md, which IS
        # a source. A REAL consolidation pass (rollup for shipped pre-07
        # specs) is owed — next-session item in the handoff.
        "wiki/synthesis/session-report-2026-06-06",
        "wiki/sources/claude-code-karpathy-obsidian-video-",
    ],
}

SYNC_CHECK = {
    "limitless_stack_home": "/Users/matthewlavin/LimitlessStack",
}
