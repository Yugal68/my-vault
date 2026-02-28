// crypto.js — AES-256-GCM encryption using Web Crypto API
// Key derivation: PBKDF2-SHA256, 600,000 iterations
// Encryption: AES-256-GCM with random IV per save

const Crypto = (() => {
  const PBKDF2_ITERATIONS = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const KEY_BITS = 256;

  function b64encode(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  function b64decode(str) {
    return Uint8Array.from(atob(str), c => c.charCodeAt(0));
  }

  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key  = await deriveKey(password, salt);
    const enc  = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    return {
      salt:       b64encode(salt),
      iv:         b64encode(iv),
      ciphertext: b64encode(ciphertext)
    };
  }

  async function decrypt(payload, password) {
    const salt       = b64decode(payload.salt);
    const iv         = b64decode(payload.iv);
    const ciphertext = b64decode(payload.ciphertext);
    const key        = await deriveKey(password, salt);
    const dec        = new TextDecoder();
    const plainBuf   = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return dec.decode(plainBuf);
  }

  // Returns true if decryption succeeds (used for password verification)
  async function verify(payload, password) {
    try { await decrypt(payload, password); return true; }
    catch { return false; }
  }

  return { encrypt, decrypt, verify };
})();
