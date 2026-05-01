import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { loadMasterKey, MasterKeyLoadError } from '../../../shared/crypto/master-key-loader.js';

function withEnv (value, fn) {
  const original = process.env.MASTER_KEY_BASE64;
  if (value === undefined) delete process.env.MASTER_KEY_BASE64;
  else process.env.MASTER_KEY_BASE64 = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.MASTER_KEY_BASE64;
    else process.env.MASTER_KEY_BASE64 = original;
  }
}

test('loadMasterKey happy path returns 32-byte Buffer', () => {
  withEnv(randomBytes(32).toString('base64'), () => {
    const key = loadMasterKey();
    assert.equal(key.length, 32);
    assert.ok(Buffer.isBuffer(key));
  });
});

test('loadMasterKey rejects missing env (undefined)', () => {
  withEnv(undefined, () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID'
    );
  });
});

test('loadMasterKey rejects empty string', () => {
  withEnv('', () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID'
    );
  });
});

test('loadMasterKey rejects whitespace-only string', () => {
  withEnv('   \t\n   ', () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID'
    );
  });
});

test('loadMasterKey rejects wrong-length key (16 bytes)', () => {
  withEnv(randomBytes(16).toString('base64'), () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID'
    );
  });
});

test('loadMasterKey rejects wrong-length key (64 bytes)', () => {
  withEnv(randomBytes(64).toString('base64'), () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError && err.code === 'MASTER_KEY_INVALID'
    );
  });
});

test('loadMasterKey rejects malformed base64', () => {
  withEnv('not!@#valid$%^base64', () => {
    assert.throws(
      () => loadMasterKey(),
      (err) => err instanceof MasterKeyLoadError
    );
  });
});

test('loadMasterKey error message never includes the env value', () => {
  const sentinelValue = 'SECRET_SENTINEL_VALUE_BASE64==';
  withEnv(sentinelValue, () => {
    try {
      loadMasterKey();
      assert.fail('expected MasterKeyLoadError');
    } catch (err) {
      assert.ok(err instanceof MasterKeyLoadError);
      assert.ok(!err.message.includes(sentinelValue), 'env value leaked into error message');
      assert.ok(!err.stack.includes(sentinelValue), 'env value leaked into stack');
    }
  });
});

test('MasterKeyLoadError carries name and code', () => {
  const err = new MasterKeyLoadError('test');
  assert.equal(err.name, 'MasterKeyLoadError');
  assert.equal(err.code, 'MASTER_KEY_INVALID');
  assert.ok(err instanceof Error);
});
