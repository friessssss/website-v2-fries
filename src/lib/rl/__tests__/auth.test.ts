import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { collections } from '../db';
import { decryptSecret, encryptSecret, randomBase62, safeEqual, sha256Hex } from '../crypto';
import {
  AuthError,
  checkPasscode,
  createApiKey,
  createPairingCode,
  isUnlocked,
  listApiKeys,
  redeemPairingCode,
  revokeApiKey,
  unlockCookieValue,
  verifyApiKey,
} from '../auth';
import { allow, resetRateLimits } from '../ratelimit';
import { useTestDb } from './testdb';

const PASS = 'test-passcode';
const SECRET = 'cookie-secret';

describe('crypto', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips encrypted secrets with a fresh IV each time', () => {
    const a = encryptSecret('refresh-token', key);
    const b = encryptSecret('refresh-token', key);
    expect(a).not.toBe(b);
    expect(a.split('.')).toHaveLength(3);
    expect(decryptSecret(a, key)).toBe('refresh-token');
  });

  it('throws on tampered ciphertext or wrong key', () => {
    const [iv, tag, ct] = encryptSecret('refresh-token', key).split('.');
    const flipped = Buffer.from(ct, 'base64url');
    flipped[0] ^= 1;
    expect(() => decryptSecret(`${iv}.${tag}.${flipped.toString('base64url')}`, key)).toThrow();
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32).toString('base64'))).toThrow();
    expect(() => decryptSecret('garbage', key)).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow();
  });

  it('randomBase62 returns the requested length of base62 chars', () => {
    expect(randomBase62(64)).toMatch(/^[0-9A-Za-z]{64}$/);
    expect(randomBase62(32)).not.toBe(randomBase62(32));
  });

  it('safeEqual handles unequal lengths without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });

  it('sha256Hex is hex of length 64', () => {
    expect(sha256Hex('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('passcode cookie', () => {
  it('checks the passcode', () => {
    expect(checkPasscode(PASS, PASS)).toBe(true);
    expect(checkPasscode('nope', PASS)).toBe(false);
    expect(checkPasscode('', PASS)).toBe(false);
  });

  it('is unlocked for the matching value and locked after the passcode changes', () => {
    const v = unlockCookieValue(PASS, SECRET);
    expect(isUnlocked(v, PASS, SECRET)).toBe(true);
    expect(isUnlocked(v, 'changed', SECRET)).toBe(false);
    expect(isUnlocked(undefined, PASS, SECRET)).toBe(false);
    expect(isUnlocked('', PASS, SECRET)).toBe(false);
    expect(isUnlocked('x', PASS, SECRET)).toBe(false);
  });
});

describe('api keys', () => {
  const getDb = useTestDb();

  it('creates a key, stores only the hash, and verifies it', async () => {
    const db = getDb();
    const { key, doc } = await createApiKey(db, 'Fries PC', 'helper');
    expect(key).toMatch(/^rlk_[0-9A-Za-z]{32}$/);
    expect(doc.prefix).toBe(key.slice(0, 8));
    expect(JSON.stringify(doc)).not.toContain(key);
    const stored = await collections(db).apiKeys.findOne({});
    expect(JSON.stringify(stored)).not.toContain(key);
    expect(stored?.hash).toBe(sha256Hex(key));
    const found = await verifyApiKey(db, key, new Date());
    expect(found?.label).toBe('Fries PC');
  });

  it('returns null for missing, unknown or revoked keys', async () => {
    const db = getDb();
    const { key, doc } = await createApiKey(db, 'k', 'shortcut');
    expect(await verifyApiKey(db, null, new Date())).toBeNull();
    expect(await verifyApiKey(db, 'rlk_nope', new Date())).toBeNull();
    await revokeApiKey(db, String(doc._id));
    expect(await verifyApiKey(db, key, new Date())).toBeNull();
  });

  it('updates lastUsedAt only when older than 60 s', async () => {
    const db = getDb();
    const { key } = await createApiKey(db, 'k', 'helper');
    const t0 = new Date('2026-11-02T12:00:00Z');
    await verifyApiKey(db, key, t0);
    const read = async () => (await collections(db).apiKeys.findOne({}))?.lastUsedAt;
    expect(await read()).toEqual(t0);
    await verifyApiKey(db, key, new Date(t0.getTime() + 30_000));
    expect(await read()).toEqual(t0);
    const t2 = new Date(t0.getTime() + 61_000);
    await verifyApiKey(db, key, t2);
    expect(await read()).toEqual(t2);
  });

  it('lists keys newest first', async () => {
    const db = getDb();
    await createApiKey(db, 'a', 'helper');
    await createApiKey(db, 'b', 'shortcut');
    const list = await listApiKeys(db);
    expect(list.map((k) => k.label)).toEqual(['b', 'a']);
  });
});

describe('pairing codes', () => {
  const getDb = useTestDb();
  const now = new Date('2026-11-02T12:00:00Z');

  it('creates a 6 char code valid for 10 minutes', async () => {
    const { code, expiresAt } = await createPairingCode(getDb(), now);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(expiresAt.getTime()).toBe(now.getTime() + 10 * 60_000);
  });

  it('redeems once (lowercase accepted) and then throws code_expired', async () => {
    const db = getDb();
    const { code } = await createPairingCode(db, now);
    const key = await redeemPairingCode(db, code.toLowerCase(), 'Ash PC', now);
    expect(key).toMatch(/^rlk_[0-9A-Za-z]{32}$/);
    const doc = await verifyApiKey(db, key, now);
    expect(doc?.kind).toBe('helper');
    expect(doc?.label).toBe('Ash PC');
    await expect(redeemPairingCode(db, code, 'again', now)).rejects.toMatchObject({
      code: 'code_expired',
    });
  });

  it('throws code_expired after 10m and for unknown codes', async () => {
    const db = getDb();
    const { code } = await createPairingCode(db, now);
    const late = new Date(now.getTime() + 10 * 60_000 + 1000);
    await expect(redeemPairingCode(db, code, 'x', late)).rejects.toBeInstanceOf(AuthError);
    await expect(redeemPairingCode(db, code, 'x', late)).rejects.toThrow('code_expired');
    await expect(redeemPairingCode(db, 'ZZZZZZ', 'x', now)).rejects.toThrow('code_expired');
  });

  it('only one of two concurrent redemptions succeeds', async () => {
    const db = getDb();
    const { code } = await createPairingCode(db, now);
    const results = await Promise.allSettled([
      redeemPairingCode(db, code, 'a', now),
      redeemPairingCode(db, code, 'b', now),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await collections(db).apiKeys.countDocuments()).toBe(1);
  });
});

describe('rate limit', () => {
  beforeEach(() => resetRateLimits());

  it('blocks call 121 within the window and frees after it', () => {
    for (let i = 0; i < 120; i++) expect(allow('k', 1000 + i)).toBe(true);
    expect(allow('k', 1500)).toBe(false);
    expect(allow('other', 1500)).toBe(true);
    expect(allow('k', 1000 + 60_001)).toBe(true);
  });
});
