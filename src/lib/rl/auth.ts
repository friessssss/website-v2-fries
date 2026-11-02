import { ObjectId, type Db } from 'mongodb';
import { collections } from './db';
import { hmac, randomBase62, randomFrom, safeEqual, sha256Hex } from './crypto';
import type { ApiKeyDoc } from './types';

export class AuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_TTL_MS = 10 * 60 * 1000;
const LAST_USED_THROTTLE_MS = 60 * 1000;

export function checkPasscode(input: string, passcode: string): boolean {
  return passcode.length > 0 && safeEqual(input, passcode);
}

export function unlockCookieValue(passcode: string, cookieSecret: string): string {
  return hmac(cookieSecret, 'rl-unlock:' + passcode);
}

export function isUnlocked(
  cookieValue: string | undefined,
  passcode: string,
  cookieSecret: string,
): boolean {
  if (!cookieValue || !passcode) return false;
  return safeEqual(cookieValue, unlockCookieValue(passcode, cookieSecret));
}

export async function createApiKey(
  db: Db,
  label: string,
  kind: 'helper' | 'shortcut',
): Promise<{ key: string; doc: ApiKeyDoc }> {
  const key = 'rlk_' + randomBase62(32);
  const doc: ApiKeyDoc = {
    label,
    kind,
    hash: sha256Hex(key),
    prefix: key.slice(0, 8),
    createdAt: new Date(),
  };
  const { insertedId } = await collections(db).apiKeys.insertOne(doc);
  return { key, doc: { ...doc, _id: insertedId } };
}

export async function verifyApiKey(
  db: Db,
  key: string | null,
  now: Date,
): Promise<ApiKeyDoc | null> {
  if (!key) return null;
  const { apiKeys } = collections(db);
  const doc = await apiKeys.findOne({ hash: sha256Hex(key), revokedAt: { $exists: false } });
  if (!doc) return null;
  const cutoff = new Date(now.getTime() - LAST_USED_THROTTLE_MS);
  if (!doc.lastUsedAt || doc.lastUsedAt < cutoff) {
    await apiKeys.updateOne(
      {
        _id: doc._id,
        $or: [{ lastUsedAt: { $exists: false } }, { lastUsedAt: { $lt: cutoff } }],
      },
      { $set: { lastUsedAt: now } },
    );
    doc.lastUsedAt = now;
  }
  return doc;
}

export async function listApiKeys(db: Db): Promise<ApiKeyDoc[]> {
  return collections(db).apiKeys.find({}).sort({ createdAt: -1, _id: -1 }).toArray();
}

export async function revokeApiKey(db: Db, id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const res = await collections(db).apiKeys.updateOne(
    { _id: new ObjectId(id), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  return res.modifiedCount === 1;
}

export async function createPairingCode(
  db: Db,
  now: Date,
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomFrom(PAIRING_ALPHABET, 6);
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await collections(db).pairingCodes.insertOne({ code, expiresAt });
  return { code, expiresAt };
}

/** Burns the code atomically, then issues a helper key. */
export async function redeemPairingCode(
  db: Db,
  code: string,
  label: string,
  now: Date,
): Promise<string> {
  const claimed = await collections(db).pairingCodes.findOneAndUpdate(
    { code: code.trim().toUpperCase(), usedAt: { $exists: false }, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
  );
  if (!claimed) throw new AuthError('code_expired');
  const { key } = await createApiKey(db, label, 'helper');
  return key;
}
