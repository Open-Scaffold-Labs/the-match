---
type: overview
created: 2026-04-29
updated: 2026-05-07
---

# Overview

Top-level synthesis of the the-match wiki. This page is a map of the territory — pointers to where things live and a short snapshot of where the project stands.

## What the-match is

A golf companion app being built to ship as a **native iOS app on the Apple App Store** (must be ready for App Store review/approval). The web app — React 19 + Vite + Tailwind v4 on the client; Express + Supabase on the server; Vercel for deployment — is packaged into a native iOS shell and runs inside **WKWebView** on the device. Vercel is the dev/beta surface; the App Store build is the product. Auth is email + 4-digit PIN with a 90-day JWT. All DB tables prefix `tm_`. (See the App Store callout at the top of `CLAUDE.md` — every decision is an App-Store-readiness decision; never write browser-framed fallbacks.)

The project is post-launch — friends are using it on real rounds. Most session work since 2026-04-29 has been live-fire bug-bash, polish, and feature additions driven by what users hit on the course.

## Where to look for what

- **Current state of the codebase** → read the most recent few entries in [[log]]. The log is the live source of truth; static feature tables in CLAUDE.md drift and were intentionally removed.
- **What's urgent right now** → [[HIGH-PRIORITY-TODO]]. The preflight scans this for overdue deadlines.
- **What's deferred but not forgotten** → [[POST-LAUNCH-TODO]]. Each item has a one-line context plus a concrete next step.
- **Big multi-session work** → `wiki/synthesis/`. Closed audits, refactor plans, design handoffs.
- **Patterns and protocols** → `wiki/concepts/`. The LLM-wiki pattern, the NotebookLM workflow, etc.
- **Source material that informed the wiki** → `wiki/sources/`. Talks, posts, transcripts.
- **Lessons from past mistakes** → [[synthesis/claude-anti-patterns]]. Read this before starting anything substantive.

## How the wiki is maintained

This vault uses the Limitless Stack pattern (canonical at `/Users/matthewlavin/LimitlessStack`):

1. CLAUDE.md is the trust anchor — read at session start, end-of-session updated to match reality.
2. The preflight (`tools/limitless-preflight.sh`) mechanically verifies the seven-tool stack at session start. Includes semantic checks for index completeness, template placeholders, and overdue TODOs.
3. The wiki is the structured knowledge base. Every page belongs in [[index|the index]].
4. NotebookLM is the deep-research layer. Two buckets: main (`41e645a3...`) gets all wiki content, reminder (`43a69b99...`) gets CLAUDE.md + anti-patterns for fast session-start retrieval.

When a session does substantive work, it writes a [[log]] entry, files synthesis as needed, refreshes the trust anchors, and pushes.
