// shared/crypto/envelope.js
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * @typedef {object} EncryptedKey
 * @property {Buffer} ciphertext        - encrypted bytes
 * @property {Buffer} nonce             - 12-byte random IV used for AES-256-GCM
 * @property {Buffer} authTag           - 16-byte GCM authentication tag
 * @property {number} masterKeyVersion  - 1 at MVP; bumped by rotation ceremony (AD3)
 */

/**
 * Error thrown when ciphertext, nonce, or authTag fail GCM verification, or when
 * the masterKey does not match the encryption key. Does NOT leak upstream OpenSSL
 * detail (which can hint at error class). Treat all decryption failures as a
 * single opaque condition.
 */
export class KeyVaultDecryptError extends Error {
  /**
   * @param {string} [message] - Opaque message; never includes plaintext, ciphertext, or key bytes.
   */
  constructor (message = 'shop_api_key vault decryption failed') {
    super(message);
    this.name = 'KeyVaultDecryptError';
    this.code = 'KEY_VAULT_DECRYPT_FAILED';
  }
}

const ALGO = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const CURRENT_MASTER_KEY_VERSION = 1;

/**
 * Encrypts a customer's Mirakl shop_api_key under the master key using AES-256-GCM.
 * Generates a fresh CSPRNG nonce per call (nonce reuse with the same key is
 * catastrophic for GCM — never reuse).
 *
 * @param {string} plaintext  - the shop_api_key as a UTF-8 string (non-empty)
 * @param {Buffer} masterKey  - 32-byte Buffer from loadMasterKey()
 * @returns {EncryptedKey}    - ciphertext, nonce, authTag, masterKeyVersion
 * @throws {Error} if plaintext is not a non-empty string or masterKey is not 32 bytes
 */
export function encryptShopApiKey (plaintext, masterKey) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('plaintext must be a non-empty string');
  }
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('masterKey must be a 32-byte Buffer');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, masterKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext,
    nonce,
    authTag,
    masterKeyVersion: CURRENT_MASTER_KEY_VERSION,
  };
}

/**
 * Decrypts a vault row to recover the original shop_api_key string. All failure
 * modes (tampered ciphertext / tampered nonce / tampered auth tag / wrong key /
 * malformed inputs) surface as a single opaque KeyVaultDecryptError so an
 * attacker probing the system gains no oracle bits about which component failed.
 *
 * @param {object} args
 * @param {Buffer} args.ciphertext  - encrypted bytes
 * @param {Buffer} args.nonce       - must be 12 bytes
 * @param {Buffer} args.authTag     - must be 16 bytes
 * @param {Buffer} args.masterKey   - 32-byte Buffer from loadMasterKey()
 * @returns {string}                - the original plaintext shop_api_key (UTF-8)
 * @throws {KeyVaultDecryptError} on any verification failure (tamper / wrong key / malformed)
 */
export function decryptShopApiKey ({ ciphertext, nonce, authTag, masterKey }) {
  if (
    !Buffer.isBuffer(ciphertext) ||
    !Buffer.isBuffer(nonce) || nonce.length !== NONCE_BYTES ||
    !Buffer.isBuffer(authTag) || authTag.length !== AUTH_TAG_BYTES ||
    !Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES
  ) {
    throw new KeyVaultDecryptError();
  }
  try {
    const decipher = createDecipheriv(ALGO, masterKey, nonce);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    // Swallow upstream detail — single opaque error class
    throw new KeyVaultDecryptError();
  }
}
