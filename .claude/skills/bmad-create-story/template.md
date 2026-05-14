# Story {{epic_num}}.{{story_num}}: {{story_title}}

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a {{role}},
I want {{action}},
so that {{benefit}}.

## Acceptance Criteria

1. [Add acceptance criteria from epics/PRD]

## Tasks / Subtasks

- [ ] Task 1 (AC: #)
  - [ ] Subtask 1.1
- [ ] Task 2 (AC: #)
  - [ ] Subtask 2.1

## Dev Notes

- Relevant architecture patterns and constraints
- Source tree components to touch
- Testing standards summary

### Mechanism trace

REQUIRED for any story whose ACs describe outcomes achieved by transactional, cross-file, or call-chain mechanisms (state transitions, audit emission, cron wire-up, atomicity bundles, etc.). Skip only for pure-additive stories with no mechanism dependency (e.g., new lint rule, new doc, isolated utility).

Cite concrete `file:line` evidence for each item:

- **Call-chain trace** — Where does the call originate (cron entry, route handler, sibling module)? What is the full path from entry to the new code? Identify the producing site for every input the new code consumes.
- **Tx-topology citation** — For each DB write or audit emission: does the surrounding `tx` come from an explicit `BEGIN/COMMIT` block, or is it autocommit-per-statement? Cite the BEGIN site (or its absence) by `file:line`. Reference [project-context.md](../../project-context.md) §3 Bundle B variants.
- **Commit-boundary explicit** — When does each write become durable? Identify the precise commit boundary (statement-level autocommit, BEGIN/COMMIT close, etc.) and whether any side effects (alerts, notifications, downstream emissions) run before or after that boundary.
- **Statement-ordering justification** — If the implementation relies on statement order (e.g., UPDATE before INSERT-into-audit so audit rows never out-run persisted state), state the invariant explicitly. If reordering would break correctness, say why.

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming)
- Detected conflicts or variances (with rationale)

### References

- Cite all technical details with source paths and sections, e.g. [Source: docs/<file>.md#Section]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
