import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  encryptShopApiKey,
  decryptShopApiKey,
  KeyVaultDecryptError,
} from '../../../shared/crypto/envelope.js';

test('round-trip happy path returns original plaintext', () => {
  const masterKey = randomBytes(32);
  const plaintext = 'AbCdEf0123456789-test-shop-api-key';
  const enc = encryptShopApiKey(plaintext, masterKey);
  assert.equal(enc.nonce.length, 12);
  assert.equal(enc.authTag.length, 16);
  assert.equal(enc.masterKeyVersion, 1);
  assert.ok(Buffer.isBuffer(enc.ciphertext));
  assert.ok(Buffer.isBuffer(enc.nonce));
  assert.ok(Buffer.isBuffer(enc.authTag));
  const decrypted = decryptShopApiKey({ ...enc, masterKey });
  assert.equal(decrypted, plaintext);
});

test('tampered ciphertext rejected', () => {
  const masterKey = randomBytes(32);
  const enc = encryptShopApiKey('plaintext-payload', masterKey);
  enc.ciphertext[0] ^= 0xff;
  assert.throws(
    () => decryptShopApiKey({ ...enc, masterKey }),
    (err) => err instanceof KeyVaultDecryptError && err.code === 'KEY_VAULT_DECRYPT_FAILED'
  );
});

test('tampered nonce rejected', () => {
  const masterKey = randomBytes(32);
  const enc = encryptShopApiKey('plaintext-payload', masterKey);
  enc.nonce[0] ^= 0xff;
  assert.throws(
    () => decryptShopApiKey({ ...enc, masterKey }),
    (err) => err instanceof KeyVaultDecryptError && err.code === 'KEY_VAULT_DECRYPT_FAILED'
  );
});

test('tampered auth tag rejected', () => {
  const masterKey = randomBytes(32);
  const enc = encryptShopApiKey('plaintext-payload', masterKey);
  enc.authTag[0] ^= 0xff;
  assert.throws(
    () => decryptShopApiKey({ ...enc, masterKey }),
    (err) => err instanceof KeyVaultDecryptError && err.code === 'KEY_VAULT_DECRYPT_FAILED'
  );
});

test('wrong master key rejected', () => {
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);
  const enc = encryptShopApiKey('plaintext-payload', keyA);
  assert.throws(
    () => decryptShopApiKey({ ...enc, masterKey: keyB }),
    (err) => err instanceof KeyVaultDecryptError && err.code === 'KEY_VAULT_DECRYPT_FAILED'
  );
});

test('nonce uniqueness across two calls on identical plaintext', () => {
  const masterKey = randomBytes(32);
  const a = encryptShopApiKey('same-plaintext', masterKey);
  const b = encryptShopApiKey('same-plaintext', masterKey);
  assert.notDeepEqual(a.nonce, b.nonce, 'CSPRNG nonce reused — catastrophic for GCM');
  assert.notDeepEqual(a.ciphertext, b.ciphertext, 'identical ciphertext suggests static IV');
});

test('error opacity — secrets never leak in message/stack/JSON', () => {
  const masterKey = randomBytes(32);
  const plaintext = 'SECRET_VALUE_THAT_MUST_NOT_LEAK_xyz123';
  const enc = encryptShopApiKey(plaintext, masterKey);
  enc.ciphertext[0] ^= 0xff;
  try {
    decryptShopApiKey({ ...enc, masterKey });
    assert.fail('expected KeyVaultDecryptError');
  } catch (err) {
    assert.ok(err instanceof KeyVaultDecryptError);
    const dump = err.message + '\n' + err.stack + '\n' + JSON.stringify(err);
    assert.ok(!dump.includes(plaintext), 'plaintext leaked in error');
    assert.ok(!dump.includes(enc.ciphertext.toString('hex')), 'ciphertext hex leaked');
    assert.ok(!dump.includes(enc.ciphertext.toString('base64')), 'ciphertext base64 leaked');
    assert.ok(!dump.includes(masterKey.toString('hex')), 'masterKey hex leaked');
    assert.ok(!dump.includes(masterKey.toString('base64')), 'masterKey base64 leaked');
  }
});

test('encryptShopApiKey rejects empty plaintext', () => {
  const masterKey = randomBytes(32);
  assert.throws(() => encryptShopApiKey('', masterKey), /non-empty string/);
});

test('encryptShopApiKey rejects non-string plaintext', () => {
  const masterKey = randomBytes(32);
  assert.throws(() => encryptShopApiKey(123, masterKey), /non-empty string/);
  assert.throws(() => encryptShopApiKey(null, masterKey), /non-empty string/);
  assert.throws(() => encryptShopApiKey(undefined, masterKey), /non-empty string/);
});

test('encryptShopApiKey rejects wrong-size masterKey', () => {
  assert.throws(() => encryptShopApiKey('plaintext', randomBytes(16)), /32-byte Buffer/);
  assert.throws(() => encryptShopApiKey('plaintext', randomBytes(64)), /32-byte Buffer/);
  assert.throws(() => encryptShopApiKey('plaintext', 'not-a-buffer'), /32-byte Buffer/);
});

test('decryptShopApiKey rejects malformed inputs without leaking detail', () => {
  const masterKey = randomBytes(32);
  // Wrong nonce length
  assert.throws(
    () => decryptShopApiKey({
      ciphertext: Buffer.alloc(10),
      nonce: Buffer.alloc(8),
      authTag: Buffer.alloc(16),
      masterKey,
    }),
    (err) => err instanceof KeyVaultDecryptError
  );
  // Wrong auth tag length
  assert.throws(
    () => decryptShopApiKey({
      ciphertext: Buffer.alloc(10),
      nonce: Buffer.alloc(12),
      authTag: Buffer.alloc(8),
      masterKey,
    }),
    (err) => err instanceof KeyVaultDecryptError
  );
  // Wrong masterKey size
  assert.throws(
    () => decryptShopApiKey({
      ciphertext: Buffer.alloc(10),
      nonce: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
      masterKey: Buffer.alloc(16),
    }),
    (err) => err instanceof KeyVaultDecryptError
  );
});

test('KeyVaultDecryptError carries name and code', () => {
  const err = new KeyVaultDecryptError();
  assert.equal(err.name, 'KeyVaultDecryptError');
  assert.equal(err.code, 'KEY_VAULT_DECRYPT_FAILED');
  assert.ok(err instanceof Error);
});
