import { collections } from '@/lib/rl/db';
import { getCtx, requireKey, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

/** Keyed liveness ping (the helper sends one every 60 s, in or out of a match). */
export const POST = withErrors(async (req) => {
  const { db, now } = await getCtx();
  const key = await requireKey(req, db, now);
  // Bypasses the lastUsedAt throttle so a ping always counts.
  await collections(db).apiKeys.updateOne({ _id: key._id }, { $set: { lastUsedAt: now } });
  return new Response(null, { status: 204 });
});
