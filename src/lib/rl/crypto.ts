import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Unbiased random string of n base62 characters (randomInt rejects modulo bias). */
export function randomBase62(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += BASE62[randomInt(BASE62.length)];
  return out;
}

/** Unbiased random string of n characters drawn from `alphabet`. */
export function randomFrom(alphabet: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time string comparison. Unequal lengths return false without throwing. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  // Hashing equalises lengths so timingSafeEqual never throws.
  return timingSafeEqual(ha, hb);
}

function keyBytes(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('RL_TOKEN_KEY must be 32 bytes (base64)');
  return key;
}

/** AES-256-GCM. Output: `iv.tag.cipher`, each base64url. */
export function encryptSecret(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(enc: string, keyB64: string): string {
  const parts = enc.split('.');
  if (parts.length !== 3) throw new Error('Malformed encrypted secret');
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Malformed encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(keyB64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
