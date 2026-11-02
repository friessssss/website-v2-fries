import { songKey } from './normalize';

export type SongDisplay = { song: string; artist: string; trackId: string | null; albumArt: string | null };

/** One observation of a song: a spelling, how often it was seen, and when (for picking the display). */
export type SongSighting = {
  song: string;
  artist: string | null;
  trackId?: string | null;
  albumArt?: string | null;
  /** The stored key, when the doc has one; otherwise it is computed from song and artist. */
  songKey?: string | null;
  at: Date | number;
  count?: number;
};

/** The group key for a sighting: the stored `songKey`, else `songKey(song, artist)`. */
export const keyOf = (s: { song: string; artist?: string | null; songKey?: string | null }): string =>
  s.songKey ?? songKey(s.song, s.artist);

type Group = {
  /** spelling -> count and earliest sighting */
  spellings: Map<string, { song: string; artist: string; count: number; first: number }>;
  tracked: { at: number; song: string; artist: string; trackId: string; albumArt: string | null } | null;
};

/**
 * Picks how each song group is shown: the spelling, track id and art of its most recent sighting
 * with a trackId; failing that, its most common spelling (ties: the earliest seen).
 */
export class SongDisplays {
  private groups = new Map<string, Group>();

  add(s: SongSighting): string {
    const key = keyOf(s);
    let g = this.groups.get(key);
    if (!g) {
      g = { spellings: new Map(), tracked: null };
      this.groups.set(key, g);
    }
    const at = typeof s.at === 'number' ? s.at : s.at.getTime();
    const artist = s.artist ?? '';
    const sk = `${s.song}\u0000${artist}`;
    const sp = g.spellings.get(sk) ?? { song: s.song, artist, count: 0, first: at };
    sp.count += s.count ?? 1;
    sp.first = Math.min(sp.first, at);
    g.spellings.set(sk, sp);
    if (s.trackId && (!g.tracked || at > g.tracked.at)) {
      g.tracked = { at, song: s.song, artist, trackId: s.trackId, albumArt: s.albumArt ?? null };
    }
    return key;
  }

  get(key: string): SongDisplay {
    const g = this.groups.get(key);
    if (!g) throw new Error(`unknown song group: ${key}`);
    if (g.tracked) {
      const { song, artist, trackId, albumArt } = g.tracked;
      return { song, artist, trackId, albumArt };
    }
    let best: { song: string; artist: string; count: number; first: number } | null = null;
    for (const sp of Array.from(g.spellings.values())) {
      if (!best || sp.count > best.count || (sp.count === best.count && sp.first < best.first)) best = sp;
    }
    return { song: best!.song, artist: best!.artist, trackId: null, albumArt: null };
  }
}
