// shared/state/transitions-matrix.js
//
// Story 4.1 / AC#5 — Legal cron_state transition matrix (SSoT).
//
// This is the single authoritative specification for every legal (from, to) pair.
// Consumers of transitionCronState() derive legal/illegal from this module.
// The transitions spec is NOT buried in transitionCronState conditionals —
// the matrix IS the spec (architecture constraint #5 for this story).
//
// 12 legal (from, to) pairs total:
//   1.  PROVISIONING → DRY_RUN                    (scan complete, A01/PC01 populated)
//   2.  DRY_RUN → ACTIVE                          (Go-Live click)
//   3.  ACTIVE → PAUSED_BY_CUSTOMER               (pause click)
//   4.  PAUSED_BY_CUSTOMER → ACTIVE               (resume click)
//   5.  ACTIVE → PAUSED_BY_PAYMENT_FAILURE        (Stripe webhook final-failure)
//   6.  PAUSED_BY_PAYMENT_FAILURE → ACTIVE        (customer re-enters payment + re-Go-Lives)
//   7.  ACTIVE → PAUSED_BY_CIRCUIT_BREAKER        (circuit-breaker trip)
//   8.  PAUSED_BY_CIRCUIT_BREAKER → ACTIVE        (manual unblock)
//   9.  ACTIVE → PAUSED_BY_KEY_REVOKED            (401 detected)
//   10. PAUSED_BY_KEY_REVOKED → ACTIVE            (rotation flow validates new key)
//   11. ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD   (deletion initiated — emits NO audit event per AD20 Q2)
//   12. PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN  (cancel-mid-grace; customer must re-enter Stripe per AD21)

/**
 * Legal cron_state transition matrix.
 * This is the single authoritative spec — NOT buried in conditionals.
 * Every consumer of transitionCronState() derives legal/illegal from this module.
 * 12 legal (from, to) pairs total.
 *
 * @type {Record<string, string[]>}
 */
export const LEGAL_CRON_TRANSITIONS = {
  PROVISIONING:                   ['DRY_RUN'],
  DRY_RUN:                        ['ACTIVE'],
  ACTIVE:                         ['PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE',
    'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED',
    'PAUSED_BY_ACCOUNT_GRACE_PERIOD'],
  PAUSED_BY_CUSTOMER:             ['ACTIVE'],
  PAUSED_BY_PAYMENT_FAILURE:      ['ACTIVE'],
  PAUSED_BY_CIRCUIT_BREAKER:      ['ACTIVE'],
  PAUSED_BY_KEY_REVOKED:          ['ACTIVE'],
  PAUSED_BY_ACCOUNT_GRACE_PERIOD: ['DRY_RUN'],
};
