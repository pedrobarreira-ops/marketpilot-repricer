# Phase 4.5 Step 1: Determine the Batch — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `BATCH_STORIES` (current batch from Phase 2)
- `BATCH_STORIES_WITH_PRS` (story → #PR pairs from Phase 4 Step 2's summary)

---

Read `_bmad-output/implementation-artifacts/sprint-status.yaml`. Extract:

1. The top-level `integration_test_required:` block. May be absent or empty —
   if so, return `INTEGRATION_TEST_BATCH = []` and exit.

2. For each story in the current batch (the coordinator passes the batch
   list as `BATCH_STORIES`), check whether the story key appears in the
   `integration_test_required:` block with value `true`. If yes, capture:
     - story key (e.g. "2-1-rls-aware-...")
     - the inline YAML comment after the `true` value (e.g.
       "pg Pool + RLS + auth contract surface") — this is the per-story reason

3. Read package.json and extract the full `test:integration` script value.
   Save as `TEST_INTEGRATION_CMD` (string) and `SCRIPT_EXISTS` (boolean).

4. Return:
   - INTEGRATION_TEST_BATCH: list of {story, pr_number, reason} for batch
     stories tagged `true`
   - SCRIPT_EXISTS: boolean
   - TEST_INTEGRATION_CMD: the raw script string (e.g.
     "node --env-file=.env.test --test --test-concurrency=1 ...")

The PR numbers come from Phase 4 Step 2's batch summary; the coordinator
substitutes them as `BATCH_STORIES_WITH_PRS`.
