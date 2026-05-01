-- /health probes MAX(written_at) every ping; index keeps that O(log n) as the
-- table grows (~1M rows/year/worker pre-retention).
CREATE INDEX worker_heartbeats_written_at_desc_idx
  ON worker_heartbeats (written_at DESC);
