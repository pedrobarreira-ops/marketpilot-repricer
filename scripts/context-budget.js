#!/usr/bin/env node
// scripts/context-budget.js
//
// Audits the fixed context cost loaded by every BAD subagent invocation.
// Adapted from ECC's `context-budget` skill, tailored to this project's
// specific file layout.
//
// What it audits:
//   - Files every BAD subagent reads (SKILLs + CLAUDE.md + project-context.md
//     + distillate _index files).
//   - Per-file line count, token estimate, and threshold check.
//   - Per-section breakdown (## headings) for files over threshold, so
//     compression targets are data-driven, not vibes.
//
// Why it exists (Epic 2 retro Item: post-bmad-retrospective hook):
//   Every line in a load-bearing file gets re-read by every subagent on every
//   spawn. A 200-line trim saves ~2-3M tokens project-wide across remaining
//   stories. Run this audit per epic retro to catch growth before it becomes
//   expensive.
//
// Usage:
//   node scripts/context-budget.js
//
// Exit codes:
//   0 = all files within threshold
//   1 = at least one file over threshold (retro action item recommended)

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Files every BAD subagent loads (per CLAUDE.md / project-context.md / BAD SKILL.md)
const FILES = [
  '.claude/skills/bad/SKILL.md',
  '.claude/skills/bad-review/SKILL.md',
  'project-context.md',
  'CLAUDE.md',
  '_bmad-output/planning-artifacts/architecture-distillate/_index.md',
  '_bmad-output/planning-artifacts/epics-distillate/_index.md',
];

// Thresholds — line counts above which the file is flagged for compression.
// Set ~10-15% above current target sizes (post-compression) to allow growth
// room while still catching bloat early. Update after each compression pass.
const THRESHOLDS = {
  '.claude/skills/bad/SKILL.md': 1000,
  '.claude/skills/bad-review/SKILL.md': 750,
  'project-context.md': 600,
  'CLAUDE.md': 100,
  '_bmad-output/planning-artifacts/architecture-distillate/_index.md': 150,
  '_bmad-output/planning-artifacts/epics-distillate/_index.md': 500,
};

// Rough estimate: English markdown ≈ 12 tokens per line on average.
const TOKENS_PER_LINE = 12;

function pad(s, n, side = 'right') {
  s = String(s);
  if (s.length >= n) return s;
  return side === 'right' ? s.padEnd(n) : s.padStart(n);
}

function audit() {
  let totalLines = 0;
  let totalTokens = 0;
  let overCount = 0;
  const rows = [];

  for (const file of FILES) {
    const fullPath = resolve(file);
    if (!existsSync(fullPath)) {
      rows.push({ file, lines: -1, tokens: 0, threshold: THRESHOLDS[file] || 0, status: 'MISSING' });
      continue;
    }
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split('\n').length;
    const tokens = Math.round(lines * TOKENS_PER_LINE);
    const threshold = THRESHOLDS[file] || Infinity;
    let status;
    if (lines > threshold) {
      status = `OVER +${lines - threshold}`;
      overCount += 1;
    } else if (lines > threshold * 0.9) {
      status = 'near';
    } else {
      status = 'ok';
    }
    rows.push({ file, lines, tokens, threshold, status });
    totalLines += lines;
    totalTokens += tokens;
  }

  // Header
  console.log('Context Budget Audit');
  console.log('='.repeat(20));
  console.log('');
  console.log(
    pad('File', 70) + pad('Lines', 7, 'left') + pad('Tokens', 9, 'left') + pad('Threshold', 11, 'left') + '  Status'
  );
  console.log('-'.repeat(115));

  for (const r of rows) {
    console.log(
      pad(r.file, 70) +
        pad(r.lines === -1 ? '-' : r.lines, 7, 'left') +
        pad(r.tokens || '-', 9, 'left') +
        pad(r.threshold === Infinity ? '-' : r.threshold, 11, 'left') +
        '  ' +
        r.status
    );
  }
  console.log('-'.repeat(115));
  console.log(pad('TOTAL', 70) + pad(totalLines, 7, 'left') + pad(totalTokens, 9, 'left'));
  console.log('');
  console.log(`Estimated context cost per BAD subagent spawn: ~${(totalTokens / 1000).toFixed(1)}k tokens`);

  // Section breakdown for over-threshold files
  const overFiles = rows.filter((r) => typeof r.status === 'string' && r.status.startsWith('OVER'));
  if (overFiles.length > 0) {
    console.log('');
    console.log('Section breakdown for over-threshold files (top 8 sections by line count):');

    for (const r of overFiles) {
      const content = readFileSync(resolve(r.file), 'utf8');
      const lines = content.split('\n');
      const sections = [];
      let current = { heading: '(intro / preamble)', start: 0 };
      lines.forEach((line, i) => {
        if (line.match(/^##\s+/)) {
          current.end = i;
          sections.push(current);
          current = { heading: line.replace(/^##\s+/, '').trim(), start: i };
        }
      });
      current.end = lines.length;
      sections.push(current);
      sections.forEach((s) => (s.lineCount = s.end - s.start));
      sections.sort((a, b) => b.lineCount - a.lineCount);

      console.log('');
      console.log(`  ${r.file}:`);
      for (const s of sections.slice(0, 8)) {
        const label = s.heading.length > 75 ? s.heading.slice(0, 72) + '...' : s.heading;
        console.log(`    ${pad(s.lineCount, 5, 'left')} lines  ${label}`);
      }
    }
  }

  console.log('');
  if (overCount > 0) {
    console.log(`⚠ ${overCount} file(s) over threshold. Recommend compression pass — bake as a retro action item.`);
    process.exit(1);
  } else {
    console.log('✓ All files within threshold. No compression needed.');
    process.exit(0);
  }
}

audit();
