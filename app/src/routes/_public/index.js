// Story 1.4 — _public route group Fastify plugin.
//
// Registers the FR7 source-context-capture preHandler hook (encapsulated
// to this plugin only — Fastify auto-scopes hooks to the registering
// instance) and mounts the five public auth surfaces:
//   GET/POST /signup
//   GET/POST /login
//   GET      /verify-email
//   GET/POST /forgot-password
//   GET/POST /reset-password
//
// No URL prefix — these are all top-level paths.

import { sourceContextCapture } from '../../middleware/source-context-capture.js';
import { signupRoutes } from './signup.js';
import { loginRoutes } from './login.js';
import { verifyEmailRoutes } from './verify-email.js';
import { forgotPasswordRoutes } from './forgot-password.js';
import { resetPasswordRoutes } from './reset-password.js';

/**
 * Register the _public route group + source-context-capture hook.
 * Hook scope is auto-encapsulated to this plugin instance per Fastify's
 * plugin model — authenticated/onboarding/dashboard route groups do NOT
 * inherit this hook.
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 * @returns {Promise<void>} resolves once children are registered
 */
export async function publicRoutes (fastify) {
  fastify.addHook('preHandler', sourceContextCapture);

  await fastify.register(signupRoutes);
  await fastify.register(loginRoutes);
  await fastify.register(verifyEmailRoutes);
  await fastify.register(forgotPasswordRoutes);
  await fastify.register(resetPasswordRoutes);
}
