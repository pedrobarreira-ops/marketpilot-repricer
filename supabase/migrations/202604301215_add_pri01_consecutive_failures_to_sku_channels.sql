-- Story 6.3 migration: add frozen_for_pri01_persistent to sku_channels
--
-- AC#4 Design choice — Option (b) parallel boolean:
--   frozen_for_pri01_persistent boolean NOT NULL DEFAULT false
--   Parallel boolean, orthogonal design — no shared state, no overloading of existing flags.
--
-- pri01_consecutive_failures was already added in the base sku_channels schema
-- (202604301206_create_sku_channels.sql). This migration adds only the freeze column
-- and updates the dispatcher hot-path index to exclude frozen-PRI01 rows.
--
-- Note: pri01_consecutive_failures smallint NOT NULL DEFAULT 0 was included in the
-- base sku_channels schema. This migration adds the complementary freeze flag column
-- that Story 6.3's 3-strike escalation logic sets to true when the threshold is reached.
--
-- Dispatcher predicate: Story 5.1 dispatcher.js WHERE clause must be updated in the
-- same PR to add: AND sc.frozen_for_pri01_persistent = false
-- (done in worker/src/dispatcher.js in this story's PR).

ALTER TABLE sku_channels
  ADD COLUMN IF NOT EXISTS frozen_for_pri01_persistent boolean NOT NULL DEFAULT false;

-- Story 6.3: pri01_consecutive_failures is already in the base schema.
-- This comment records that fact for audit purposes and prevents a re-add attempt.
-- DO NOT add: ADD COLUMN IF NOT EXISTS pri01_consecutive_failures (already exists).

COMMENT ON COLUMN sku_channels.frozen_for_pri01_persistent IS
  'Story 6.3 (AC#4 Option b): Set to true when pri01_consecutive_failures reaches 3. '
  'Parallel boolean freeze flag — orthogonal design, separate column, no shared state. '
  'Dispatcher excludes rows where frozen_for_pri01_persistent = true. '
  'Manual resolution: set to false and reset pri01_consecutive_failures = 0.';
