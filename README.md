# MarketPilot Repricer

Automated repricing tool for Mirakl marketplaces. Monitors competitor prices via the Mirakl P11 API and reprices listings (via PRI01) to maintain 1st-place ranking within configurable margin floor/ceiling bands.

## Stack

- **Runtime:** Node.js ≥ 22, ESM (`"type": "module"`)
- **Web framework:** Fastify v5
- **Database:** PostgreSQL via Supabase (direct `pg` Pool)
- **Logging:** pino (structured JSON to stdout)
- **Payment:** Stripe
- **Email:** Resend
- **Templates:** eta (server-rendered, no SPA)

## Project structure

```
app/        — Fastify web server (port 3000)
worker/     — Background worker (heartbeat + repricing engine)
shared/     — Modules imported by both app and worker
db/         — SQL migrations and seed data
tests/      — Integration and unit tests
public/     — Static assets (CSS, JS, images)
scripts/    — Operational scripts
_bmad-output/ — Planning and implementation artifacts (AI context)
```

## Local development

```sh
cp .env.example .env.local
# Fill in required values — see .env.example for all vars

npm install

# Start app server (localhost:3000)
npm run start:app

# Start worker (separate terminal)
npm run start:worker

# Lint
npm run lint

# Integration smoke test (requires .env.local with real Supabase credentials)
node --test tests/integration/scaffold-smoke.test.js
```

## Coolify two-service deployment

Both services deploy from the **same git repository** pushed to `main`. Coolify runs them as two independent container instances from the same image.

### Service 1 — App

| Setting | Value |
|---|---|
| Start command | `node app/src/server.js` |
| Port | `3000` |
| Public URL | `app.marketpilot.pt` |
| Replicas | `1` (F11 — explicit) |

### Service 2 — Worker

| Setting | Value |
|---|---|
| Start command | `node worker/src/index.js` |
| Port | (none — no public URL) |
| Replicas | `1` (F11 — explicit) |

Both services share the same environment variables (Coolify-managed). Inject all vars listed in `.env.example`.

**No pm2, no systemd** — Coolify handles restart-on-crash and deploys.

### UptimeRobot (post-deploy)

Configure monitor for `https://app.marketpilot.pt/health` at 5-minute cadence with email alert.
