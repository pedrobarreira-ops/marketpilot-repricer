-- Story 4.2 dependency (scan_jobs table required by Story 4.3 integration tests).
-- Canonical source: Story 4.2 branch (story-4.2-skus-...).
-- Included here so Story 4.3's integration tests can run against a local DB
-- that has the full schema. When Story 4.2 merges, this migration is the same
-- file (same timestamp, same content) so no conflict arises.

-- Required for EXCLUDE constraint on non-range types
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE scan_job_status AS ENUM (
  'PENDING',
  'RUNNING_A01',
  'RUNNING_PC01',
  'RUNNING_OF21',
  'RUNNING_P11',
  'CLASSIFYING_TIERS',
  'SNAPSHOTTING_BASELINE',
  'COMPLETE',
  'FAILED'
);

CREATE TABLE scan_jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  status                   scan_job_status NOT NULL DEFAULT 'PENDING',
  phase_message            text NOT NULL DEFAULT 'A iniciar análise…',  -- PT-localized progress
  skus_total               integer,                                       -- populated after OF21 pagination
  skus_processed           integer NOT NULL DEFAULT 0,
  failure_reason           text,
  started_at               timestamptz NOT NULL DEFAULT NOW(),
  completed_at             timestamptz,

  -- One active scan job at a time per marketplace
  CONSTRAINT scan_job_unique_per_marketplace
    EXCLUDE USING btree (customer_marketplace_id WITH =)
    WHERE (status NOT IN ('COMPLETE', 'FAILED'))
);

ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

-- Customer reads own scan status
CREATE POLICY scan_jobs_select_own ON scan_jobs
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

-- Customer can INSERT their initial scan_jobs row (PENDING only) from the onboarding
-- route (Story 4.3). Worker updates status transitions via service-role (bypassing RLS).
CREATE POLICY scan_jobs_insert_own ON scan_jobs
  FOR INSERT WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
