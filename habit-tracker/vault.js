// Password-locked notes: PBKDF2 (SHA-256) derives an AES-GCM key from the
// password. The key only ever lives in memory; storage holds ciphertext.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 600_000;
const CHECK = 'streakfire-vault';

function toB64(bytes) {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function derive(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// `context` is authenticated but not stored, so a note's ciphertext only
// decrypts in the slot (habit + day) it was written for.
export async function encryptText(key, text, context = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(context) },
    key,
    enc.encode(text),
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptText(key, box, context = '') {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(box.iv), additionalData: enc.encode(context) },
    key,
    fromB64(box.ct),
  );
  return dec.decode(pt);
}

export async function create(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt, ITERATIONS);
  const check = await encryptText(key, CHECK, 'check');
  return { key, meta: { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: toB64(salt), check } };
}

// Returns the key, or null when the password is wrong.
export async function unlock(meta, password) {
  try {
    const key = await derive(password, fromB64(meta.salt), meta.iter);
    const text = await decryptText(key, meta.check, 'check');
    return text === CHECK ? key : null;
  } catch {
    return null;
  }
}
