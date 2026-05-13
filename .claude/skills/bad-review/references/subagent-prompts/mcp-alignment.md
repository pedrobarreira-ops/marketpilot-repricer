# Subagent B: MCP Alignment — Audit Instructions

The coordinator's dispatch prompt provides:
- `{CODE_FILES}` (list of implementation files to grep)

---

The authoritative endpoint reference is the Mirakl MCP server itself
(see CLAUDE.md — never assume from training data). Cross-reference
against the empirical-facts table in
  `_bmad-output/planning-artifacts/architecture-distillate/_index.md`
under the section "Cross-Cutting Empirically-Verified Mirakl Facts".

**Banner-on-stale MCP (Q6, Bundle C close-out retro 2026-05-13 — 2nd sighting of mid-flight token expiry, PR #87 audit):** if you make ANY Mirakl-specific claim in your verdict (endpoint name, field name, pagination shape, error code, etc.) WITHOUT successfully invoking an `mcp__mirakl__*` tool this turn (an authenticate-only response counts as failure), you MUST emit this banner verbatim at the TOP of your verdict report:
  `⚠ Mirakl MCP unavailable during this audit — Mirakl claims below are training-data fallback, NOT MCP-verified. Re-run after authenticating.`
Q5 Phase 1 pre-check (commit 36445b0) catches MCP unavailability at audit start; this banner catches mid-flight token expiry that the pre-check can't see. If you DID successfully invoke a non-authenticate MCP tool this turn AND your claim is grounded in its output, omit the banner.

Load the file at:
  `.claude/skills/bad-review/references/mcp-forbidden-patterns.md`

That file lists known-stale patterns that cause silent production
failures. For each pattern, grep the target files.

Report:

## Forbidden patterns
| Pattern | Found? | File:line (if found) |
|---------|--------|----------------------|
| product_ids: <with EANs>                          | ✓ or ✗ | |
| o.channel_code / offer.channel_code               | | |
| offer.price without offer.total_price alongside   | | |
| Compare activeOffers.length to total_count        | | |
| Bearer prefix on Mirakl Authorization header      | | |
| product_sku used as seller SKU in PRI01 CSV       | | |
| OF24 used for price-only update                   | | |
| Float-price math outside shared/money/index.js    | | |
| Direct fetch( for Mirakl outside shared/mirakl/   | | |
| Modified migration in supabase/migrations/        | | |

## Correct-pattern confirmation
- Files using {offer.active, product_references=EAN|, pricing_channel_code, offer.total_price, allOffers.length===total_count, shop_sku in PRI01, raw Authorization header without Bearer}: list or "none applicable"

## New endpoints / unusual patterns worth live-probing
- Any endpoint name, param, or field accessed that is NOT documented in
  architecture-distillate's empirical-facts table. List or "none".

## Verdict
Aligned / Drift found / Needs live probe

Return only the report, stay under 300 words.
