// worker/src/jobs/pri02-poll.js — Story 6.2 / AC#1
//
// PRI02 poll cron job: every 5 minutes, queries all distinct pending import IDs
// across all customers and dispatches pollImportStatus for each.
//
// Cross-customer query pattern: this is the ONLY cross-customer query in this
// module. It is annotated with '// safe: cross-customer cron' to suppress the
// worker-must-filter-by-customer ESLint rule. All subsequent per-import queries
// pass customerMarketplaceId explicitly (ESLint compliant).
//
// Concurrency: no in-flight guard here (unlike master-cron.js). PRI02 polling
// is fast (one HTTP GET per import) and each import is independent. Parallel
// ticks are safe.
//
// Registration: imported and started in worker/src/index.js via startPri02PollCron().

import cron from 'node-cron';
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';
import { decryptShopApiKey } from '../../../shared/crypto/envelope.js';
import { pollImportStatus } from '../../../shared/mirakl/pri02-poller.js';
import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger();

/**
 * Initialise and start the PRI02 poll cron.
 * Fires every 5 minutes (every-5-minute schedule) — independent schedule from master-cron.js.
 *
 * @returns {void}
 */
export function startPri02PollCron () {
  const task = cron.schedule('*/5 * * * *', () => {
    runPri02PollTick(logger).catch((err) => {
      logger.error({ err }, 'pri02-poll: cron tick rejected');
    });
  }, { scheduled: false });

  task.start();
  logger.info('pri02-poll: cron registered (every 5 minutes)');
}

/**
 * Single PRI02 poll tick: query all pending imports and dispatch pollImportStatus.
 *
 * @param {import('pino').Logger} tickLogger
 * @returns {Promise<void>}
 */
async function runPri02PollTick (tickLogger) {
  tickLogger.info('pri02-poll: tick starting');

  const pool = getServiceRoleClient();

  // Cross-customer query: select all distinct (pending_import_id, customer_marketplace_id)
  // pairs so we can poll each import once regardless of how many sku_channel rows share it.
  // safe: cross-customer cron
  const { rows: pendingImports } = await pool.query(
    `SELECT DISTINCT sc.pending_import_id, sc.customer_marketplace_id
       FROM sku_channels sc
      WHERE sc.pending_import_id IS NOT NULL`
  );

  if (pendingImports.length === 0) {
    tickLogger.debug('pri02-poll: no pending imports — tick done');
    return;
  }

  tickLogger.info({ count: pendingImports.length }, 'pri02-poll: pending imports found');

  // Dispatch pollImportStatus for each (pending_import_id, customer_marketplace_id) pair.
  for (const { pending_import_id: importId, customer_marketplace_id: customerMarketplaceId } of pendingImports) {
    try {
      // Fetch the encrypted shop_api_key and baseUrl for this customer.
      const { rows: vaultRows } = await pool.query(
        `SELECT v.encrypted_api_key_ciphertext,
                v.encrypted_api_key_iv,
                v.encrypted_api_key_tag
           FROM shop_api_key_vault v
          WHERE v.customer_marketplace_id = $1
          LIMIT 1`,
        [customerMarketplaceId]
      );

      if (vaultRows.length === 0) {
        tickLogger.warn({ importId, customerMarketplaceId }, 'pri02-poll: no vault row found — skipping import');
        continue;
      }

      const { rows: cmRows } = await pool.query(
        `SELECT cm.base_url
           FROM customer_marketplaces cm
          WHERE cm.id = $1
          LIMIT 1`,
        [customerMarketplaceId]
      );

      if (cmRows.length === 0) {
        tickLogger.warn({ importId, customerMarketplaceId }, 'pri02-poll: no customer_marketplace row found — skipping import');
        continue;
      }

      const vaultRow = vaultRows[0];
      const { base_url: baseUrl } = cmRows[0];

      const apiKey = decryptShopApiKey({
        ciphertext: vaultRow.encrypted_api_key_ciphertext,
        iv: vaultRow.encrypted_api_key_iv,
        tag: vaultRow.encrypted_api_key_tag,
      });

      await pollImportStatus(baseUrl, apiKey, importId, customerMarketplaceId, pool);
    } catch (err) {
      // Log and continue — one failed import must not block polling of others.
      // apiKey must never appear in the log (AD27 / NFR-S1).
      tickLogger.error(
        { importId, customerMarketplaceId, err_name: err?.name, err_code: err?.code },
        'pri02-poll: failed to poll import — continuing with next'
      );
    }
  }

  tickLogger.info({ count: pendingImports.length }, 'pri02-poll: tick complete');
}
