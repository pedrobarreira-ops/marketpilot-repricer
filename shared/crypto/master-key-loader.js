// shared/crypto/master-key-loader.js
import { Buffer } from 'node:buffer';

/**
 * Error thrown when MASTER_KEY_BASE64 is missing, malformed, or wrong byte-length.
 * The error message NEVER includes the env-var value.
 */
export class MasterKeyLoadError extends Error {
  /**
   * @param {string} message - Diagnostic message; MUST NOT contain the env-var value.
   */
  constructor (message) {
    super(message);
    this.name = 'MasterKeyLoadError';
    this.code = 'MASTER_KEY_INVALID';
  }
}

/**
 * Loads the AES-256-GCM master key from process.env.MASTER_KEY_BASE64.
 * Validates that the decoded buffer is exactly 32 bytes (AES-256 keysize).
 * Holds the key in memory only — never persists, never logs.
 *
 * Call exactly once at process boot (e.g., worker/src/index.js).
 * Pass the returned Buffer as a parameter to encryptShopApiKey / decryptShopApiKey.
 *
 * @returns {Buffer} 32-byte master key
 * @throws {MasterKeyLoadError} if env var missing/empty/malformed/wrong length
 */
export function loadMasterKey () {
  const raw = process.env.MASTER_KEY_BASE64;
  if (!raw || raw.trim().length === 0) {
    throw new MasterKeyLoadError('MASTER_KEY_BASE64 is missing or empty');
  }
  // Buffer.from(str, 'base64') is lenient: it never throws on invalid input,
  // it silently truncates at the first non-base64 character. Validity is
  // therefore established below by re-encoding and comparing modulo padding.
  const decoded = Buffer.from(raw, 'base64');
  const reEncoded = decoded.toString('base64');
  if (reEncoded.replace(/=+$/, '') !== raw.trim().replace(/=+$/, '')) {
    throw new MasterKeyLoadError('MASTER_KEY_BASE64 is not valid base64');
  }
  if (decoded.length !== 32) {
    throw new MasterKeyLoadError(
      `MASTER_KEY_BASE64 must decode to exactly 32 bytes; got ${decoded.length}`
    );
  }
  return decoded;
}
