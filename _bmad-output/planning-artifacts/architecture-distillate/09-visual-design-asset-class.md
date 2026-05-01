This section is the post-completion Visual Design Reference Asset Class supplement: visual-contract sourcing for downstream story sharding; Pattern A/B/C UI surface contracts; stable-stub-filename strategy. Part 9 of 9 from `architecture.md`.

## Status & Scope
- Post-completion supplement; operational metadata for visual-contract sourcing consumed by epic-doc story sharding and BAD subagent implementation
- Binding decisions AD1-AD30 + F1-F13 unchanged; Step 8 frontmatter `status: complete` remains accurate
- Architecture's binding-decisions surface stays unchanged; this supplement adds asset-class convention without re-opening spec

## Asset Location
- `_bmad-output/design-references/` curated by Sally (UX designer); README.md convention doc
- `bundle/` Claude Design Phase B+C output (300 KB curated from 3.3 MB upstream)
  - `project/dashboard-and-audit.html` live canvas (open in browser, navigate via tweaks toolbar)
  - `project/dashboard-and-audit.css` design tokens
  - `project/*.jsx` React component implementations (reference only; production stack ships vanilla JS per Step 3)
  - `project/MarketPilot.html` original free-report visual-DNA reference
  - `chats/chat2.md` design-intent transcript (background, not normative)
- `screens/` stable stub filenames (14 designed + 3 Phase D placeholders)
  - `01-…` through `12-…` + `06b-…` (13 originally-designed dashboard/audit surfaces)
  - `16-onboarding-key-help.html` Worten-key one-pager modal added 2026-04-30 (PT walkthrough verified, screenshots delivered, final review pending before customer #1)
  - `13-…/14-…/15-…` Phase D placeholders (regenerate when Pedro Claude Design usage limit resets ~5 days from 2026-04-30)
- Total UI surface: ~28 screens; 16 Claude-Design-mocked with stable stubs; 12 deliberately not stubbed (fall into 2 fallback patterns); story acceptance criteria must explicitly declare which pattern surface uses

## Pattern A — Stubbed UI surface (17 surfaces)
- Story acceptance cites 3 pointers:
  - **Behavior**: PRD FR/NFR by number
  - **Structure**: UX skeleton § by number
  - **Visual**: `_bmad-output/design-references/screens/<NN>-<name>.html` stub filename
- Includes 16 dashboard/audit/onboarding surfaces (`01-…` through `12-…` + `06b-…` + `16-onboarding-key-help.html`)

## Pattern B — Skeleton with explicit visual fallback (2 surfaces)
- Story acceptance cites:
  - **Behavior**: PRD FR/NFR
  - **Structure+Visual**: UX skeleton § + named visual fallback
- Concrete cases:
  - `/onboarding/scan` (FR12-FR14) UX skeleton §3.3 + visual fallback `bundle/project/MarketPilot.html` ProgressScreen
  - `/onboarding/margin` (FR16) UX skeleton §3.3 + visual-DNA tokens

## Pattern C — Skeleton + Supabase chrome / DNA tokens (10 surfaces)
- Story acceptance cites:
  - **Behavior**: PRD FR/NFR
  - **Structure**: UX skeleton § (sitemap entry or §4.4 settings row)
  - **Visual**: explicit fallback statement
- Concrete cases:
  - 5 auth screens (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) UX skeleton §1 sitemap + Supabase Auth defaults + visual-DNA tokens (Manrope/Inter, navy primary, radius scale)
  - 5 settings pages (`/settings/account`, `/settings/key`, `/settings/marketplaces`, `/settings/billing`, `/settings/delete`) UX skeleton §4.4 settings row + visual-DNA tokens + consistent chrome from already-shipped designed pages

## Stable-Stub-Filename Strategy
- Stub filenames in `screens/` stable across Phase D updates
- When bundle internals update (e.g., regenerated mockups when Pedro Claude Design usage limit resets) only `bundle/` files change
- Stub filenames remain valid references in epic doc + story acceptance criteria
- Isolates Pass-2 visual reconciliation work to mechanical eta-template ports — no story re-sharding when designs land

## Escape Hatch for Missing Patterns
- If epic-sharding pass surfaces UI story whose surface doesn't cleanly fit Pattern A/B/C, agent must NOT invent fourth pattern
- Flag story to Pedro
- Sally generates stub via gen template (~2 min) OR updates UX skeleton §4.4 if surface is new settings page

## Architecture Decisions Unchanged
- AD1-AD30 + F1-F13 reference PRD FRs and UX skeleton sections directly, never visual stubs
- Visual references are operational metadata consumed at story sharding (epic doc) and story execution (BAD subagents)
- Architecture binding-decisions surface stays unchanged; this supplement adds asset-class convention without re-opening spec
