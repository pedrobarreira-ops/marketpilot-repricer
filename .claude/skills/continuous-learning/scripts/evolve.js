#!/usr/bin/env node
// .claude/skills/continuous-learning/scripts/evolve.js
//
// Orchestrator for /evolve. Two subcommands:
//
//   prepare        Builds an extraction bundle (prompt + project context +
//                  existing instincts + memory index + new observations)
//                  and writes it to ~/.claude/instincts/projects/<id>/.evolve-bundle.md.
//                  Prints JSON metadata describing the bundle.
//
//   apply <json>   Reads a Haiku subagent's JSON output (one or more
//                  instincts) and writes/updates YAML files in
//                  instincts/personal/. Advances the .evolve-cursor.json
//                  high-water mark.
//
// Adapted from ECC's continuous-learning-v2 design with these deliberate
// reductions (per _phase-2-plan.md and Pedro's "no premature abstraction"
// memory):
//   - No background loop. /evolve is invoked manually until proven useful.
//   - No cross-project promotion. Single-project setup.
//   - No instinct clustering into evolved/ skills. Atomic instincts only.
//   - Cursor file (.evolve-cursor.json) prevents re-analyzing observations.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const HOME = homedir();
const INSTINCTS_ROOT = join(HOME, '.claude', 'instincts');
const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const CL_SKILL_ROOT = resolve(SCRIPT_DIR, '..');

// Min new observations to trigger /evolve. Below this, prepare bails.
const MIN_NEW_OBSERVATIONS = 20;
// Cap on observations sent to Haiku per run (token cost cap).
// Raised from 200 → 1000 on 2026-05-08 (Pedro). At 3-4 stories/day
// the original cap meant ~4% coverage of the unanalyzed window;
// 1000 gives ~20% coverage and stays comfortably inside Haiku 4.5's
// 200K context (slimmed obs ≈ 125 tokens × 1000 ≈ 125K + prompt/context).
const MAX_OBS_PER_BUNDLE = 1000;

// Mirror of detectCurrentProject in instincts.js — same hash strategy.
function detectProject() {
  let root;
  try {
    root = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    root = process.cwd();
  }
  let remote = '';
  try {
    remote = execSync(`git -C "${root}" remote get-url origin`, { encoding: 'utf8' }).trim();
  } catch {
    /* no remote — fall back to path */
  }
  const source = remote || root;
  const normalized = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/:/g, '/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  const id = createHash('sha256').update(normalized).digest('hex').substring(0, 12);
  const name = remote
    ? remote.replace(/\.git$/, '').split('/').pop()
    : root.split(/[\\/]/).pop();
  const dir = join(INSTINCTS_ROOT, 'projects', id);
  return { id, name, root, dir };
}

function loadCursor(dir) {
  const path = join(dir, '.evolve-cursor.json');
  if (!existsSync(path)) return { last_processed_line: 0, last_run_at: null };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { last_processed_line: 0, last_run_at: null };
  }
}

function saveCursor(dir, cursor) {
  writeFileSync(join(dir, '.evolve-cursor.json'), JSON.stringify(cursor, null, 2));
}

function loadObservations(dir, fromLine) {
  const path = join(dir, 'observations.jsonl');
  if (!existsSync(path)) return { newLines: [], totalLines: 0 };
  const all = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  return { newLines: all.slice(fromLine), totalLines: all.length };
}

// Strip the heavy parts of an observation. Pattern detection cares about the
// SHAPE of tool calls, not their full content (file bodies, bash output, etc).
// Without this, the bundle blows past Haiku's 200K context window.
function slimObservation(jsonLine) {
  let obs;
  try {
    obs = JSON.parse(jsonLine);
  } catch {
    return jsonLine;
  }
  const TRUNC = 200;
  const truncate = (s) => {
    if (typeof s !== 'string') return s;
    return s.length > TRUNC ? s.slice(0, TRUNC) + `…[+${s.length - TRUNC}]` : s;
  };
  const slimInput = {};
  if (obs.tool_input && typeof obs.tool_input === 'object') {
    for (const k of Object.keys(obs.tool_input)) {
      const v = obs.tool_input[k];
      if (typeof v === 'string') slimInput[k] = truncate(v);
      else if (typeof v === 'number' || typeof v === 'boolean') slimInput[k] = v;
      else if (Array.isArray(v)) slimInput[k] = `[array len=${v.length}]`;
      else if (v && typeof v === 'object') slimInput[k] = '[object]';
      else slimInput[k] = v;
    }
  }
  const slim = {
    t: obs.timestamp,
    ev: obs.event,
    tool: obs.tool_name,
    in: slimInput,
  };
  // Keep success/error signal from post events without the response body.
  if (obs.event === 'post_tool_use' && obs.tool_response && typeof obs.tool_response === 'object') {
    if (obs.tool_response.error) slim.err = truncate(String(obs.tool_response.error));
    else if (obs.tool_response.success === false) slim.ok = false;
  }
  return JSON.stringify(slim);
}

function loadExistingInstincts(dir) {
  const personalDir = join(dir, 'instincts', 'personal');
  if (!existsSync(personalDir)) return [];
  const out = [];
  for (const f of readdirSync(personalDir)) {
    if (!/\.(yaml|yml)$/.test(f)) continue;
    out.push({ file: f, content: readFileSync(join(personalDir, f), 'utf8') });
  }
  return out;
}

function loadMemoryIndex(projectRoot) {
  // Claude Code's project memory directory uses sanitized cwd: every
  // non-alphanumeric character becomes a dash. Mirror that here.
  const sanitized = projectRoot.replace(/[^a-zA-Z0-9]/g, '-');
  const memoryIndexPath = join(HOME, '.claude', 'projects', sanitized, 'memory', 'MEMORY.md');
  if (!existsSync(memoryIndexPath)) return null;
  return { path: memoryIndexPath, content: readFileSync(memoryIndexPath, 'utf8') };
}

function loadObserverPrompt() {
  // The prompt template lives in the evolve skill, not in continuous-learning.
  // Path: .claude/skills/evolve/references/observer-prompt.md
  const candidate = resolve(CL_SKILL_ROOT, '..', 'evolve', 'references', 'observer-prompt.md');
  if (!existsSync(candidate)) {
    throw new Error(`Observer prompt not found at ${candidate}`);
  }
  return readFileSync(candidate, 'utf8');
}

function buildBundle({ project, observations, instincts, memory, promptTemplate }) {
  // Take the most recent up to MAX_OBS_PER_BUNDLE — older unanalyzed ones
  // are skipped (not counted against future cursor) by design: if the
  // backlog is huge, we want recent patterns first.
  const obsForBundle = observations.newLines.slice(-MAX_OBS_PER_BUNDLE);

  const lines = [];
  lines.push(promptTemplate);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Project Context');
  lines.push('');
  lines.push(`- Project name: ${project.name}`);
  lines.push(`- Project ID: ${project.id}`);
  lines.push(`- Repo root: ${project.root}`);
  lines.push(`- Total observations in log: ${observations.totalLines}`);
  lines.push(`- New observations being analyzed: ${obsForBundle.length}`);
  lines.push(`- Existing instincts in personal/: ${instincts.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Existing Instincts (do not duplicate; UPDATE if pattern recurs)');
  lines.push('');
  if (instincts.length === 0) {
    lines.push('(none yet — first run)');
  } else {
    for (const i of instincts) {
      lines.push('```yaml');
      lines.push(i.content.trim());
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push("## User's Existing Memory Index (patterns ALREADY captured — do not duplicate as instincts)");
  lines.push('');
  if (memory) {
    lines.push(memory.content.trim());
  } else {
    lines.push('(no memory/MEMORY.md found)');
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## New Observations (analyze these for patterns)');
  lines.push('');
  lines.push('Each line is a slimmed observation: `t`=timestamp, `ev`=event (pre/post_tool_use), `tool`=tool name, `in`=tool input (string fields truncated at 200 chars), `err`/`ok`=optional error or success=false signal. Full tool responses are intentionally omitted — pattern detection cares about the shape of tool sequences, not their content.');
  lines.push('');
  lines.push('```jsonl');
  for (const obs of obsForBundle) lines.push(slimObservation(obs));
  lines.push('```');
  lines.push('');
  return { bundle: lines.join('\n'), bundledCount: obsForBundle.length };
}

function commandPrepare() {
  const project = detectProject();
  mkdirSync(project.dir, { recursive: true });

  const cursor = loadCursor(project.dir);
  const observations = loadObservations(project.dir, cursor.last_processed_line);
  const newCount = observations.newLines.length;

  if (newCount < MIN_NEW_OBSERVATIONS) {
    console.log(JSON.stringify({
      ready: false,
      reason: `only ${newCount} new observations since last run; need ${MIN_NEW_OBSERVATIONS}+`,
      total_observations: observations.totalLines,
      new_observations: newCount,
      cursor_at: cursor.last_processed_line,
    }, null, 2));
    process.exit(0);
  }

  const instincts = loadExistingInstincts(project.dir);
  const memory = loadMemoryIndex(project.root);
  const promptTemplate = loadObserverPrompt();

  const { bundle, bundledCount } = buildBundle({
    project, observations, instincts, memory, promptTemplate,
  });
  const bundlePath = join(project.dir, '.evolve-bundle.md');
  writeFileSync(bundlePath, bundle);

  // Stash cursor advance target — apply reads it without needing Haiku to echo.
  const pendingPath = join(project.dir, '.evolve-pending.json');
  writeFileSync(pendingPath, JSON.stringify({
    cursor_advance_to: observations.totalLines,
    started_at: new Date().toISOString(),
    bundled_count: bundledCount,
  }, null, 2));

  console.log(JSON.stringify({
    ready: true,
    bundle_path: bundlePath,
    pending_path: pendingPath,
    project_id: project.id,
    project_name: project.name,
    total_observations: observations.totalLines,
    new_observations: newCount,
    bundled_observations: bundledCount,
    existing_instincts: instincts.length,
    memory_loaded: !!memory,
    memory_path: memory ? memory.path : null,
    bundle_size_bytes: bundle.length,
  }, null, 2));
}

function yamlValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '""';
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderInstinctYaml(instinct, project) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [];
  lines.push('---');
  lines.push(`id: ${yamlValue(instinct.id)}`);
  lines.push(`trigger: ${yamlValue(instinct.trigger)}`);
  lines.push(`action: ${yamlValue(instinct.action_text || instinct.action || '')}`);
  lines.push(`confidence: ${instinct.confidence}`);
  lines.push(`domain: ${yamlValue(instinct.domain)}`);
  lines.push(`sample_count: ${instinct.sample_count}`);
  lines.push(`scope: project`);
  lines.push(`project_id: ${yamlValue(project.id)}`);
  lines.push(`project_name: ${yamlValue(project.name)}`);
  lines.push(`created_at: ${yamlValue(instinct.created_at || now)}`);
  lines.push(`last_observed: ${yamlValue(now)}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${instinct.title || instinct.id}`);
  lines.push('');
  lines.push('## Action');
  lines.push('');
  lines.push(instinct.action_text || instinct.action || '');
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  lines.push(instinct.evidence_summary || `Observed ${instinct.sample_count} times.`);
  if (Array.isArray(instinct.samples) && instinct.samples.length) {
    lines.push('');
    lines.push('Anonymized samples:');
    for (const s of instinct.samples) lines.push(`- ${s}`);
  }
  lines.push('');
  return lines.join('\n');
}

function commandApply(jsonPath) {
  if (!jsonPath || !existsSync(jsonPath)) {
    console.error('Usage: evolve.js apply <json-file-path>');
    if (jsonPath) console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  const project = detectProject();
  const personalDir = join(project.dir, 'instincts', 'personal');
  mkdirSync(personalDir, { recursive: true });

  let payload;
  try {
    payload = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse JSON: ${e.message}`);
    process.exit(1);
  }

  const instincts = Array.isArray(payload.instincts) ? payload.instincts : [];
  let created = 0;
  let updated = 0;
  const writtenFiles = [];
  const skippedReasons = [];

  for (const i of instincts) {
    if (!i.id || !/^[a-z0-9][a-z0-9-]*$/.test(i.id) || i.id.length > 80) {
      skippedReasons.push(`invalid id: ${JSON.stringify(i.id)}`);
      continue;
    }
    if (typeof i.confidence !== 'number' || i.confidence < 0 || i.confidence > 1) {
      skippedReasons.push(`invalid confidence on ${i.id}: ${i.confidence}`);
      continue;
    }
    const filePath = join(personalDir, `${i.id}.yaml`);
    const existed = existsSync(filePath);

    if (existed) {
      // Preserve the original created_at on updates.
      try {
        const prev = readFileSync(filePath, 'utf8');
        const m = prev.match(/^created_at:\s*"?([^"\n]+)"?/m);
        if (m) i.created_at = m[1];
      } catch { /* fall through, will use now */ }
    }

    writeFileSync(filePath, renderInstinctYaml(i, project));
    writtenFiles.push(filePath);
    if (existed) updated++; else created++;
  }

  // Advance cursor from the pending state (written by prepare).
  const pendingPath = join(project.dir, '.evolve-pending.json');
  let cursorAdvancedTo = null;
  if (existsSync(pendingPath)) {
    try {
      const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
      if (typeof pending.cursor_advance_to === 'number') {
        saveCursor(project.dir, {
          last_processed_line: pending.cursor_advance_to,
          last_run_at: new Date().toISOString(),
        });
        cursorAdvancedTo = pending.cursor_advance_to;
      }
    } catch { /* ignore */ }
  }

  console.log(JSON.stringify({
    created,
    updated,
    skipped: (payload.skipped_count || 0) + skippedReasons.length,
    skipped_reasons: skippedReasons,
    written_files: writtenFiles,
    cursor_advanced_to: cursorAdvancedTo,
    project_id: project.id,
    project_name: project.name,
  }, null, 2));
}

const cmd = process.argv[2];
switch (cmd) {
  case 'prepare':
    commandPrepare();
    break;
  case 'apply':
    commandApply(process.argv[3]);
    break;
  default:
    console.error('Usage: evolve.js [prepare | apply <json-file>]');
    process.exit(1);
}
