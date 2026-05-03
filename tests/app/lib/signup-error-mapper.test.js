import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapSignupError } from '../../../app/src/lib/signup-error-mapper.js';

test('mapSignupError → first_name HINT in error.message', () => {
  const result = mapSignupError({
    message: 'Database error: first_name is required (HINT: PROFILE_FIRST_NAME_REQUIRED)',
    code: 'unexpected_failure',
  });
  assert.equal(result.field, 'first_name');
  assert.equal(result.messagePt, 'Por favor introduz o teu nome próprio.');
});

test('mapSignupError → last_name HINT in error.message', () => {
  const result = mapSignupError({
    message: 'Database error: last_name is required (HINT: PROFILE_LAST_NAME_REQUIRED)',
    code: 'unexpected_failure',
  });
  assert.equal(result.field, 'last_name');
  assert.equal(result.messagePt, 'Por favor introduz o teu apelido.');
});

test('mapSignupError → company_name HINT in error.message', () => {
  const result = mapSignupError({
    message: 'Database error: company_name is required (HINT: PROFILE_COMPANY_NAME_REQUIRED)',
    code: 'unexpected_failure',
  });
  assert.equal(result.field, 'company_name');
  assert.equal(result.messagePt, 'Por favor introduz o nome da tua empresa.');
});

test('mapSignupError → HINT also matched in error.code field', () => {
  const result = mapSignupError({
    message: 'opaque error text',
    code: 'PROFILE_FIRST_NAME_REQUIRED',
  });
  assert.equal(result.field, 'first_name');
});

test('mapSignupError → User already registered → email field with PT message', () => {
  const result = mapSignupError({
    message: 'User already registered',
    code: 'user_already_exists',
  });
  assert.equal(result.field, 'email');
  assert.equal(result.messagePt, 'Este email já está registado. Tenta iniciar sessão.');
});

test('mapSignupError → "already exists" case-insensitive in message also matches', () => {
  const result = mapSignupError({
    message: 'A user with this email Already Exists',
    code: 'something_else',
  });
  assert.equal(result.field, 'email');
});

test('mapSignupError → unmapped error returns generic catch-all', () => {
  const result = mapSignupError(new Error('boom'));
  assert.equal(result.field, null);
  assert.equal(result.messagePt, 'Não foi possível criar a conta. Tenta novamente em alguns minutos.');
});

test('mapSignupError → null/undefined input returns generic catch-all', () => {
  const r1 = mapSignupError(null);
  const r2 = mapSignupError(undefined);
  assert.equal(r1.field, null);
  assert.equal(r2.field, null);
  assert.equal(r1.messagePt, 'Não foi possível criar a conta. Tenta novamente em alguns minutos.');
  assert.equal(r2.messagePt, 'Não foi possível criar a conta. Tenta novamente em alguns minutos.');
});

test('mapSignupError → never echoes raw upstream message (NFR-S5)', () => {
  const upstream = 'Internal server error: connection refused at 192.168.1.50';
  const result = mapSignupError({ message: upstream, code: 'PGRST500' });
  assert.notEqual(result.messagePt, upstream);
  assert.ok(!result.messagePt.includes('192.168.1.50'));
  assert.ok(!result.messagePt.includes('connection refused'));
});
