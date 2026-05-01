import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
const { Pool } = pg;

test('scaffold smoke', async (t) => {
  // stdio inherit pipes child stdout/stderr to the test runner, so a startup crash
  // (port collision, missing env, bad DB URL) shows up as the actual error instead
  // of a misleading 60s "did not return 200" timeout.
  const app = spawn('node', ['app/src/server.js'], {
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const worker = spawn('node', ['worker/src/index.js'], {
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  let appExitCode = null;
  let workerExitCode = null;
  app.on('exit', (code) => { appExitCode = code; });
  worker.on('exit', (code) => { workerExitCode = code; });

  t.after(() => { app.kill('SIGTERM'); worker.kill('SIGTERM'); });

  // Poll /health until 200 (60s timeout)
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    if (appExitCode !== null) assert.fail(`app exited early with code ${appExitCode}`);
    if (workerExitCode !== null) assert.fail(`worker exited early with code ${workerExitCode}`);
    try {
      const res = await fetch('http://localhost:3000/health');
      if (res.ok) healthy = true;
    } catch { /* not ready yet */ }
    if (!healthy) await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(healthy, 'GET /health did not return 200 within 60s');

  // Assert worker_heartbeats row appears within 60s
  const pool = new Pool({ connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL });
  t.after(() => pool.end());
  const rowDeadline = Date.now() + 60_000;
  let hasRow = false;
  while (Date.now() < rowDeadline && !hasRow) {
    if (workerExitCode !== null) assert.fail(`worker exited early with code ${workerExitCode}`);
    const { rows } = await pool.query('SELECT 1 FROM worker_heartbeats LIMIT 1');
    if (rows.length > 0) hasRow = true;
    else await new Promise((r) => setTimeout(r, 1000));
  }
  assert.ok(hasRow, 'No worker_heartbeats row appeared within 60s');
});
