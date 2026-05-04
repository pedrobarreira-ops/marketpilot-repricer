#!/usr/bin/env node
// .claude/skills/continuous-learning/scripts/instincts.js
//
// CLI helper for the continuous-learning system. Read-only operations:
//   - status   list project + global instincts with confidence scores
//   - count    show observation count + instinct count per project
//   - projects list all known projects (from registry)
//
// LLM-driven operations (extraction, evolution, promotion) live in the
// /evolve slash command, which spawns a Haiku subagent. This script is
// only the data layer.
//
// Usage:
//   node .claude/skills/continuous-learning/scripts/instincts.js status
//   node .claude/skills/continuous-learning/scripts/instincts.js count
//   node .claude/skills/continuous-learning/scripts/instincts.js projects

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

const HOME = homedir();
const INSTINCTS_ROOT = join(HOME, '.claude', 'instincts');
const REGISTRY = join(INSTINCTS_ROOT, 'projects.json');

function loadRegistry() {
  if (!existsSync(REGISTRY)) return {};
  try {
    return JSON.parse(readFileSync(REGISTRY, 'utf8'));
  } catch {
    return {};
  }
}

function detectCurrentProject() {
  // Replicate detect-project.sh's logic in Node — same normalization +
  // SHA-256 to keep PROJECT_ID identical between bash hook and this CLI.
  // Tested: same inputs produce same 12-char hash.
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
    /* no remote — fall back to hashing path */
  }

  // Normalization MUST match detect-project.sh's sed pipeline + tr lowercase
  const source = remote || root;
  const normalized = source
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^git@/, '')
    .replace(/:/g, '/')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');

  const id = createHash('sha256').update(normalized).digest('hex').substring(0, 12);
  const name = remote ? remote.replace(/\.git$/, '').split('/').pop() : root.split(/[\\/]/).pop();
  const dir = join(INSTINCTS_ROOT, 'projects', id);
  return { id, name, root, dir };
}

function parseInstinct(content) {
  // Parse YAML frontmatter (simple key: value lines between --- markers)
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return fm;
}

function loadInstincts(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.md')) continue;
    const content = readFileSync(join(dir, f), 'utf8');
    const fm = parseInstinct(content);
    if (fm) out.push({ file: f, ...fm });
  }
  return out;
}

function countObservations(file) {
  if (!existsSync(file)) return 0;
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).length;
}

function pad(s, n, side = 'right') {
  s = String(s);
  if (s.length >= n) return s.slice(0, n);
  return side === 'right' ? s.padEnd(n) : s.padStart(n);
}

function statusCommand() {
  const project = detectCurrentProject();
  const registry = loadRegistry();
  const projectDir = join(INSTINCTS_ROOT, 'projects', project.id);
  const projectPersonal = join(projectDir, 'instincts', 'personal');
  const globalPersonal = join(INSTINCTS_ROOT, 'instincts', 'personal');

  const projectInstincts = loadInstincts(projectPersonal);
  const globalInstincts = loadInstincts(globalPersonal);
  const obsCount = countObservations(join(projectDir, 'observations.jsonl'));

  console.log('Continuous-Learning Status');
  console.log('='.repeat(26));
  console.log('');
  console.log(`Current project: ${project.name} (${project.id})`);
  console.log(`Repo:            ${project.root}`);
  console.log(`Observations:    ${obsCount}`);
  console.log('');

  const renderInstincts = (label, list) => {
    console.log(`${label} (${list.length}):`);
    if (list.length === 0) {
      console.log('  (none yet — run /evolve once observations accumulate)');
      return;
    }
    list.sort((a, b) => parseFloat(b.confidence || 0) - parseFloat(a.confidence || 0));
    for (const i of list) {
      const conf = i.confidence ? `[${parseFloat(i.confidence).toFixed(2)}]` : '[?.??]';
      const id = pad(i.id || i.file, 50);
      const dom = pad(i.domain || '-', 20);
      console.log(`  ${conf}  ${id}  ${dom}`);
    }
  };

  renderInstincts('Project-scoped instincts', projectInstincts);
  console.log('');
  renderInstincts('Global instincts', globalInstincts);
  console.log('');

  const totalProjects = Object.keys(registry).length;
  console.log(`Total projects observed: ${totalProjects}`);
}

function countCommand() {
  const project = detectCurrentProject();
  const projectDir = join(INSTINCTS_ROOT, 'projects', project.id);
  const obsCount = countObservations(join(projectDir, 'observations.jsonl'));
  const projectInstinctCount = loadInstincts(join(projectDir, 'instincts', 'personal')).length;
  const globalInstinctCount = loadInstincts(join(INSTINCTS_ROOT, 'instincts', 'personal')).length;
  console.log(`observations: ${obsCount}`);
  console.log(`project_instincts: ${projectInstinctCount}`);
  console.log(`global_instincts: ${globalInstinctCount}`);
  console.log(`ready_for_evolve: ${obsCount >= 20 ? 'yes' : `no (need ${20 - obsCount} more)`}`);
}

function projectsCommand() {
  const registry = loadRegistry();
  const ids = Object.keys(registry);
  if (ids.length === 0) {
    console.log('No projects observed yet.');
    return;
  }
  console.log('Known Projects');
  console.log('='.repeat(14));
  console.log('');
  console.log(pad('Project ID', 14) + pad('Name', 30) + pad('Instincts', 11, 'left') + pad('Observations', 14, 'left'));
  console.log('-'.repeat(70));
  for (const id of ids) {
    const meta = registry[id];
    const projectDir = join(INSTINCTS_ROOT, 'projects', id);
    const obsCount = countObservations(join(projectDir, 'observations.jsonl'));
    const instinctCount = loadInstincts(join(projectDir, 'instincts', 'personal')).length;
    console.log(pad(id, 14) + pad(meta.name || '?', 30) + pad(instinctCount, 11, 'left') + pad(obsCount, 14, 'left'));
  }
}

const cmd = process.argv[2] || 'status';
switch (cmd) {
  case 'status':
    statusCommand();
    break;
  case 'count':
    countCommand();
    break;
  case 'projects':
    projectsCommand();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error('Usage: instincts.js [status|count|projects]');
    process.exit(1);
}
