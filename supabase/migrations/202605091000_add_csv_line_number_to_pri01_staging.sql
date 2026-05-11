-- Story 6.3 course correction (2026-05-09) — AC#6
--
-- Add csv_line_number column to pri01_staging.
--
-- Rationale: The lineMap produced by buildPri01Csv is transient (generated at PRI01
-- flush time and discarded after the multipart POST). Without persistent line numbers,
-- pri02-poller.js cannot reconstruct the lineMap at PRI02 poll time (minutes later),
-- making fetchAndParseErrorReport unable to map PRI03 error lines back to shop_sku values.
--
-- Fix: persist csv_line_number in pri01_staging at flush time (inside the same tx as the
-- import_id update). pri02-poller.js FAILED path queries this column to rebuild the lineMap
-- before invoking the PRI03 parser. This closes the wire-up gap identified in PR #85 audit.
--
-- Column is nullable: rows written before flush (during cycle assembly) have no line number yet.
-- The flush transaction in shared/mirakl/pri01-writer.js populates csv_line_number per row.
--
-- IMPORTANT: Do NOT modify 202604301214_create_pri01_staging.sql — migrations are immutable.
-- This new column ships in this separate migration only.
--
-- Filename: 202605091000 — 12 numeric digits per Supabase CLI requirement (CLAUDE.md Contract #15).

ALTER TABLE pri01_staging
  ADD COLUMN csv_line_number INTEGER;

COMMENT ON COLUMN pri01_staging.csv_line_number IS
  'CSV body row number (1-based) assigned at PRI01 flush. NULL pre-flush. '
  'Set by shared/mirakl/pri01-writer.js inside the same transaction as the import_id update. '
  'Used by pri02-poller.js FAILED path to reconstruct lineMap for pri03-parser. '
  'Story 6.3 course correction (AC#6, 2026-05-09).';
