# Subagent B: MCP Alignment — Audit Instructions

The coordinator's dispatch prompt provides:
- `{CODE_FILES}` (list of implementation files to grep)

---

The authoritative endpoint reference is the Mirakl MCP server itself
(see CLAUDE.md — never assume from training data). Cross-reference
against the empirical-facts table in
  `_bmad-output/planning-artifacts/architecture-distillate/_index.md`
under the section "Cross-Cutting Empirically-Verified Mirakl Facts".

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
