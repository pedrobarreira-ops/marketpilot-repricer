# marketpilot-repricer — Project Context for Claude Code

## Project Summary

Solo developer project (Pedro) building the **MarketPilot repricing tool** — the paid SaaS product that automates Mirakl marketplace pricing. Monitors competitor prices via the Mirakl P11 API and reprices listings (via PRI01) to stay in 1st place within configurable margin floor/ceiling bands.

This repo is the **paid product**. The free MarketPilot opportunity report generator lives in a separate repo (`DynamicPriceIdea`) and serves as the lead-magnet / sales asset that funnels prospects into this tool.

**Stack:** Node.js (>=22), Fastify, Mirakl Marketplace Platform API, Postgres
**Stage:** Pre-build — planning complete (PRD / architecture / epics / sprint planning all locked); entering implementation phase, Story 1.1 next
**Repo:** marketpilot-repricer

## Strategic Context

These three documents were carried over from the report-generator repo and contain the strategic foundation for this product. They are inputs for the upcoming product brief / PRD work:

- `RESEARCH.md` — tool feasibility, repricing logic (undercut + ceiling), tier system, P11 confirmation, pricing math, schema sketch
- `OUTREACH.md` — sales pipeline, lead tracker, cold-call scripts, email templates
- `PRICING.md` — pricing model (currently being revised: €50/month per marketplace, no setup fee)

## CRITICAL: Always Use Distillated Planning Documents

Always load the distillate versions — NOT the originals. Distillates are LLM-optimized and contain all required information losslessly.

| Instead of | Use this |
|-----------|---------|
| `_bmad-output/planning-artifacts/prd.md` | `_bmad-output/planning-artifacts/prd-distillate.md` (single file) |
| `_bmad-output/planning-artifacts/architecture.md` | `_bmad-output/planning-artifacts/architecture-distillate/_index.md` (split — see loading pattern below) |
| `_bmad-output/planning-artifacts/epics.md` | `_bmad-output/planning-artifacts/epics-distillate/_index.md` (split — see loading pattern below) |

**Loading pattern for the epics distillate** (folder, 8 files):
- Load `_index.md` first — orientation + section manifest + cross-cutting layer (atomicity bundles A/B/C, calendar-early 9.0+9.1, 17 P11 fixtures table, SSoT module index, FR/AD/F1-F13/UX-DR coverage maps, 27 architectural constraints, Parallel Tracks, 18 Notes-for-Pedro). For Bob's sprint planning and most cross-story questions, this alone is enough.
- Load specific section files only when sharding a story whose epic falls in that section:
  - `01-epics-1-3-foundation-tenancy-mirakl.md` — Epic 1 (5) + Epic 2 (2) + Epic 3 (3) = 10 stories
  - `02-epic-4-onboarding.md` — Epic 4 (9 stories)
  - `03-epics-5-6-cron-pri01.md` — Epic 5 (2) + Epic 6 (3) = 5 stories
  - `04-epic-7-engine-safety.md` — Epic 7 (8 stories), includes the Story 7.8 atomicity-bundle gate
  - `05-epic-8-dashboard.md` — Epic 8 (12 stories)
  - `06-epics-9-10-audit-deletion.md` — Epic 9 (7) + Epic 10 (3) = 10 stories
  - `07-epics-11-12-billing-ops.md` — Epic 11 (5) + Epic 12 (3) = 8 stories
- Never load all 7 sections at once unless explicitly needed.

**Loading pattern for the architecture distillate** (it's a folder, not a single file):
- Load `_index.md` first — it concentrates all cross-cutting items (27 architectural constraints / 11 SSoT modules / 3 atomicity bundles / 16 empirically-verified Mirakl facts / Q1-Q15 MCP verification status). For most tasks, this alone is enough.
- Load specific section files only when the task requires that scope:
  - `01-context-and-scaffold.md` — Story 1.1 / scaffolding
  - `02-decisions-A-D.md` — AD1-AD20 (topology + Mirakl + cron + audit)
  - `03-decisions-E-J.md` — AD21-AD30 (billing + ops + important)
  - `04-implementation-patterns.md` — naming + SSoT modules + atomicity bundles + 17 P11 fixtures
  - `05-directory-tree.md` — file-location lookup
  - `06-database-schema.md` — full DDL
  - `07-fr-mapping-integrations-workflows.md` — FR/AD → file mapping
  - `08-amendments-and-validation.md` — F1-F13 amendments + readiness
  - `09-visual-design-asset-class.md` — Pattern A/B/C UI surface contracts
- Never load all 9 sections at once unless explicitly needed — defeats the selective-loading purpose.

## CRITICAL: Mirakl API — Always Verify via MCP

Before assuming any Mirakl API behavior (endpoint names, field names, pagination, error codes, rate limits), **always check the Mirakl MCP first**. Never guess or rely on training data for Mirakl specifics.

- **Mirakl MCP is the single source of truth** for all Mirakl API details — endpoints, field names, pagination, error codes
- **Never assume** — always verify against MCP before implementing or recommending any API call
- Applies to **all agents**: BAD subagents (dev-story, code-review, test design) and all custom skills

## Key Project Facts

- **Platform:** Mirakl MMP (Marketplace Platform) only — no MiraklConnect
- **Price writes:** Use PRI01 endpoint, not OF24 (OF24 resets unspecified offer fields to defaults — never use it for price-only updates)
- **Trust constraint:** API keys MUST be stored encrypted at rest. The Mirakl `shop_api_key` has no read-only mode and grants full account access (bank/IBAN, sales, prices, orders). This is a trust-critical component.
- **Developer:** Pedro — non-developer entrepreneur, relies on AI for implementation
- **Methodology:** BMAD Method (full workflow: product-brief → PRD → architecture → epics → stories → dev → review)
- **Token management:** Use `/compact` when context approaches limits. Start new sessions per major workflow step.

## Sprint Status

Sprint plan locked. `_bmad-output/implementation-artifacts/sprint-status.yaml` holds 62 stories across 12 epics, all at `status: backlog`. Story 1.1 is the next to be sharded via `bmad-create-story`.
