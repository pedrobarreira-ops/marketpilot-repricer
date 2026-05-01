CREATE TABLE worker_heartbeats (
  id bigserial PRIMARY KEY,
  worker_instance_id text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT NOW()
);

-- No RLS policy: system-internal table, accessed only via service-role connection.
-- The automatic RLS trigger on this Supabase project will enable RLS on the table,
-- but with no policies defined, access is denied to all JWT-scoped connections --
-- which is the desired behavior (service-role bypasses RLS entirely).
