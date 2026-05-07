# Story 4.7: Scan-Ready Interstitial `/onboarding/scan-ready` (UX-DR33-34)

**Sprint-status key:** `4-7-scan-ready-interstitial-onboarding-scan-ready-ux-dr33-34`
**Status:** ready-for-dev
**Size:** S
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Depends on:** Story 4.4 (async catalog scan orchestration — populates skus + sku_channels + scan_jobs; transitions to DRY_RUN), Story 4.5 (scan progress page — redirects to /onboarding/scan-ready on COMPLETE)
**Enables:** Story 4.8 (margin question — "Continuar →" CTA points there)

---

## Narrative

**As a** customer who has just finished the catalog scan and arrived at `/onboarding/scan-ready`,
**I want** to see an honest, data-driven summary of my catalog quality — how many SKUs are ready for repricing, how many have no competitors, and how many were skipped because they have no EAN — with a simple "porquê?" disclosure explaining why some were excluded —
**So that** I understand the shape of my repricing universe before I configure margins, and I trust that MarketPilot is being transparent about what it can and cannot reprice.

---

## Trace

- **Architecture decisions:** AD16 (UX milestone after PROVISIONING → DRY_RUN transition; final onboarding step before margin question)
- **UX-DRs:** UX-DR33 (scan-ready interstitial layout with 4 count lines), UX-DR34 ("porquê?" inline disclosure on refurbished/EAN-less SKUs)
- **FRs:** FR16 (gateway — customer must pass through this page before the margin question)
- **Pattern A/B/C:** Pattern A — visual reference at `_bmad-output/design-references/screens/10-onboarding-scan-ready.html`
- **UX skeleton:** §8.3 (full layout spec for /onboarding/scan-ready including UX33 + UX34 verbatim copy)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.7

---

## Acceptance Criteria

### AC#1 — GET /onboarding/scan-ready renders the catalog quality summary with live counts

**Given** the route `app/src/routes/onboarding/scan-ready.js` and template `app/src/views/pages/onboarding-scan-ready.eta`
**When** a customer with `cron_state = 'DRY_RUN'` and `scan_jobs.status = 'COMPLETE'` hits `GET /onboarding/scan-ready`
**Then**:
- The page renders the post-scan summary card with these four count lines (all from live DB queries — NOT placeholders):
  - **"X produtos encontrados no Worten"** — `X` = total OF21 offers (all, including EAN-less) = `COUNT(skus) + noEanCount`. This is the grand total of the seller's Worten catalog as seen by OF21.
  - **"Y prontos para repricing"** — `Y` = `sku_channels` rows where `tier IN ('1', '2a', '2b')` for this customer_marketplace
  - **"Z sem competidores (Tier 3 — vamos monitorizar)"** — `Z` = `sku_channels` rows where `tier = '3'`
  - **"W sem EAN no Worten — ignorados"** — `W` = count of OF21 offers that were skipped during scan because no EAN was found (see CRITICAL note in Dev Notes on `skus_total` semantics)
  - Invariant: `Y + Z + W = X` (all four counts must add up — verify this in tests)
- All four counts are sourced from queries against `skus`, `sku_channels`, and `scan_jobs` for the authenticated customer's `customer_marketplace_id`
- A "porquê?" disclosure trigger (link or button) is visible below the "W sem EAN" line
- A "Continuar →" button is visible and leads to `/onboarding/margin` (Story 4.8)
- Page is PT-localized

### AC#2 — "porquê?" inline disclosure expands with verbatim UX-DR34 copy

**Given** the customer clicks the "porquê?" trigger
**When** the inline disclosure expands (client-side toggle — no page reload)
**Then**:
- The disclosure renders the **verbatim** copy from UX skeleton §8.3 / UX-DR34:
  > *Produtos refurbished e listings privados não têm EAN partilhado no Worten — não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático. Isto é estrutural ao Worten, não uma limitação da MarketPilot.*
- Clicking "porquê?" again collapses the disclosure
- The disclosure is keyboard-accessible: `<button>` or `<summary>`/`<details>` pattern with correct ARIA if custom (NFR-A2)
- The copy is NOT hidden behind a modal — it expands inline below the "sem EAN" line per UX-DR34

### AC#3 — "Continuar →" redirects to /onboarding/margin

**Given** the customer sees the scan-ready summary
**When** they click "Continuar →"
**Then**:
- The customer is redirected to `GET /onboarding/margin` (Story 4.8)
- The redirect is a simple anchor `<a href="/onboarding/margin">` or a `302` POST/GET — no AJAX
- The button is keyboard-accessible and focusable (NFR-A2)

### AC#4 — UX-DR2 forward-only routing guards

**Given** UX-DR2 (strictly forward state machine)
**When** any of these routing scenarios occur:
- Customer with `cron_state = 'PROVISIONING'` tries to access `/onboarding/scan-ready` → redirect to `/onboarding/scan`
- Customer with `cron_state = 'PROVISIONING'` and a PENDING/RUNNING scan_jobs row tries to access `/onboarding/scan-ready` → redirect to `/onboarding/scan`
- Customer with `cron_state = 'DRY_RUN'` and `scan_jobs.status = 'FAILED'` tries to access `/onboarding/scan-ready` → redirect to `/scan-failed`
- Customer with `cron_state = 'DRY_RUN'` AND margin already set (`max_discount_pct != 0.0300 sentinel` OR a boolean flag) tries to revisit `/onboarding/scan-ready` → redirect to `/` (they have already passed the margin step)
- Customer with `cron_state = 'ACTIVE'` or any PAUSED state tries to access `/onboarding/scan-ready` → redirect to `/`
- Unauthenticated customer tries to access `/onboarding/scan-ready` → redirect to `/login?next=/onboarding/scan-ready` (auth middleware handles)

**Then** the redirect fires before any page render.

### AC#5 — Unit tests for count query correctness

**Given** `tests/unit/routes/onboarding/scan-ready.test.js`
**When** I run the test suite
**Then** the tests cover:
- Count query returns correct `totalOffers` (= skus count + noEanCount) for a customer with 3 skus rows and 1 EAN-less offer
- Count query returns correct `ready_for_repricing` (tier IN ('1','2a','2b')) for a mix of tiers
- Count query returns correct `no_competitors` (tier = '3') for a mix of tiers
- `no_ean` count = `skus_total` (from scan_jobs) minus `COUNT(skus)` — correctly computes the EAN-less skipped count
- UX-DR2 guard: PROVISIONING state redirects to /onboarding/scan
- UX-DR2 guard: ACTIVE state redirects to /

### AC#6 — Pedro sign-off (Pattern A sign-off convention)

**Given** Pattern A visual reference is `_bmad-output/design-references/screens/10-onboarding-scan-ready.html`
**When** Story 4.7 is implemented and the PR is ready
**Then** before being considered shippable to the first paying customer, Pedro signs off on the rendered output of `/onboarding/scan-ready` against the stub (with example counts in place — not zeroes)
**And** the sign-off is recorded as: a PR comment with screenshots OR in `_bmad-output/sign-offs/story-4.7.md` (same convention established in Story 4.3)
**And** any visual deviations from the stub are either fixed or documented as accepted deviations with rationale.

---

## Dev Notes

### Count Queries

All four counts come from the authenticated customer's `customer_marketplace_id`. Use the RLS-aware client (`shared/db/rls-aware-client.js`) — RLS ensures the customer only reads their own rows.

```js
// In the route handler (app/src/routes/onboarding/scan-ready.js):

// 1. Fetch the completed scan_jobs row for skus_total
const { rows: [scanJob] } = await db.query(
  `SELECT skus_total FROM scan_jobs
   WHERE customer_marketplace_id = $1 AND status = 'COMPLETE'
   ORDER BY completed_at DESC LIMIT 1`,
  [customerMarketplaceId]
);
const skusTotal = scanJob?.skus_total ?? 0;

// 2. Count skus rows (EAN-bearing SKUs successfully loaded)
const { rows: [{ total_skus }] } = await db.query(
  `SELECT COUNT(*)::int AS total_skus FROM skus
   WHERE customer_marketplace_id = $1`,
  [customerMarketplaceId]
);

// 3. Count sku_channels ready for repricing (tier IN ('1', '2a', '2b'))
const { rows: [{ ready_count }] } = await db.query(
  `SELECT COUNT(*)::int AS ready_count FROM sku_channels
   WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')`,
  [customerMarketplaceId]
);

// 4. Count sku_channels with no competitors (tier = '3')
const { rows: [{ no_competitor_count }] } = await db.query(
  `SELECT COUNT(*)::int AS no_competitor_count FROM sku_channels
   WHERE customer_marketplace_id = $1 AND tier = '3'`,
  [customerMarketplaceId]
);

// 5. EAN-less (skipped) = skus_total (all OF21 offers) minus those that got a skus row
const noEanCount = Math.max(0, skusTotal - total_skus);
```

Pass `{ totalSkus: total_skus, readyCount: ready_count, noCompetitorCount: no_competitor_count, noEanCount }` to the eta template.

### CRITICAL: skus_total Semantics — Verify Against Story 4.4 Implementation

Story 4.4's spec says `scan_jobs.skus_total` tracks "total distinct EAN count" — meaning EAN-bearing SKUs loaded, NOT the full OF21 paginated count including EAN-less offers. However, the epics spec for Story 4.7 AC#1 defines `W sem EAN = OF21 SKUs without EAN — counted but no sku_channels row`, which requires knowing the total OF21 offer count (including EAN-less ones).

**Dev agent action required:** Before implementing the count query, check what Story 4.4's implementation actually stored in `scan_jobs.skus_total`. Open `worker/src/jobs/onboarding-scan.js` (Story 4.4):

- **If `skus_total` = total OF21 paginated offer count** (including EAN-less), then `noEanCount = skusTotal - COUNT(skus)` is correct — use the query pattern above.
- **If `skus_total` = only EAN-bearing count** (i.e., `COUNT(skus)` ≡ `skus_total`), then `noEanCount = 0` always, which is wrong. In this case, add a **new migration** to add a `no_ean_count integer` column to `scan_jobs` and update Story 4.4's onboarding-scan.js to track the EAN-less count separately. Migration file: `supabase/migrations/202605070000_add_no_ean_count_to_scan_jobs.sql`.

The architecture spec's epics-distillate says `skus_total` should surface EAN-less counts to Story 4.7 — if it doesn't, this is a Story 4.4 implementation gap. Fix it here before rendering the summary page.

### "porquê?" Disclosure — Prefer `<details>`/`<summary>`

The simplest keyboard-accessible inline disclosure pattern (NFR-A2, no JavaScript required):

```eta
<details class="porque-disclosure">
  <summary class="porque-trigger">porquê?</summary>
  <p class="porque-body">
    Produtos refurbished e listings privados não têm EAN partilhado no Worten —
    não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático.
    Isto é estrutural ao Worten, não uma limitação da MarketPilot.
  </p>
</details>
```

This needs zero JS — `<details>` handles open/close natively and is keyboard-accessible. If vanilla JS is preferred for animation, use a `<button aria-expanded>` pattern, but `<details>` is the simpler path.

### Page Script

Per F9 pattern (no bundler), add near `</body>`:

```eta
<script src="/js/onboarding-scan-ready.js" defer></script>
```

The script file can be minimal or even empty if `<details>` is used for the disclosure. Create `public/js/onboarding-scan-ready.js` as an empty/minimal file regardless — consistent with the per-page script pattern.

### RLS-Aware Client in App Routes

Use `req.dbClient` (the RLS-aware client from `shared/db/rls-aware-client.js` bound by `rls-context.js` middleware) for all four count queries. Never service-role client in app routes.

### Forward-Only Guard — DRY_RUN With Margin Already Set

AC#4 includes a forward-only guard for when the customer returns to `/onboarding/scan-ready` after already setting their margin (Story 4.8 POST). The sentinel value for `max_discount_pct` is `0.0300` (set by Story 4.3). After Story 4.8 runs, the customer's actual choice overwrites it. However, the possible choices include `0.03` (the "15%+" band maps to `0.03`). This means `max_discount_pct = 0.0300` is ambiguous as a "not yet set" signal.

**Resolution:** Check `scan_jobs.status = 'COMPLETE'` AND `customer_marketplaces.max_increase_pct IS NOT NULL` as the signal that onboarding is complete — but `max_increase_pct` also has a sentinel. The cleanest approach: if `cron_state = 'DRY_RUN'` and the margin question route `/onboarding/margin` sets a session flag or the redirect to `/` has already happened, consider redirecting to `/` whenever cron_state is already DRY_RUN and the customer has made a margin choice.

**Pragmatic approach for MVP:** For `cron_state = 'DRY_RUN'` customers revisiting `/onboarding/scan-ready`, allow the page to render (idempotent — counts are still valid, disclosure still useful). Only hard-redirect back if `cron_state` has moved past `DRY_RUN` (ACTIVE, PAUSED_*). The strictly-forward guard for "margin already set and redirected to `/`" can be added in Story 4.8 or Story 4.9 when the margin route POST adds the final redirect. Leave a code comment: `// Phase 2: add session flag or margin_set_at column to make this guard stricter`.

### Eta Template Variables

```eta
<%# app/src/views/pages/onboarding-scan-ready.eta %>
<%# Variables: it.totalOffers, it.readyCount, it.noCompetitorCount, it.noEanCount %>
```

Keep arithmetic in the route handler — do NOT compute counts in the template. Pass pre-computed integers.

### No Audit Event

This page is a read-only summary. No state transition occurs here. Do NOT call `writeAuditEvent`. `KEY_VALIDATED` is not in scope; no AD20 event type exists for "scan ready viewed".

---

## File-Touch List

### New files (create)

| File | Purpose |
|---|---|
| `app/src/routes/onboarding/scan-ready.js` | GET /onboarding/scan-ready — count queries + UX-DR2 guards + render |
| `app/src/views/pages/onboarding-scan-ready.eta` | Catalog quality summary template (UX-DR33, UX-DR34 verbatim copy) |
| `public/js/onboarding-scan-ready.js` | Minimal page script (may be empty if `<details>` used for disclosure) |
| `tests/unit/routes/onboarding/scan-ready.test.js` | Unit tests for count logic + routing guards (AC#5) |

### Modified files

| File | Change |
|---|---|
| `app/src/server.js` | Register `app/src/routes/onboarding/scan-ready.js` route plugin |

### Pre-existing (DO NOT recreate or restructure)

| File | Status | Note |
|---|---|---|
| `shared/db/rls-aware-client.js` | ALREADY EXISTS — Story 2.1 | App routes DB client |
| `shared/db/tx.js` | ALREADY EXISTS — Story 2.1 | Not needed for read-only route |
| `app/src/middleware/auth.js` | ALREADY EXISTS — Story 1.5 | Handles unauthenticated redirect |
| `app/src/middleware/rls-context.js` | ALREADY EXISTS — Story 2.1 | Binds JWT to RLS-aware client |
| `shared/audit/writer.js` | ALREADY EXISTS — Story 9.0 | DO NOT call for this story |
| `supabase/migrations/` | ALL MIGRATIONS EXIST | No new migrations needed — this story only reads from skus, sku_channels, scan_jobs (all created in Stories 4.2 and 4.4) |

---

## Route Handler Shape

```js
// app/src/routes/onboarding/scan-ready.js
export default async function scanReadyRoutes (fastify, _opts) {
  fastify.get('/onboarding/scan-ready', { onRequest: [fastify.authenticate] }, async (req, reply) => {
    const db = req.dbClient; // RLS-aware client from middleware

    // 1. Fetch customer_marketplace row for cron_state
    const { rows: [cm] } = await db.query(
      `SELECT id, cron_state FROM customer_marketplaces WHERE customer_id = $1 LIMIT 1`,
      [req.user.id]
    );

    // 2. UX-DR2 routing guards
    if (!cm || cm.cron_state === 'PROVISIONING') {
      return reply.redirect('/onboarding/scan');
    }
    if (['ACTIVE', 'PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE',
         'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED',
         'PAUSED_BY_ACCOUNT_GRACE_PERIOD'].includes(cm.cron_state)) {
      return reply.redirect('/');
    }

    // 3. Check for FAILED scan (DRY_RUN but scan failed — edge case)
    const { rows: [latestScan] } = await db.query(
      `SELECT status, skus_total FROM scan_jobs
       WHERE customer_marketplace_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [cm.id]
    );
    if (latestScan?.status === 'FAILED') {
      return reply.redirect('/scan-failed');
    }

    const skusTotal = latestScan?.skus_total ?? 0;

    // 4. Count queries
    const [{ rows: [{ total_skus }] }, { rows: [{ ready_count }] }, { rows: [{ no_competitor_count }] }] =
      await Promise.all([
        db.query(`SELECT COUNT(*)::int AS total_skus FROM skus WHERE customer_marketplace_id = $1`, [cm.id]),
        db.query(`SELECT COUNT(*)::int AS ready_count FROM sku_channels WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')`, [cm.id]),
        db.query(`SELECT COUNT(*)::int AS no_competitor_count FROM sku_channels WHERE customer_marketplace_id = $1 AND tier = '3'`, [cm.id]),
      ]);

    const noEanCount = Math.max(0, skusTotal - total_skus);
    // "X produtos" = EAN-bearing + EAN-less (all OF21 offers)
    const totalOffers = total_skus + noEanCount;

    return reply.view('pages/onboarding-scan-ready.eta', {
      totalOffers,      // "X produtos encontrados no Worten"
      readyCount: ready_count,        // "Y prontos para repricing"
      noCompetitorCount: no_competitor_count, // "Z sem competidores"
      noEanCount,       // "W sem EAN"
    });
  });
}
```

---

## Critical Constraints (Do Not Violate)

1. **No audit event** — `writeAuditEvent` MUST NOT be called. This is a read-only summary page.

2. **Verbatim PT copy for UX-DR34** — The "porquê?" disclosure copy is spec-locked. Do not paraphrase or translate differently.

3. **Live counts, no placeholders** — All four count lines MUST come from real DB queries against the populated catalog tables. No hardcoded sample numbers.

4. **No `export default` in source modules** — Route file uses `export default` as a Fastify plugin (framework convention for `fastify.register()`). Helper functions use named exports.

5. **No `.then()` chains** — async/await only.

6. **No `console.log`** — pino only per AD27. Use `req.log` (Fastify built-in pino logger).

7. **No bundler / no SPA framework** — `public/js/onboarding-scan-ready.js` is a plain vanilla script with `defer`. If `<details>` is used for the disclosure, this file may be empty (still create it per F9 pattern).

8. **RLS-aware client in app routes** — use `req.dbClient` from `shared/db/rls-aware-client.js`. Never service-role client in app routes.

9. **No new migrations** — Story 4.7 is read-only. All tables (`skus`, `sku_channels`, `scan_jobs`) were created in Stories 4.2 and 4.4. Do not add any migration file.

---

## Previous Story Learnings (patterns to preserve)

**From Story 4.3 (key entry form):**
- Named exports only (`export async function`, `export const`) in non-route modules. Route files use `export default` for Fastify plugin registration only.
- Eta error injection: pass `{ error: getSafeErrorMessage(err) }` to the template; render via `<%= it.error %>`. Not needed here (read-only page), but maintain the pattern in the route handler.
- Per-page `<script src="/js/...js" defer></script>` near `</body>` per F9 — even for empty script files.

**From Story 4.1 (cron-state.js):**
- ESLint rule `single-source-of-truth` flags raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`. This story does NOT update cron_state — no risk. But do NOT include any raw SQL touching cron_state in this route.

**From Story 2.1 (RLS-aware client):**
- The RLS-aware client is request-scoped. Use `req.dbClient` in the route handler — this is the correct pattern established in Story 2.1.

---

## Visual Design Reference

- `/onboarding/scan-ready`: `_bmad-output/design-references/screens/10-onboarding-scan-ready.html`
  - The stub shows example counts (28.842 prontos / 1.847 sem competidores / 490 sem EAN) and the "porquê?" disclosure in expanded state
  - Implement to match the layout: green success badge at top, count summary card, disclosure, "Continuar →" CTA

Pattern A contract: implement to match the stub within Pedro's sign-off tolerance. Any deviation documented as accepted deviation in sign-off record (AC#6).

---

## Dev Agent Record

### Agent Model Used

(to be filled by dev agent)

### Debug Log References

(none)

### Completion Notes List

(to be filled by dev agent)

### File List

(to be filled by dev agent)

### Change Log

(to be filled by dev agent)
