// public/js/scan-progress.js
//
// Story 4.5 — Client-side polling + DOM updates for /onboarding/scan progress page.
//
// Responsibilities:
//   1. Poll GET /onboarding/scan/status every 1 second (AC#2)
//   2. On COMPLETE → redirect to /onboarding/scan-ready (AC#2)
//   3. On FAILED   → redirect to /scan-failed (AC#2)
//   4. On success  → update shimmer bar, phase text, and checklist classes (AC#2)
//   5. On network error → silent retry next tick (AC#2)
//
// Constraints (Critical):
//   - No import statements (plain defer script, no bundler — architectural constraint #4)
//   - No framework JS (vanilla DOM only — architectural constraint #3)
//   - No console.log in production paths (console.warn acceptable for debug)
//   - Wrapped in IIFE with 'use strict'
//   - No localStorage/sessionStorage — purely server-driven state (AC#5)

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────

  var POLL_INTERVAL_MS = 1000;

  /**
   * Map scan_jobs.status → 1-indexed checklist phase number.
   * Mirrors PHASE_MAP in app/src/routes/onboarding/scan.js (AC#2).
   */
  var PHASE_MAP = {
    PENDING: 1,
    RUNNING_A01: 1,
    RUNNING_PC01: 1,
    RUNNING_OF21: 2,
    RUNNING_P11: 3,
    CLASSIFYING_TIERS: 3,
    SNAPSHOTTING_BASELINE: 4,
    COMPLETE: 5,
    FAILED: 5,
  };

  // ── DOM references ───────────────────────────────────────────────────────────

  var phaseMessageEl = document.querySelector('#scan-phase-message');
  var shimmerBarEl = document.querySelector('#scan-shimmer-bar');
  var skusProcessedEl = document.querySelector('#scan-skus-processed');
  var skusTotalEl = document.querySelector('#scan-skus-total');
  var phaseListEl = document.querySelector('#scan-phase-list');

  // ── Timer handle ─────────────────────────────────────────────────────────────

  var pollTimer = null;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Calculate percentage for shimmer bar.
   *
   * @param {number|null} processed - skus_processed value
   * @param {number|null} total - skus_total value (may be null)
   * @returns {number} percentage clamped to [0, 100]
   */
  function calcPercent (processed, total) {
    if (!total || total === 0) return 0;
    return Math.min(100, Math.round(((processed || 0) / total) * 100));
  }

  /**
   * Apply phase class state to all checklist items in the phase list.
   * Classes: mp-phase--done (phases < active), mp-phase--active (active phase),
   * mp-phase--pending (phases > active).
   *
   * @param {number} activePhase - 1-indexed active phase number
   */
  function applyPhaseClasses (activePhase) {
    if (!phaseListEl) return;
    var items = phaseListEl.querySelectorAll('.mp-scan-phase');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var phaseNum = parseInt(item.getAttribute('data-phase'), 10);
      item.classList.remove('mp-phase--done', 'mp-phase--active', 'mp-phase--pending');
      if (phaseNum < activePhase) {
        item.classList.add('mp-phase--done');
      } else if (phaseNum === activePhase) {
        item.classList.add('mp-phase--active');
      } else {
        item.classList.add('mp-phase--pending');
      }
    }
  }

  /**
   * Update all DOM elements to reflect the latest poll response.
   *
   * @param {{ status: string, phase_message: string, skus_total: number|null, skus_processed: number }} data - poll response
   */
  function updateProgress (data) {
    // Update phase message text
    if (phaseMessageEl) {
      phaseMessageEl.textContent = data.phase_message || '';
    }

    // Update shimmer bar
    var total = data.skus_total;
    var processed = data.skus_processed || 0;
    var wrapper = shimmerBarEl && shimmerBarEl.closest('.mp-shimmer-wrapper');

    if (shimmerBarEl) {
      if (total) {
        // Determinate mode
        var pct = calcPercent(processed, total);
        shimmerBarEl.style.width = pct + '%';
        shimmerBarEl.setAttribute('aria-valuenow', String(pct));
        shimmerBarEl.classList.remove('mp-shimmer-bar--indeterminate');
        if (wrapper) {
          wrapper.classList.remove('mp-shimmer--indeterminate');
          wrapper.classList.add('mp-shimmer--determinate');
        }
      } else {
        // Indeterminate mode (skus_total not yet known)
        shimmerBarEl.style.width = '0%';
        shimmerBarEl.setAttribute('aria-valuenow', '0');
        shimmerBarEl.classList.add('mp-shimmer-bar--indeterminate');
        if (wrapper) {
          wrapper.classList.add('mp-shimmer--indeterminate');
          wrapper.classList.remove('mp-shimmer--determinate');
        }
      }
    }

    // Update SKU counters
    if (skusProcessedEl) {
      skusProcessedEl.textContent = String(processed);
    }
    if (skusTotalEl) {
      skusTotalEl.textContent = total ? String(total) : '—';
    }

    // Update checklist phase classes
    var activePhase = PHASE_MAP[data.status] || 1;
    applyPhaseClasses(activePhase);
  }

  // ── Polling ──────────────────────────────────────────────────────────────────

  /**
   * Perform a single poll of GET /onboarding/scan/status.
   * Redirects on COMPLETE or FAILED; updates DOM on success; silently retries on error.
   */
  function poll () {
    fetch('/onboarding/scan/status')
      .then(function (res) {
        // Non-2xx (e.g. 404 when no scan_jobs row, 429 when rate-limited,
        // 5xx on transient server error). Don't parse the JSON — its shape
        // is `{ error: "…" }` which has no `status` field, would fall
        // through to updateProgress() with all undefined fields and corrupt
        // the DOM (phase_message → '', shimmer → 0%, all phases reset).
        // Silent retry next tick matches AC#2's network-error policy.
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data) return; // non-2xx response — skip this tick
        if (data.status === 'COMPLETE') {
          clearInterval(pollTimer);
          window.location.href = '/onboarding/scan-ready';
          return;
        }
        if (data.status === 'FAILED') {
          clearInterval(pollTimer);
          window.location.href = '/scan-failed';
          return;
        }
        updateProgress(data);
      })
      .catch(function () {
        // Network error — silently retry next tick (AC#2)
      });
  }

  // ── Initialise ───────────────────────────────────────────────────────────────

  // Fire immediately on load — don't wait 1s for the first update (AC#5)
  poll();

  // Start polling every 1 second
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
})();
