/**
 * tests/mocks/mirakl-server.js
 *
 * Epic 3 — Story 3.2 (AC5): Mirakl mock server
 *
 * Replays fixture responses derived from verification-results.json (live Worten
 * captures from 2026-04-30).  Every endpoint not explicitly registered returns
 * a deliberate 404 so tests fail loudly on un-mocked calls.
 *
 * Usage:
 *   const { mockServer, baseUrl } = await createMiraklMockServer();
 *   // ... run tests ...
 *   await mockServer.close();
 *
 * Failure injection (for retry tests):
 *   mockServer.injectError({ path: '/api/account', status: 429, count: 2 });
 *   // Next 2 requests to /api/account return 429; 3rd returns the fixture.
 *
 * Request capture (for param-assertion tests):
 *   mockServer.captureNextRequest('/api/products/offers', (params) => { ... });
 *   // Callback is called once with the parsed query params of the next request.
 */

import Fastify from 'fastify';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Derived from verification-results.json (Easy-Store / Gabriel's Worten account,
// 2026-04-30).  Values are kept minimal — tests assert on structural shape, not
// every field value.

const FIXTURE_A01 = {
  shop_id: 19706,
  shop_name: 'Easy - Store',
  shop_state: 'OPEN',
  currency_iso_code: 'EUR',
  is_professional: true,
  channels: [
    { code: 'WRT_PT_ONLINE', label: 'Worten PT Online' },
    { code: 'WRT_ES_ONLINE', label: 'Worten ES Online' },
  ],
  domains: ['worten.pt', 'worten.es'],
};

const FIXTURE_PC01 = {
  channel_pricing: 'SINGLE',
  operator_csv_delimiter: 'SEMICOLON',
  offer_prices_decimals: 2,
  discount_period_required: false,
  scheduled_pricing: false,
  volume_pricing: false,
  multi_currency: false,
  competitive_pricing_tool: true,
  order_tax_mode: 'TAX_EXCLUSIVE',
};

const FIXTURE_OF21_PAGE1 = {
  total_count: 2,
  offers: [
    {
      shop_sku: 'EZ8809606851663',
      offer_sku: null,
      product_sku: 'mirakl-internal-uuid-001',
      price: 29.99,
      total_price: 31.99,
      min_shipping_price: 2.00,
      quantity: 10,
      active: true,
      channels: [{ code: 'WRT_PT_ONLINE' }],
      product_references: [{ reference_type: 'EAN', reference: '8809606851663' }],
    },
    {
      shop_sku: 'EZ5901234123457',
      offer_sku: null,
      product_sku: 'mirakl-internal-uuid-002',
      price: 49.99,
      total_price: 51.99,
      min_shipping_price: 2.00,
      quantity: 5,
      active: true,
      channels: [{ code: 'WRT_PT_ONLINE' }, { code: 'WRT_ES_ONLINE' }],
      product_references: [{ reference_type: 'EAN', reference: '5901234123457' }],
    },
  ],
};

const FIXTURE_P11_PT = {
  products: [
    {
      product_references: [{ reference_type: 'EAN', reference: '8809606851663' }],
      product_sku: 'mirakl-internal-uuid-001',
      offers: [
        { shop_name: 'Competitor A', active: true,  total_price: 28.50, shop_id: null },
        { shop_name: 'Competitor B', active: true,  total_price: 32.00, shop_id: null },
        { shop_name: 'Easy - Store', active: true,  total_price: 31.99, shop_id: null },
      ],
    },
  ],
};

const FIXTURE_P11_ES = {
  products: [
    {
      product_references: [{ reference_type: 'EAN', reference: '8809606851663' }],
      product_sku: 'mirakl-internal-uuid-001',
      offers: [
        { shop_name: 'Competitor X', active: true,  total_price: 27.00, shop_id: null },
        { shop_name: 'Easy - Store', active: true,  total_price: 30.00, shop_id: null },
      ],
    },
  ],
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create and start the Mirakl mock server on a free port.
 *
 * @returns {Promise<{mockServer: object, baseUrl: string}>}
 */
export async function createMiraklMockServer () {
  const fastify = Fastify({ logger: false });

  // Per-path failure injection counters: { '/api/account': { status: 429, remaining: 2 } }
  const injections = new Map();
  // Per-path one-shot capture callbacks: { '/api/account': fn }
  const captures = new Map();

  /**
   * Middleware: resolve injected errors or fire capture callbacks before route handlers.
   * Returns true if the request was handled (injected error sent), false to continue.
   */
  function handleMiddleware (path, queryParams, reply) {
    const cap = captures.get(path);
    if (cap) {
      captures.delete(path);
      cap(queryParams);
    }

    const inj = injections.get(path);
    if (inj && inj.remaining > 0) {
      inj.remaining--;
      if (inj.remaining === 0) injections.delete(path);
      reply.code(inj.status).send({ message: `injected error ${inj.status}` });
      return true;
    }
    return false;
  }

  // ── A01: GET /api/account ─────────────────────────────────────────────────
  fastify.get('/api/account', (req, reply) => {
    if (handleMiddleware('/api/account', req.query, reply)) return;
    reply.send(FIXTURE_A01);
  });

  // ── PC01: GET /api/platform/configuration (MCP-verified) ─────────────────
  fastify.get('/api/platform/configuration', (req, reply) => {
    if (handleMiddleware('/api/platform/configuration', req.query, reply)) return;
    reply.send(FIXTURE_PC01);
  });

  // ── OF21: GET /api/offers ─────────────────────────────────────────────────
  fastify.get('/api/offers', (req, reply) => {
    if (handleMiddleware('/api/offers', req.query, reply)) return;
    const offset = Number(req.query.offset ?? 0);
    // Single page at offset 0; subsequent pages return empty
    if (offset === 0) {
      reply.send(FIXTURE_OF21_PAGE1);
    } else {
      reply.send({ total_count: FIXTURE_OF21_PAGE1.total_count, offers: [] });
    }
  });

  // ── P11: GET /api/products/offers ─────────────────────────────────────────
  fastify.get('/api/products/offers', (req, reply) => {
    if (handleMiddleware('/api/products/offers', req.query, reply)) return;
    const channel = req.query.pricing_channel_code ?? req.query.channel_codes ?? 'WRT_PT_ONLINE';
    if (channel.includes('WRT_ES_ONLINE')) {
      reply.send(FIXTURE_P11_ES);
    } else {
      reply.send(FIXTURE_P11_PT);
    }
  });

  // ── Fallback: 404 for any un-mocked path ─────────────────────────────────
  fastify.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'Mock server: path not registered — test mis-configured?' });
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const { port } = fastify.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // ── Public API ────────────────────────────────────────────────────────────

  const mockServer = {
    /**
     * Inject N error responses for the given path before returning the fixture.
     * @param {{ path: string, status: number, count: number }} opts
     */
    injectError ({ path, status, count }) {
      injections.set(path, { status, remaining: count });
    },

    /**
     * Register a one-shot callback that receives the query params of the NEXT
     * request to the given path.
     * @param {string} path
     * @param {(params: object) => void} callback
     */
    captureNextRequest (path, callback) {
      captures.set(path, callback);
    },

    /** Stop the Fastify server. */
    async close () {
      await fastify.close();
    },
  };

  return { mockServer, baseUrl };
}
