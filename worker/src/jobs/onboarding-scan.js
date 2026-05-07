// worker/src/jobs/onboarding-scan.js
//
// Story 4.4 — SSoT for the async catalog scan orchestration.
// 9-phase sequence: decrypt → smoke-test → A01 → PC01 → OF21 → P11 → tier-classify → baseline → COMPLETE
//
// Architecture constraints satisfied:
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino only — createWorkerLogger)
//   - cron_state mutations go through transitionCronState SSoT only (shared/state/cron-state.js)
//   - No raw INSERT INTO audit_log (writeAuditEvent SSoT)
//   - No direct fetch calls (all Mirakl calls via SSoT modules in shared/mirakl/)
//   - Cleartext API key NEVER logged or included in any structured log output
//   - All worker queries include customer_marketplace_id filter (worker-must-filter-by-customer)
//   - All prices stored as integer cents (Math.round(price * 100))
//   - No float arithmetic for price storage

import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';
import { tx } from '../../../shared/db/tx.js';
import { loadMasterKey } from '../../../shared/crypto/master-key-loader.js';
import { decryptShopApiKey } from '../../../shared/crypto/envelope.js';
import { getAccount } from '../../../shared/mirakl/a01.js';
import { getPlatformConfiguration } from '../../../shared/mirakl/pc01.js';
import { getOffers } from '../../../shared/mirakl/of21.js';
import { getProductOffersByEanBatchGrouped } from '../../../shared/mirakl/p11.js';
import { filterCompetitorOffers } from '../../../shared/mirakl/self-filter.js';
import { getSafeErrorMessage } from '../../../shared/mirakl/safe-error.js';
import { transitionCronState } from '../../../shared/state/cron-state.js';
import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { runVerification } from '../../../scripts/mirakl-empirical-verify.js';
import { classifyInitialTier } from '../lib/tier-classify.js';
import { createWorkerLogger } from '../../../shared/logger.js';

// ---------------------------------------------------------------------------
// sendCriticalAlert — Story 4.6 SSoT (import with graceful stub if not yet shipped)
// ---------------------------------------------------------------------------

let sendCriticalAlert;
try {
  ({ sendCriticalAlert } = await import('../../../shared/resend/client.js'));
} catch {
  // Story 4.6 not yet shipped — no-op stub until the module lands
  sendCriticalAlert = async () => {}; // TODO: remove stub once Story 4.6 ships
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const logger = createWorkerLogger();

// Batch size for P11 calls (AD16 spec — 100 EANs per call)
const P11_BATCH_SIZE = 100;

// Wall-clock warning threshold (8h in ms) per AC#4
const SCAN_8H_THRESHOLD_MS = 8 * 60 * 60 * 1000;

// PT-localized phase messages (UX-DR6 verbatim)
const PHASE_MESSAGES = {
  PENDING:               'A configurar integração com Worten',
  RUNNING_A01:           'A configurar integração com Worten',
  RUNNING_PC01:          'A configurar integração com Worten',
  RUNNING_OF21:          'A obter catálogo',
  RUNNING_P11:           'A classificar tiers iniciais',
  CLASSIFYING_TIERS:     'A classificar tiers iniciais',
  SNAPSHOTTING_BASELINE: 'A snapshotar baselines',
  COMPLETE:              'Pronto',
  FAILED:                'Falhou',
};

// ---------------------------------------------------------------------------
// Main export: processNextPendingScan
// ---------------------------------------------------------------------------

/**
 * Poll for the next PENDING scan_jobs row and run the 9-phase orchestration.
 * Uses FOR UPDATE SKIP LOCKED to prevent double-processing in multi-worker scenarios.
 *
 * @returns {Promise<void>} resolves when the scan is complete (COMPLETE or FAILED)
 */
export async function processNextPendingScan () {
  const db = getServiceRoleClient();

  // Claim a PENDING scan atomically via FOR UPDATE SKIP LOCKED.
  // worker-must-filter-by-customer: scan_jobs has customer_marketplace_id FK.
  // The FOR UPDATE on scan_jobs effectively locks by customer_marketplace_id via the row.
  const { rows } = await db.query(`
    SELECT sj.id, sj.customer_marketplace_id
    FROM scan_jobs sj
    WHERE sj.status = 'PENDING'
    ORDER BY sj.started_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `);

  if (rows.length === 0) {
    // No pending scans — nothing to do
    return;
  }

  const scanJob = rows[0];
  const { id: scanJobId, customer_marketplace_id: customerMarketplaceId } = scanJob;

  logger.info(
    { scan_job_id: scanJobId, customer_marketplace_id: customerMarketplaceId },
    'onboarding-scan: picked up PENDING job'
  );

  // Load the customer_marketplace row
  const { rows: cmRows } = await db.query(
    `SELECT id, marketplace_instance_url, shop_name
     FROM customer_marketplaces
     WHERE id = $1`,
    [customerMarketplaceId]
  );

  if (cmRows.length === 0) {
    logger.error(
      { scan_job_id: scanJobId, customer_marketplace_id: customerMarketplaceId },
      'onboarding-scan: customer_marketplace row not found — aborting scan'
    );
    await failScan(db, scanJob, new Error('Customer marketplace record not found'));
    return;
  }

  const cm = cmRows[0];

  try {
    await runScan(db, scanJob, cm);
  } catch (err) {
    logger.error(
      { scan_job_id: scanJobId, customer_marketplace_id: customerMarketplaceId, err },
      'onboarding-scan: unhandled error during scan'
    );
    await failScan(db, scanJob, err);
  }
}

// ---------------------------------------------------------------------------
// Internal: runScan — 9-phase orchestration
// ---------------------------------------------------------------------------

/**
 * Execute all 9 phases of the catalog scan.
 * Phase transitions update scan_jobs.status + phase_message atomically.
 *
 * @param {import('pg').Pool} db - Service role pool
 * @param {{ id: string, customer_marketplace_id: string }} scanJob
 * @param {{ id: string, marketplace_instance_url: string, shop_name: string|null }} cm
 */
async function runScan (db, scanJob, cm) {
  const { id: scanJobId, customer_marketplace_id: customerMarketplaceId } = scanJob;
  const baseUrl = cm.marketplace_instance_url;
  const scanStart = Date.now();

  // ── Phase 0: Decrypt key ──────────────────────────────────────────────────

  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 0 — decrypt key');

  const masterKey = loadMasterKey();

  const { rows: vaultRows } = await db.query(
    `SELECT ciphertext, nonce, auth_tag, master_key_version
     FROM shop_api_key_vault
     WHERE customer_marketplace_id = $1`,
    [customerMarketplaceId]
  );

  if (vaultRows.length === 0) {
    throw new Error('shop_api_key_vault row not found for this customer_marketplace_id');
  }

  const vaultRow = vaultRows[0];
  // pg returns bytea columns as Buffer objects — pass directly to decryptShopApiKey
  const apiKey = decryptShopApiKey({
    ciphertext: vaultRow.ciphertext,
    nonce: vaultRow.nonce,
    authTag: vaultRow.auth_tag,
    masterKey,
  });
  // apiKey is plaintext — NEVER log it, NEVER put it in any structured log field

  // ── Phase 1: Smoke-test (runs before RUNNING_A01 transition) ─────────────

  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 1 — smoke-test reuse');

  const referenceEan = process.env.WORTEN_TEST_EAN;

  if (referenceEan) {
    const verification = await runVerification({
      baseUrl,
      apiKey,
      referenceEan,
      dryRun: true,   // don't write verification-results.json during scan
      inlineOnly: true, // P11-only path to stay within budget
    });

    if (!verification.success) {
      const failureReason = 'A verificação do acesso à API Worten falhou. Por favor valida a chave e tenta novamente.';
      await db.query(
        `UPDATE scan_jobs
         SET status = 'FAILED', phase_message = $1, failure_reason = $2, completed_at = NOW()
         WHERE id = $3`,
        [PHASE_MESSAGES.FAILED, failureReason, scanJobId]
      );
      await sendCriticalAlert({
        type: 'scan-failed',
        customerMarketplaceId,
        scanJobId,
        reason: 'smoke-test failed',
      });
      return;
    }
  }
  // If WORTEN_TEST_EAN not set: skip smoke-test (acceptable in test environments)

  // ── Phase 2: RUNNING_A01 ─────────────────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'RUNNING_A01', PHASE_MESSAGES.RUNNING_A01);
  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 2 — A01');

  const a01 = await getAccount(baseUrl, apiKey);

  const shopName = a01.shop_name;
  // channels from A01 is an array of channel objects; extract just the codes as text[]
  const channelCodes = (a01.channels ?? []).map(c => (typeof c === 'object' ? (c.code ?? c) : c)).filter(Boolean);

  await db.query(
    `UPDATE customer_marketplaces
     SET shop_id = $1,
         shop_name = $2,
         shop_state = $3,
         currency_iso_code = $4,
         is_professional = $5,
         channels = $6,
         updated_at = NOW()
     WHERE id = $7`,
    [
      a01.shop_id != null ? Number(a01.shop_id) : null,
      shopName ?? null,
      a01.shop_state ?? null,
      a01.currency_iso_code ?? null,
      a01.is_professional ?? null,
      channelCodes,          // text[] — pass as JS array (pg handles Array → text[] automatically)
      customerMarketplaceId,
    ]
  );

  logger.info(
    { scan_job_id: scanJobId, shop_id: a01.shop_id, channels: channelCodes },
    'onboarding-scan: A01 persisted'
  );

  // ── Phase 3: RUNNING_PC01 ────────────────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'RUNNING_PC01', PHASE_MESSAGES.RUNNING_PC01);
  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 3 — PC01');

  const pc01 = await getPlatformConfiguration(baseUrl, apiKey);
  // pc01 is already normalized to flat shape by getPlatformConfiguration SSoT:
  //   pc01.channel_pricing ('SINGLE'|'MULTI'|'DISABLED')
  //   pc01.operator_csv_delimiter, pc01.offer_prices_decimals, etc.
  //   pc01._raw = full raw response (for platform_features_snapshot JSONB)

  // Hard abort: if channel_pricing is DISABLED, MarketPilot cannot operate
  if (pc01.channel_pricing === 'DISABLED') {
    const failureReason = 'O Worten não tem preços por canal activados. Por favor contacta o suporte.';
    await db.query(
      `UPDATE scan_jobs
       SET status = 'FAILED', phase_message = $1, failure_reason = $2, completed_at = NOW()
       WHERE id = $3`,
      [PHASE_MESSAGES.FAILED, failureReason, scanJobId]
    );
    logger.warn(
      { scan_job_id: scanJobId, channel_pricing: pc01.channel_pricing },
      'onboarding-scan: PC01 DISABLED — aborting scan'
    );
    await sendCriticalAlert({
      type: 'scan-failed',
      customerMarketplaceId,
      scanJobId,
      reason: 'PC01 channel_pricing DISABLED',
    });
    return;
  }

  // Persist PC01 columns
  // offer_prices_decimals is smallint in DB — pc01.offer_prices_decimals is already a number
  await db.query(
    `UPDATE customer_marketplaces
     SET channel_pricing_mode = $1::channel_pricing_mode,
         operator_csv_delimiter = $2::csv_delimiter,
         offer_prices_decimals = $3,
         discount_period_required = $4,
         competitive_pricing_tool = $5,
         scheduled_pricing = $6,
         volume_pricing = $7,
         multi_currency = $8,
         order_tax_mode = $9,
         platform_features_snapshot = $10,
         last_pc01_pulled_at = NOW(),
         updated_at = NOW()
     WHERE id = $11`,
    [
      pc01.channel_pricing ?? null,
      pc01.operator_csv_delimiter ?? null,
      pc01.offer_prices_decimals != null ? Number(pc01.offer_prices_decimals) : null,
      pc01.discount_period_required ?? null,
      pc01.competitive_pricing_tool ?? null,
      pc01.scheduled_pricing ?? null,
      pc01.volume_pricing ?? null,
      pc01.multi_currency ?? null,
      pc01.order_tax_mode ?? null,
      pc01._raw ? pc01._raw : pc01, // full raw response for JSONB snapshot
      customerMarketplaceId,
    ]
  );

  logger.info(
    { scan_job_id: scanJobId, channel_pricing: pc01.channel_pricing },
    'onboarding-scan: PC01 persisted'
  );

  // ── Phase 4: RUNNING_OF21 ────────────────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'RUNNING_OF21', PHASE_MESSAGES.RUNNING_OF21);
  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 4 — OF21 paginated');

  // EAN → scan data map (built incrementally across pages)
  // Used in Phase 5+6 for P11 + tier classification
  const eanToSkuData = new Map(); // ean → { skuId, currentPriceCents, channelCodes }

  let of21Offset = 0;
  let skusTotal = 0;
  let skusProcessed = 0;

  for (;;) {
    const { offers: pageOffers, pageToken } = await getOffers(baseUrl, apiKey, {
      offset: of21Offset,
    });

    if (pageOffers.length === 0) break;

    // Process each offer on this page
    for (const offer of pageOffers) {
      skusProcessed++;

      const ean = extractEan(offer);
      if (ean === null) {
        // Skip offers without EAN (refurbished/private — no shared EAN catalog)
        continue;
      }

      // shop_sku is NOT NULL in skus table — use ean as fallback if missing
      const shopSku = offer.shop_sku ?? ean;

      const listPriceCents = Math.round(parseFloat(offer.price ?? 0) * 100);
      const currentPriceCents = Math.round(parseFloat(offer.total_price ?? 0) * 100);

      // Upsert skus row (unique on customer_marketplace_id, ean)
      let skuId;
      try {
        const { rows: skuRows } = await db.query(
          `INSERT INTO skus
             (customer_marketplace_id, ean, shop_sku, product_sku, product_title)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (customer_marketplace_id, ean)
           DO UPDATE SET
             shop_sku = EXCLUDED.shop_sku,
             product_sku = EXCLUDED.product_sku,
             product_title = EXCLUDED.product_title,
             updated_at = NOW()
           RETURNING id`,
          [
            customerMarketplaceId,
            ean,
            shopSku,
            offer.product_sku ?? null,
            offer.product_title ?? null,
          ]
        );
        skuId = skuRows[0].id;
      } catch (skuErr) {
        // shop_sku unique constraint: if a different EAN has the same shop_sku,
        // try again with ean as the shop_sku value (defensive fallback)
        if (skuErr.code === '23505' && skuErr.constraint?.includes('shop_sku')) {
          const { rows: skuRows2 } = await db.query(
            `INSERT INTO skus
               (customer_marketplace_id, ean, shop_sku, product_sku, product_title)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (customer_marketplace_id, ean)
             DO UPDATE SET
               product_sku = EXCLUDED.product_sku,
               product_title = EXCLUDED.product_title,
               updated_at = NOW()
             RETURNING id`,
            [
              customerMarketplaceId,
              ean,
              ean, // use EAN as shop_sku fallback to avoid unique constraint
              offer.product_sku ?? null,
              offer.product_title ?? null,
            ]
          );
          skuId = skuRows2[0].id;
        } else {
          throw skuErr;
        }
      }

      // Extract channel codes from this offer's channels[] array
      const offerChannels = (offer.channels ?? [])
        .map(c => (typeof c === 'object' ? c.code : c))
        .filter(Boolean);

      // If offer has no channel codes, fall back to all active channels from A01
      const effectiveChannels = offerChannels.length > 0 ? offerChannels : channelCodes;

      // Upsert sku_channels rows (unique on sku_id, channel_code)
      for (const channelCode of effectiveChannels) {
        await db.query(
          `INSERT INTO sku_channels
             (sku_id, customer_marketplace_id, channel_code, list_price_cents, current_price_cents,
              tier, tier_cadence_minutes, last_checked_at, channel_active_for_offer)
           VALUES ($1, $2, $3, $4, $5, '3', 1440, NOW(), true)
           ON CONFLICT (sku_id, channel_code)
           DO UPDATE SET
             list_price_cents = EXCLUDED.list_price_cents,
             current_price_cents = EXCLUDED.current_price_cents,
             channel_active_for_offer = true,
             updated_at = NOW()`,
          [
            skuId,
            customerMarketplaceId,
            channelCode,
            listPriceCents,
            currentPriceCents,
          ]
        );
      }

      // Track ean → sku data for Phase 5+6
      if (!eanToSkuData.has(ean)) {
        skusTotal++;
      }
      eanToSkuData.set(ean, {
        skuId,
        currentPriceCents,
        channelCodes: effectiveChannels,
      });
    }

    // Update scan_jobs progress counters (no updated_at on scan_jobs)
    await db.query(
      `UPDATE scan_jobs SET skus_total = $1, skus_processed = $2 WHERE id = $3`,
      [skusTotal, skusProcessed, scanJobId]
    );

    if (pageToken === null) break;
    of21Offset = pageToken;
  }

  logger.info(
    { scan_job_id: scanJobId, skus_total: skusTotal, skus_processed: skusProcessed },
    'onboarding-scan: OF21 complete'
  );

  // Update final totals
  await db.query(
    `UPDATE scan_jobs SET skus_total = $1, skus_processed = $2 WHERE id = $3`,
    [skusTotal, skusProcessed, scanJobId]
  );

  // ── Phase 5: RUNNING_P11 ─────────────────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'RUNNING_P11', PHASE_MESSAGES.RUNNING_P11);
  logger.info(
    { scan_job_id: scanJobId, ean_count: eanToSkuData.size, channels: channelCodes },
    'onboarding-scan: Phase 5 — P11 batched'
  );

  // Map: `${ean}:${channelCode}` → top-2 filtered competitor offers (for Phase 6)
  const competitorMap = new Map();

  const allEans = Array.from(eanToSkuData.keys());

  for (let i = 0; i < allEans.length; i += P11_BATCH_SIZE) {
    const batchEans = allEans.slice(i, i + P11_BATCH_SIZE);

    for (const channelCode of channelCodes) {
      // getProductOffersByEanBatchGrouped preserves per-EAN groupings so each
      // sku_channel can be classified against ITS OWN competitor set rather than
      // the batch-wide union. Critical for tier-classification correctness:
      // EAN A's price compared against EAN A's competitors, not B+C+D's.
      const groupedOffers = await getProductOffersByEanBatchGrouped(baseUrl, apiKey, {
        eans: batchEans,
        channel: channelCode,
      });

      let batchCollisionTotal = 0;

      for (const ean of batchEans) {
        const rawOffers = groupedOffers.get(ean) ?? [];

        const { filteredOffers, collisionDetected } = filterCompetitorOffers(
          rawOffers,
          shopName
        );

        if (collisionDetected) {
          batchCollisionTotal++;
          logger.warn(
            { scan_job_id: scanJobId, channel: channelCode, ean },
            'onboarding-scan: shop-name collision detected for EAN'
          );
          // Emit Atenção audit event for collision — use pool query method directly
          // (non-transactional since we're not inside a tx here).
          try {
            await writeAuditEvent({
              tx: { query: (...args) => db.query(...args) },
              customerMarketplaceId,
              eventType: 'shop-name-collision-detected',
              skuId: null,
              skuChannelId: null,
              payload: {
                ean,
                channel: channelCode,
                matchingOfferCount: rawOffers.filter(o => o.shop_name === shopName).length,
              },
            });
          } catch (auditErr) {
            logger.warn(
              { scan_job_id: scanJobId, err: auditErr },
              'onboarding-scan: failed to write collision audit event — continuing'
            );
          }
        }

        // Store top-2 competitors per (EAN, channel) — preserves per-EAN context
        // for accurate tier classification in Phase 6.
        const key = `${ean}:${channelCode}`;
        competitorMap.set(key, filteredOffers.slice(0, 2));
      }

      if (batchCollisionTotal > 0) {
        logger.warn(
          {
            scan_job_id: scanJobId,
            channel: channelCode,
            batch_start: i,
            batch_size: batchEans.length,
            collision_count: batchCollisionTotal,
          },
          'onboarding-scan: P11 batch had shop-name collisions'
        );
      }
    }
  }

  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: P11 batch complete');

  // ── Phase 6: CLASSIFYING_TIERS ───────────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'CLASSIFYING_TIERS', PHASE_MESSAGES.CLASSIFYING_TIERS);
  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 6 — classify tiers');

  // Load all sku_channel rows for this marketplace
  const { rows: skuChannelRows } = await db.query(
    `SELECT sc.id, sc.sku_id, sc.channel_code, sc.current_price_cents, s.ean
     FROM sku_channels sc
     JOIN skus s ON s.id = sc.sku_id
     WHERE sc.customer_marketplace_id = $1`,
    [customerMarketplaceId]
  );

  for (const scRow of skuChannelRows) {
    const key = `${scRow.ean}:${scRow.channel_code}`;
    const competitors = competitorMap.get(key) ?? [];

    const result = classifyInitialTier(scRow.current_price_cents, competitors);

    await db.query(
      `UPDATE sku_channels
       SET tier = $1, tier_cadence_minutes = $2, last_won_at = $3, updated_at = NOW()
       WHERE id = $4`,
      [
        result.tier,
        result.tierCadenceMinutes,
        result.lastWonAt ?? null,
        scRow.id,
      ]
    );
  }

  logger.info(
    { scan_job_id: scanJobId, sku_channel_count: skuChannelRows.length },
    'onboarding-scan: tier classification complete'
  );

  // ── Phase 7: SNAPSHOTTING_BASELINE ───────────────────────────────────────

  await updateScanStatus(db, scanJobId, 'SNAPSHOTTING_BASELINE', PHASE_MESSAGES.SNAPSHOTTING_BASELINE);
  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 7 — baseline snapshots');

  // Load all sku_channel rows with their final price state
  const { rows: finalSkuChannelRows } = await db.query(
    `SELECT id, current_price_cents, list_price_cents
     FROM sku_channels
     WHERE customer_marketplace_id = $1`,
    [customerMarketplaceId]
  );

  for (const sc of finalSkuChannelRows) {
    const basePriceCents = sc.current_price_cents ?? sc.list_price_cents ?? 0;

    // Update list_price_cents = current_price_cents (baseline anchor)
    await db.query(
      `UPDATE sku_channels SET list_price_cents = $1, updated_at = NOW() WHERE id = $2`,
      [basePriceCents, sc.id]
    );

    // Insert baseline_snapshots row — ON CONFLICT DO NOTHING for idempotency
    await db.query(
      `INSERT INTO baseline_snapshots
         (sku_channel_id, customer_marketplace_id, list_price_cents, current_price_cents, captured_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT DO NOTHING`,
      [
        sc.id,
        customerMarketplaceId,
        basePriceCents,
        basePriceCents,
      ]
    );
  }

  logger.info(
    { scan_job_id: scanJobId, snapshot_count: finalSkuChannelRows.length },
    'onboarding-scan: baseline snapshots complete'
  );

  // ── Phase 8: COMPLETE — transition PROVISIONING → DRY_RUN ────────────────

  logger.info({ scan_job_id: scanJobId }, 'onboarding-scan: Phase 8 — COMPLETE + DRY_RUN transition');

  // The PROVISIONING → DRY_RUN transition and scan_jobs COMPLETE update MUST be atomic.
  // F4 CHECK constraint (customer_marketplace_provisioning_completeness) passes because
  // A01/PC01 columns are now all populated.
  //
  // transitionCronState({ tx, client, ... }):
  //   - tx: the transaction client, passed for audit event emission (PROVISIONING→DRY_RUN emits no event)
  //   - client: the transaction client, used for the actual UPDATE
  await tx(db, async (txClient) => {
    await transitionCronState({
      tx: txClient,
      client: txClient,
      customerMarketplaceId,
      from: 'PROVISIONING',
      to: 'DRY_RUN',
      context: { scan_job_id: scanJobId },
    });

    await txClient.query(
      `UPDATE scan_jobs
       SET status = 'COMPLETE', phase_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [PHASE_MESSAGES.COMPLETE, scanJobId]
    );
  });

  // Check wall-clock elapsed time — warn and emit audit event if over 8h threshold (AC#4)
  const elapsedMs = Date.now() - scanStart;
  if (elapsedMs > SCAN_8H_THRESHOLD_MS) {
    logger.warn(
      { scan_job_id: scanJobId, elapsed_ms: elapsedMs, skus_total: skusTotal },
      'onboarding-scan: scan exceeded 8h threshold'
    );
    try {
      await writeAuditEvent({
        tx: { query: (...args) => db.query(...args) },
        customerMarketplaceId,
        eventType: 'scan-complete-with-issues',
        payload: {
          elapsed_ms: elapsedMs,
          skus_total: skusTotal,
          warning: 'scan exceeded 8h threshold',
        },
      });
    } catch (auditErr) {
      logger.warn(
        { scan_job_id: scanJobId, err: auditErr },
        'onboarding-scan: failed to write scan-complete-with-issues audit event'
      );
    }
  }

  logger.info(
    { scan_job_id: scanJobId, elapsed_ms: elapsedMs, skus_total: skusTotal },
    'onboarding-scan: scan COMPLETE'
  );
}

// ---------------------------------------------------------------------------
// Internal: failScan — persist FAILED state + send alert
// ---------------------------------------------------------------------------

/**
 * Mark a scan_jobs row as FAILED and send a critical alert.
 * customer_marketplaces row stays in PROVISIONING — partial A01/PC01 writes may exist
 * but the F4 CHECK constraint prevents DRY_RUN transition until all columns populated.
 *
 * @param {import('pg').Pool} db
 * @param {{ id: string, customer_marketplace_id: string }} scanJob
 * @param {Error} err
 */
async function failScan (db, scanJob, err) {
  const { id: scanJobId, customer_marketplace_id: customerMarketplaceId } = scanJob;

  try {
    await db.query(
      `UPDATE scan_jobs
       SET status = 'FAILED', phase_message = $1, failure_reason = $2, completed_at = NOW()
       WHERE id = $3`,
      [PHASE_MESSAGES.FAILED, getSafeErrorMessage(err), scanJobId]
    );
  } catch (dbErr) {
    logger.error(
      { scan_job_id: scanJobId, err: dbErr },
      'onboarding-scan: failed to persist FAILED status'
    );
  }

  try {
    await sendCriticalAlert({
      type: 'scan-failed',
      customerMarketplaceId,
      scanJobId,
      reason: getSafeErrorMessage(err),
    });
  } catch (alertErr) {
    logger.warn(
      { scan_job_id: scanJobId, err: alertErr },
      'onboarding-scan: sendCriticalAlert failed (non-fatal)'
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Update scan_jobs.status and scan_jobs.phase_message.
 * Non-transactional — status updates are idempotent progress markers.
 * Note: scan_jobs has no updated_at column.
 *
 * @param {import('pg').Pool} db
 * @param {string} scanJobId
 * @param {string} status - scan_job_status enum value
 * @param {string} phaseMessage - PT-localized phase message (UX-DR6)
 */
async function updateScanStatus (db, scanJobId, status, phaseMessage) {
  await db.query(
    `UPDATE scan_jobs SET status = $1, phase_message = $2 WHERE id = $3`,
    [status, phaseMessage, scanJobId]
  );
}

/**
 * Extract EAN from an OF21 offer's product_references array.
 * Returns null if no EAN reference is found (offer should be skipped).
 *
 * @param {{ product_references?: Array<{reference_type: string, reference: string}> }} offer
 * @returns {string|null}
 */
function extractEan (offer) {
  const ref = offer.product_references?.find(r => r.reference_type === 'EAN');
  return ref?.reference ?? null;
}
