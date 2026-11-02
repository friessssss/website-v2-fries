import { HttpError } from './request';

const RELEASES_URL = 'https://api.github.com/repos/friessssss/website-v2-fries/releases';
const TTL_MS = 10 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;

type Latest = { version: string; downloadUrl: string };
type Release = {
  tag_name?: string;
  draft?: boolean;
  published_at?: string | null;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

const realFetch: typeof fetch = (...a) => fetch(...a);
let fetchImpl: typeof fetch = realFetch;
type Cached = { at: number; ttl: number; value?: Latest; error?: HttpError };
let cache: Cached | null = null;

export function setFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f ?? realFetch;
  cache = null;
}

export async function latestHelper(nowMs: number): Promise<Latest> {
  if (cache && nowMs >= cache.at && nowMs - cache.at < cache.ttl) {
    if (cache.value) return cache.value;
    throw cache.error!;
  }
  try {
    const value = await fetchLatest();
    cache = { at: nowMs, ttl: TTL_MS, value };
    return value;
  } catch (err) {
    if (err instanceof HttpError) {
      cache = { at: nowMs, ttl: err.status === 404 ? TTL_MS : FAIL_TTL_MS, error: err };
    }
    throw err;
  }
}

async function fetchLatest(): Promise<Latest> {
  let releases: Release[];
  try {
    const res = await fetchImpl(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('github');
    releases = (await res.json()) as Release[];
  } catch {
    throw new HttpError(502, 'upstream_error');
  }
  if (!Array.isArray(releases)) throw new HttpError(502, 'upstream_error');
  const candidates = releases
    .filter((r) => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith('helper-v'))
    .map((r) => ({
      r,
      exe: r.assets?.find((a) => a.name?.toLowerCase().endsWith('.exe') && a.browser_download_url),
    }))
    .filter((c) => c.exe)
    .sort((a, b) => (Date.parse(b.r.published_at ?? '') || 0) - (Date.parse(a.r.published_at ?? '') || 0));
  const best = candidates[0];
  if (!best) throw new HttpError(404, 'no_release');
  return {
    version: best.r.tag_name!.slice('helper-v'.length),
    downloadUrl: best.exe!.browser_download_url!,
  };
}
