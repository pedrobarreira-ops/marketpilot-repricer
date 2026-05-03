// Story 1.4 — Verify-email landing page (post-signup redirect target).
//
// Pass-through route: Supabase Auth dispatches the confirmation email and
// owns the link click. The customer lands here on /signup success and again
// when Supabase Auth redirects them back after confirming.

/**
 * Register GET /verify-email on the Fastify instance.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once route is registered
 */
export async function verifyEmailRoutes (fastify) {
  fastify.get('/verify-email', async (_request, reply) => {
    return reply.view('pages/verify-email.eta', {});
  });
}
