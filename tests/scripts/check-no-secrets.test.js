// Header: tests/scripts/check-no-secrets.test.js
//
// Tests the AD3 pre-commit secret-scanning script (scripts/check-no-secrets.sh)
// by spawning bash with synthetic diff text on stdin. On Windows, `bash` resolves
// to Git Bash (bundled with Git for Windows). If `bash` is not on PATH, the
// suite skips with a documented reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/check-no-secrets.sh');

function bashAvailable () {
  const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
  return probe.status === 0 && probe.stdout.trim() === 'ok';
}

const BASH_AVAILABLE = bashAvailable();

function runScanner (input) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

test('MASTER_KEY env-style assignment blocks', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = '+MASTER_KEY_BASE64=YWJjZGVmZ2hpamtsbW5vcA==aGlqaw\n';
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1, 'exit code should be 1 (blocked)');
  assert.ok(/MASTER_KEY/.test(stderr), 'stderr should reference MASTER_KEY pattern');
});

test('MASTER_KEY mention in code passes', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+const REQUIRED = ['MASTER_KEY_BASE64'];\n";
  const { code } = await runScanner(input);
  assert.equal(code, 0, 'exit 0 — string-literal usage with no =/: assignment');
});

test('shop_api_key assignment blocks', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+const config = { shop_api_key: 'AbCdEf0123456789' };\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/shop_api_key/.test(stderr));
});

test('Stripe live secret blocks', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+stripe.SECRET = 'sk_live_AbCdEf0123456789ABCDEF';\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/sk_live_/.test(stderr));
});

test('Stripe test secret blocks', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+stripe.SECRET = 'sk_test_AbCdEf0123456789ABCDEF';\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/sk_test_/.test(stderr));
});

test('Authorization Bearer blocks', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature' }\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/Authorization|Bearer/i.test(stderr));
});

test('clean diff passes', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = '+function add (a, b) { return a + b }\n';
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 0, `clean diff should exit 0, got ${code}\nstderr: ${stderr}`);
});

test('idempotency — same input twice yields same outcome', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+stripe.SECRET = 'sk_live_AbCdEf0123456789ABCDEF';\n";
  const first = await runScanner(input);
  const second = await runScanner(input);
  assert.equal(first.code, second.code);
  assert.equal(first.stderr, second.stderr);
  assert.equal(first.stdout, second.stdout);
});

test('only inspects added lines (context lines do not match)', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  // Lines that don't start with '+' are context — should NOT trigger the scanner.
  const input = " const old = 'sk_live_AbCdEf0123456789ABCDEF';\n";
  const { code } = await runScanner(input);
  assert.equal(code, 0, 'context lines (no leading +) should not trigger');
});

test('+++ file headers are skipped', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = '+++ b/some/file.js\n+function clean () {}\n';
  const { code } = await runScanner(input);
  assert.equal(code, 0, '+++ file headers should be filtered out');
});

test('COOKIE_SECRET assignment blocks (Story 1.4)', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+COOKIE_SECRET=YWJjZGVmZ2hpamtsbW5vcGFiY2RlZg==\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/COOKIE_SECRET/.test(stderr));
});

test('COOKIE_SECRET mention in code passes (Story 1.4)', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+const REQUIRED = ['COOKIE_SECRET'];\n";
  const { code } = await runScanner(input);
  assert.equal(code, 0, 'string-literal usage with no =/: substantial-value assignment must pass');
});

test('SUPABASE_ANON_KEY (JWT) assignment blocks (Story 1.4)', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature\n";
  const { code, stderr } = await runScanner(input);
  assert.equal(code, 1);
  assert.ok(/SUPABASE_ANON_KEY/.test(stderr));
});

test('SUPABASE_ANON_KEY mention in code passes (Story 1.4)', { skip: !BASH_AVAILABLE && 'bash not on PATH' }, async () => {
  const input = "+const REQUIRED = ['SUPABASE_ANON_KEY'];\n";
  const { code } = await runScanner(input);
  assert.equal(code, 0, 'string-literal usage must pass — only JWT-shaped assignments block');
});
