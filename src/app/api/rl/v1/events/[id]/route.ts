import { NextResponse } from 'next/server';
import { deleteEvent, patchEvent } from '@/lib/rl/events';
import { HttpError, getCtx, optNum, optStr, readJson, requireCookie, str, withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

export const PATCH = withErrors(async (req, { params }: Params) => {
  requireCookie(req);
  const { db } = await getCtx();
  const body = await readJson(req);
  let song;
  if (body.song !== undefined) {
    const s = body.song;
    if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new HttpError(400, 'bad_song');
    const o = s as Record<string, unknown>;
    song = {
      trackId: optStr(o.trackId, 'trackId', 64),
      song: str(o.song, 'song'),
      artist: typeof o.artist === 'string' ? o.artist.slice(0, 200) : '',
      album: optStr(o.album, 'album'),
      albumArt: optStr(o.albumArt, 'albumArt', 500),
      playlist: optStr(o.playlist, 'playlist'),
      playlistId: optStr(o.playlistId, 'playlistId', 64),
      progressMs: optNum(o.progressMs, 'progressMs'),
    };
  }
  const event = await patchEvent(db, params.id, {
    actor: optStr(body.actor, 'actor', 60),
    target: optStr(body.target, 'target', 60),
    assister: optStr(body.assister, 'assister', 60),
    song,
  });
  return NextResponse.json({ event });
});

export const DELETE = withErrors(async (req, { params }: Params) => {
  requireCookie(req);
  const { db } = await getCtx();
  await deleteEvent(db, params.id);
  return NextResponse.json({ ok: true });
});
