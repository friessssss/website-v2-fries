export function normalizeName(s: string): string {
  return s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripPunctuation(s: string): string {
  return s
    .replace(/['’`"“”]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Comparison key for a song title: lowercase, without a trailing " - Remastered 2015"-style
 * suffix, a trailing "(feat. …)" / "(with …)" parenthetical, quotes or punctuation.
 */
export function normalizeSong(s: string): string {
  let t = normalizeName(s);
  t = t.replace(/\s+-\s+.*$/, '');
  t = t.replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]\s*$/, '');
  return stripPunctuation(t);
}

/** Comparison key for the first artist of a credit like "A & B", "A, B", "A feat. B", "A x B". */
export function normalizeFirstArtist(s: string): string {
  const first = normalizeName(s).split(/\s*&\s*|\s*,\s*|\s+(?:feat\.?|ft\.?|featuring)\s+|\s+x\s+/)[0];
  return stripPunctuation(first);
}

/** Song identity for every song breakdown: normalised title + normalised first artist. */
export function songKey(song: string, artist: string | null | undefined): string {
  return `${normalizeSong(song)}|${normalizeFirstArtist(artist ?? '')}`;
}
