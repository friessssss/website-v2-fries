# RL Tracker Site (Server, API, UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-only RL Tracker with an authenticated, versioned API that records goals, assists, saves, demos and matches with the current Spotify Jam track, and rebuild the tracker, player, settings and analytics pages in the Scorebug direction on the Zach Robertson design system.

**Architecture:** All behaviour lives in `src/lib/rl/*`. Every function there takes a MongoDB `Db` (and other dependencies, such as a Spotify client and a clock) as parameters, so it can be tested against `mongodb-memory-server` without env vars. The route handlers under `src/app/api/rl/v1` are thin: they parse input, check auth, call the library, and shape JSON. The UI is client components polling the public read endpoints.

**Tech Stack:** Next.js 14.2 (App Router), TypeScript strict, MongoDB driver 6, Tailwind 3, Chart.js 4 / react-chartjs-2, Vitest + mongodb-memory-server (new dev deps), `tsx` for scripts (new dev dep).

**Spec:** `docs/superpowers/specs/2026-11-02-rl-tracker-automation-design.md`. The helper app is a separate plan: `docs/superpowers/plans/2026-11-02-rl-tracker-helper.md`.

## Global Constraints

- Database: `rl-tracker`. Collections: `players`, `events`, `matches`, `spotifyAccounts`, `apiKeys`, `pairingCodes`. The legacy `goals` collection is read only by the migration and never written or deleted.
- New env vars: `RL_GROUP_PASSCODE`, `RL_COOKIE_SECRET`, `RL_TOKEN_KEY` (32 bytes, base64). The passcode value never appears in the repo, tests use `"test-passcode"`.
- API keys: `rlk_` + 32 base62 chars, stored as SHA-256 hex `hash` plus an 8-char display `prefix`. Accepted via `Authorization: Bearer` or `?key=`.
- Cookie `rl_unlock`: httpOnly, secure in production, sameSite `lax`, max-age 90 days.
- Pairing codes: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, valid 10 minutes, single use.
- Session rule: a new session starts when the previous event is more than 3 hours older. Session id `YYYY-MM-DD-HHmm` in `America/Denver`.
- Late rule: if `sentAt - at` is more than 120 000 ms, skip the Spotify lookup and save `songResolved: false`. `occurredAt = receivedAt - (sentAt - at)`.
- Spotify: per-account timeout 2500 ms. `/now-playing` cache 3000 ms. Playlist name cache 1 hour.
- Batch limit 50 events. Rate limit 120 requests a minute per key.
- Win-rate-by-song minimum: 3 matches.
- Design system (field theme): ground `#040705`. Ink `#f5f8f1`, ink-90/70/60/50/40 = white at .9/.7/.6/.5/.4. Lines: white at .2/.1/.08. `glyph` `rgba(62,62,62,0.55)`. `lime` `#c3ff41` (exactly one lime element per screen: the helper status dot). `danger` `#ef4444` (Opponent only, always as a word). Abel 400 (no bold) for text, JetBrains Mono for meta. Radii 4px chips/cards, 8px glass. No emoji anywhere in RL pages.
- Copy: plain, short, says what to do. For example: "Spotify for Ashton needs relinking. Open settings to relink."
- Never log tokens, keys or passcodes. Remove the existing `console.log` noise in any file you touch.
- Commit messages end with the session's attribution lines (see the repo's commit history for the format).

## Review Focus

- **Two helpers report one goal with float jitter** (`gameTime` 182.4 vs 182.40001) → recorded once. `gameTime` is rounded to 1 decimal in the dedupe key. Test in Task 6.
- **In-game names with odd spacing or case** (`"tubbs  McGee "`) → resolve to Jake. Names are normalised by trimming, collapsing internal whitespace and lowercasing. Test in Task 2.
- **Someone presses a manual goal button and the helper reports the same goal seconds later** → one goal, not two. A helper `goal` for the same actor within 30 s after a `manual` goal in the same session replaces it: the manual event is deleted and the helper event is kept. Test in Task 6.
- **Stream Deck "undo" right after a demo** → undoes the last *goal*, not the demo. `DELETE /events/last` defaults to `type=goal`, and `?type=any` undoes the latest event of any type. Test in Task 6.
- **Session spanning midnight or a DST change** → one session, id from the first event's Denver local time. Test in Task 3.

---

## File Structure

```
src/lib/rl/
  types.ts        document + API types shared everywhere
  db.ts           getDb(), ensureIndexes(db)
  normalize.ts    normalizeName()
  players.ts      roster CRUD + resolveActor()
  sessions.ts     sessionIdFor(), resolveSessionId(), currentSessionId()
  crypto.ts       encryptSecret/decryptSecret, hmac, randomBase62
  auth.ts         passcode cookie, API keys, pairing codes
  request.ts      requireWrite(), requireCookie(), requireKey() for route handlers
  ratelimit.ts    in-memory limiter
  spotify.ts      SpotifyClient interface, http client, account tokens, pickNowPlaying()
  events.ts       ingestBatch(), recordManualGoal(), undoLast(), patchEvent(), deleteEvent(), reassign(), listEvents()
  matches.ts      applyMatchStart/Heartbeat/End()
  stats.ts        sessionStats(), playerStats(), listSessions()
  funstats.ts     funStats()
  legacyAnalytics.ts  analytics + timeline payloads over events (same shape as today)
src/lib/rl/__tests__/   *.test.ts + testdb.ts + fixtures.ts
src/app/api/rl/v1/...   route handlers (Task 10, 11)
src/app/api/analytics/route.ts, timeline/route.ts   switched to legacyAnalytics.ts
src/app/RLTracker/page.tsx                (rewritten)
src/app/RLTracker/players/[slug]/page.tsx (new)
src/app/RLTracker/settings/page.tsx       (new)
src/app/analytics/page.tsx, songs/page.tsx (restyled, split)
src/components/rl/*                        UI components
src/components/rl/analytics/*              chart components split from analytics page
scripts/rl-migrate.ts, scripts/rl-dev-seed.ts
vitest.config.ts
```

---

### Task 1: Test harness, types and db module

**Files:**
- Create: `vitest.config.ts`, `src/lib/rl/types.ts`, `src/lib/rl/db.ts`, `src/lib/rl/__tests__/testdb.ts`, `src/lib/rl/__tests__/db.test.ts`
- Modify: `package.json` (devDeps `vitest`, `mongodb-memory-server`, `tsx`; scripts `"test": "vitest run"`, `"rl:migrate": "tsx scripts/rl-migrate.ts"`, `"rl:seed": "tsx scripts/rl-dev-seed.ts"`)

**Interfaces:**
- Produces:
  - `types.ts`: `PlayerDoc`, `EventDoc`, `MatchDoc`, `SpotifyAccountDoc`, `ApiKeyDoc`, `PairingCodeDoc`, matching spec §4 field-for-field.
    - `type EventType = 'goal'|'assist'|'save'|'demo'`
    - `type Actor = string` (a player slug, or `'opponent'` / `'teammate'`)
    - `type Track = { trackId: string|null; song: string; artist: string; album: string|null; albumArt: string|null; progressMs: number|null; playlist: string|null; playlistId: string|null }`
    - `type Clock = () => Date`
  - `db.ts`: `getDb(): Promise<Db>` (uses `@/lib/mongodb`, db `rl-tracker`). `ensureIndexes(db: Db): Promise<void>` creates every index in spec §4, plus a TTL index on `pairingCodes.expiresAt` (`expireAfterSeconds: 0`) and a unique `players.slug` index. `collections(db)` returns typed `Collection<…>` handles `{ players, events, matches, spotifyAccounts, apiKeys, pairingCodes, legacyGoals }`.
  - `testdb.ts`: `useTestDb(): () => Db`. It's a Vitest helper: it starts one `MongoMemoryServer` per file in `beforeAll`, drops the database in `beforeEach`, calls `ensureIndexes`, and returns a getter.

- [ ] **Step 1: Install dev deps and add scripts.** `npm i -D vitest@2 mongodb-memory-server@10 tsx@4`. `vitest.config.ts`: node environment, alias `@` → `./src`, `testTimeout: 30000`.
- [ ] **Step 2: Write the failing test** `db.test.ts`:
```ts
it('creates the unique dedupe index', async () => {
  const idx = await collections(db()).events.indexes();
  expect(idx.find(i => i.key.dedupeKey === 1)).toMatchObject({ unique: true, sparse: true });
});
it('rejects duplicate player slugs', async () => {
  const { players } = collections(db());
  await players.insertOne({ slug: 'zach', displayName: 'Zach', aliases: ['Fries'], active: true, createdAt: new Date() } as any);
  await expect(players.insertOne({ slug: 'zach', displayName: 'Z', aliases: [], active: true, createdAt: new Date() } as any)).rejects.toThrow(/duplicate key/);
});
```
- [ ] **Step 3: Run** `npx vitest run src/lib/rl/__tests__/db.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `types.ts`, `db.ts`, `testdb.ts`. `db.ts` must import `@/lib/mongodb` lazily inside `getDb()`, because that module throws at import time without `MONGODB_URI`.
- [ ] **Step 5: Run again.** Expected: PASS. Also `npx tsc --noEmit` is clean.
- [ ] **Step 6: Commit** `feat(rl): add test harness, shared types and db module`.

---

### Task 2: Roster and name resolution

**Files:** Create `src/lib/rl/normalize.ts`, `src/lib/rl/players.ts`, `src/lib/rl/__tests__/players.test.ts`, `src/lib/rl/__tests__/fixtures.ts`

**Interfaces:**
- Consumes: `collections`, `PlayerDoc` (Task 1).
- Produces:
  - `normalizeName(s: string): string`
  - `SEED_PLAYERS: Array<Pick<PlayerDoc,'slug'|'displayName'|'aliases'>>`, containing exactly the spec roster: vandy/Vandy/[v9ndy], ashton/Ashton/[Ash], sam/Sam/[Samdree], mason/Mason/[ImFanzo], jake/Jake/[Tubbs McGee], zach/Zach/[Fries].
  - `listPlayers(db): Promise<PlayerDoc[]>` (active only, sorted by displayName)
  - `replacePlayers(db, players: Array<{slug, displayName, aliases}>): Promise<void>`. It upserts by slug and marks missing ones `active:false`. Throws `RosterError('duplicate_alias')` if two players share a normalised alias.
  - `addAlias(db, slug, alias): Promise<void>`
  - `seedPlayers(db): Promise<void>` (insert-if-missing)
  - `resolveActor(roster: PlayerDoc[], inGame: {name: string; team?: number}, ourTeam: number|undefined): Actor`. Matches roster aliases *and* display names by normalised name. Otherwise returns `'teammate'` when `team === ourTeam`, else `'opponent'`.
  - `fixtures.ts`: `ROSTER: PlayerDoc[]` built from `SEED_PLAYERS`.

- [ ] **Step 1: Write failing tests:**
```ts
expect(resolveActor(ROSTER, { name: 'tubbs  McGee ', team: 0 }, 0)).toBe('jake');
expect(resolveActor(ROSTER, { name: 'FRIES', team: 1 }, 0)).toBe('zach');   // roster wins regardless of team
expect(resolveActor(ROSTER, { name: 'xXRando', team: 0 }, 0)).toBe('teammate');
expect(resolveActor(ROSTER, { name: 'xXRando', team: 1 }, 0)).toBe('opponent');
expect(resolveActor(ROSTER, { name: 'xXRando' }, undefined)).toBe('opponent');
// replacePlayers
await expect(replacePlayers(db(), [{slug:'a',displayName:'A',aliases:['Ash']},{slug:'b',displayName:'B',aliases:['ash ']}])).rejects.toThrow('duplicate_alias');
await seedPlayers(db()); await seedPlayers(db());
expect(await listPlayers(db())).toHaveLength(6);
```
- [ ] **Step 2: Run** `npx vitest run players`. Expected: FAIL.
- [ ] **Step 3: Implement.** `normalizeName`: `s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): roster with alias-based actor resolution`.

---

### Task 3: Sessions

**Files:** Create `src/lib/rl/sessions.ts`, `src/lib/rl/__tests__/sessions.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_GAP_MS = 3*60*60*1000`
  - `sessionIdFor(firstEventAt: Date): string`. Formats `YYYY-MM-DD-HHmm` in `America/Denver` via `Intl.DateTimeFormat` parts.
  - `resolveSessionId(db, occurredAt: Date): Promise<string>`. Takes the latest event with `occurredAt <= occurredAt`. If it exists and the gap is ≤ `SESSION_GAP_MS`, returns its `sessionId`, otherwise `sessionIdFor(occurredAt)`.
  - `currentSessionId(db, now: Date): Promise<string|null>`. The latest event's sessionId if its `occurredAt` is within `SESSION_GAP_MS` of `now`, else `null`.

- [ ] **Step 1: Failing tests:**
```ts
expect(sessionIdFor(new Date('2026-11-02T04:42:00Z'))).toBe('2026-11-01-2142'); // MST
expect(sessionIdFor(new Date('2026-07-04T03:00:00Z'))).toBe('2026-07-03-2100'); // MDT
// spans midnight: events at 23:30 and 00:40 Denver are one session
// DST: events at 2026-11-01T07:30Z and 2026-11-01T09:10Z (fall-back night) → same session id
// gap of 3h01m → new session; currentSessionId null after 3h01m idle
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): automatic 3-hour sessions`.

---

### Task 4: Crypto, passcode cookie, API keys and pairing codes

**Files:** Create `src/lib/rl/crypto.ts`, `src/lib/rl/auth.ts`, `src/lib/rl/ratelimit.ts`, `src/lib/rl/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `crypto.ts`:
    - `randomBase62(n: number): string`
    - `sha256Hex(s): string`
    - `encryptSecret(plain: string, keyB64: string): string` (AES-256-GCM, output `iv.tag.cipher` base64url)
    - `decryptSecret(enc, keyB64): string`
    - `hmac(secret, data): string`
    - `safeEqual(a, b): boolean`
  - `auth.ts`:
    - `checkPasscode(input: string, passcode: string): boolean`
    - `unlockCookieValue(passcode: string, cookieSecret: string): string` (= `hmac(cookieSecret, 'rl-unlock:' + passcode)`)
    - `isUnlocked(cookieValue: string|undefined, passcode, cookieSecret): boolean`
    - `createApiKey(db, label: string, kind: 'helper'|'shortcut'): Promise<{ key: string; doc: ApiKeyDoc }>`
    - `verifyApiKey(db, key: string|null, now: Date): Promise<ApiKeyDoc|null>`. Ignores revoked keys, and updates `lastUsedAt` only if it's older than 60 s.
    - `listApiKeys(db)`, `revokeApiKey(db, id)`
    - `createPairingCode(db, now): Promise<{code: string; expiresAt: Date}>`
    - `redeemPairingCode(db, code, label, now): Promise<string>` returns a new helper key. It throws `AuthError('code_expired')` for an unknown, expired or used code, and accepts lowercase input.
  - `ratelimit.ts`: `allow(id: string, now: number, limit = 120, windowMs = 60000): boolean`

- [ ] **Step 1: Failing tests:** encrypt/decrypt round trip, and a tampered ciphertext throws. Also:
  - `isUnlocked` is true for the matching value and false after the passcode changes.
  - A created key matches `/^rlk_[0-9A-Za-z]{32}$/`, and `verifyApiKey` returns the doc. After `revokeApiKey` it returns null.
  - Only the hash is stored (`expect(JSON.stringify(doc)).not.toContain(key)`).
  - A pairing code matches `/^[A-HJ-NP-Z2-9]{6}$/`. Redeeming it twice throws `code_expired`. Redeeming at `now + 10m + 1s` throws `code_expired`.
  - `allow` returns false on call 121 within the window.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): passcode cookie, hashed API keys, pairing codes`.

---

### Task 5: Spotify client and now-playing picker

**Files:** Create `src/lib/rl/spotify.ts`, `src/lib/rl/__tests__/spotify.test.ts`

**Interfaces:**
- Consumes: `encryptSecret/decryptSecret` (Task 4), `collections` (Task 1).
- Produces:
  - `interface SpotifyClient { refresh(refreshToken: string): Promise<{accessToken: string; expiresIn: number; refreshToken?: string}>; currentlyPlaying(accessToken: string): Promise<RawPlaying|null>; playlistName(accessToken: string, id: string): Promise<string|null>; exchangeCode(code: string, redirectUri: string): Promise<{accessToken; refreshToken; expiresIn}>; me(accessToken): Promise<{id: string; displayName: string}> }`
  - `class SpotifyAuthError extends Error`, thrown by `refresh` on 400 `invalid_grant` or 401.
  - `RawPlaying = { isPlaying: boolean; trackId: string|null; song: string; artist: string; album: string|null; albumArt: string|null; progressMs: number|null; contextPlaylistId: string|null }`
  - `httpSpotifyClient(clientId, clientSecret, fetchImpl = fetch): SpotifyClient`. Ports the request logic from the existing `src/app/api/spotify/current-track/route.ts` (204 → null, playlist id from the `context.uri` `spotify:playlist:<id>`). Uses a 2500 ms `AbortSignal.timeout`.
  - `linkAccount(db, client, {playerSlug, code, redirectUri, tokenKey}): Promise<SpotifyAccountDoc>` (upsert by `spotifyUserId`)
  - `listAccounts(db)`, `unlinkAccount(db, id)`
  - `pickNowPlaying(db, client, tokenKey, now: Date): Promise<{ track: Track; hostSlug: string } | null>`, following spec §5:
    - Asks every `status:'ok'` account, refreshing when `accessTokenExpiresAt <= now + 30s`.
    - Keeps `isPlaying` only.
    - Picks the majority `trackId`; on a tie, the most recent `lastSeenPlayingAt`.
    - Sets `lastSeenPlayingAt` on the chosen account.
    - A `SpotifyAuthError` sets that account's `status:'needs_relink'`.
    - Any other error skips that account.
  - `cachedNowPlaying(...)`: the same signature, memoised for 3000 ms in module scope. Playlist names are memoised for 1 h.

- [ ] **Step 1: Failing tests** with a fake `SpotifyClient` and three linked accounts:
  - Two accounts playing track A and one playing B → A, with `hostSlug` of the A account most recently seen.
  - A paused account is ignored.
  - None playing → `null`.
  - Refresh throws `SpotifyAuthError` → that account becomes `needs_relink` and the others still answer.
  - `refreshTokenEnc` in the database never equals the plain refresh token.
  - An expired access token triggers exactly one `refresh` call.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): server-side Spotify tokens and multi-account now-playing`.

---

### Task 6: Event recording

**Files:** Create `src/lib/rl/events.ts`, `src/lib/rl/__tests__/events.test.ts`

**Interfaces:**
- Consumes: `resolveActor`, `listPlayers`, `addAlias` (T2); `resolveSessionId`, `currentSessionId` (T3); `Track`, `Clock` (T1).
- Produces:
  - `type NowPlaying = () => Promise<{track: Track; hostSlug: string} | null>`. Routes pass `() => cachedNowPlaying(...)`.
  - `type HelperEvent`: the discriminated union of the spec §7 body kinds. `type IngestResult = {status: 'recorded'|'duplicate'|'ignored'; id?: string; song?: string|null; actorDisplay?: string}`. `song` and `actorDisplay` are set on recorded stat events; the helper uses them for its toast.
  - `dedupeKey(e: {matchGuid; type; gameTime; actorInGame; targetInGame?}): string`. Formatted as `${matchGuid}:${type}:${gameTime.toFixed(1)}:${normalizeName(actor)}:${normalizeName(target ?? '')}`.
  - `ingestBatch(db, deps: {nowPlaying: NowPlaying; clock: Clock}, body: {sentAt: string; events: HelperEvent[]}, reportedBy: ObjectId): Promise<IngestResult[]>`
    - Throws `IngestError('too_many')` for more than 50 events.
    - Throws `IngestError('bad_event', index)` on a schema miss (write a small hand-rolled validator, no new deps).
    - Delegates `match_start`/`heartbeat`/`match_end` to Task 7 functions (import from `matches.ts`). Until Task 7 lands, they return `ignored`.
    - For stat kinds:
      - Reads `ourTeam` from the match doc (creating it lazily).
      - Resolves the actor, target and assister.
      - Applies the late rule. Calls `nowPlaying` at most once per batch, and only if a non-late stat event exists.
      - Inserts. A duplicate-key error becomes `duplicate`.
    - After inserting a helper `goal`, deletes any `source:'manual'` goal with the same actor and sessionId whose `occurredAt` is within the 30 s before it.
  - `recordManualGoal(db, deps, actor: Actor): Promise<EventDoc>`. Throws `IngestError('unknown_player')` if the actor is not an active slug, `'opponent'` or `'teammate'`.
  - `undoLast(db, type: EventType|'any' = 'goal', now): Promise<EventDoc|null>`. Works within `currentSessionId` only.
  - `patchEvent(db, id, patch: {actor?; target?; assister?; song?: {trackId?: string; song: string; artist: string}}): Promise<EventDoc>` (a song patch sets `songResolved:true`)
  - `deleteEvent(db, id)`
  - `reassign(db, inGameName, slug): Promise<{updated: number}>`. Calls `addAlias`, then repoints `actor`/`target`/`assister` wherever the matching `*InGame` field normalises to `inGameName`.
  - `listEvents(db, q: {session: 'current'|'all'|string; type?; player?; limit?: number (default 50, max 200); before?: string}): Promise<EventDoc[]>`
  - `recentUnknownNames(db, sinceDays = 14): Promise<Array<{name: string; count: number}>>`

- [ ] **Step 1: Failing tests:**
  - Same goal sent twice with `gameTime` 182.4 and 182.40001 → `['recorded']` then `['duplicate']`.
  - Goal from `Ash` on team 0 with `match_start` players → actor `ashton`, song from the fake `nowPlaying`, `songResolved: true`.
  - `sentAt - at = 121000` → `songResolved:false`, `nowPlaying` not called, and `occurredAt` equals `receivedAt - 121000`.
  - Batch of 51 → throws `too_many`.
  - Manual goal for `sam` at T, helper goal for `Samdree` at T+12 s → one goal remains, `source:'helper'`.
  - A manual goal at T and a helper goal at T+31 s → both remain.
  - After a goal then a demo, `undoLast(db)` removes the goal and `undoLast(db,'any')` removes the demo.
  - `nowPlaying` returns null → event saved with `song:null`.
  - `reassign('xXRando','mason')` updates past opponent events and adds the alias.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): event ingest with dedupe, late rule and manual-goal merge`.

---

### Task 7: Matches

**Files:** Create `src/lib/rl/matches.ts`, `src/lib/rl/__tests__/matches.test.ts`. Modify `src/lib/rl/events.ts` (wire up the three kinds).

**Interfaces:**
- Produces:
  - `ensureMatch(db, guid, sessionId, at: Date): Promise<MatchDoc>` (upsert)
  - `applyMatchStart(db, roster, e: {matchGuid; at: Date; players: {name; team}[]}, sessionId): Promise<IngestResult>`. Sets `ourTeam` to the team with the most roster members, keeping the first team on a tie. Never overwrites an existing `ourTeam`.
  - `applyHeartbeat(db, nowPlaying, e): Promise<IngestResult>`. `$addToSet`-style push of `{trackId, song, artist, firstSeenAt}`, unique by `trackId`. Returns `ignored` when nothing is playing.
  - `applyMatchEnd(db, nowPlaying, e: {matchGuid; at; score: Record<'0'|'1', number>}): Promise<IngestResult>`. Sets the scores relative to `ourTeam` and the `result`. On a win, sets `victorySong` and also adds that track to `songs`. Leaves `result` unset if `ourTeam` is unknown.
  - `listMatches(db, session)`

- [ ] **Step 1: Failing tests:**
  - A match_start with Fries+Ash on team 1 → `ourTeam: 1`.
  - Heartbeats with A, A, B → `songs` holds A and B.
  - match_end `{0: 2, 1: 3}` → `ourScore 3, theirScore 2, result 'win'`, with `victorySong` the current track.
  - A loss has no `victorySong`.
  - A match_end before any start creates the match and leaves `result` undefined.
  - A repeated match_end is idempotent.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement and wire into `ingestBatch`.**
- [ ] **Step 4: Run all tests** (`npm test`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): match lifecycle, songs heard and victory song`.

---

### Task 8: Session and player stats

**Files:** Create `src/lib/rl/stats.ts`, `src/lib/rl/__tests__/stats.test.ts`. Extend `fixtures.ts` with `seedNight(db)`: one session, 2 matches (1 win, 1 loss) and about 20 mixed events with known counts.

**Interfaces:**
- Produces:
  - `type Scope = {session: 'current'|'all'|string}`
  - `sessionStats(db, scope, now): Promise<{ sessionId: string|null; goalsFor: number; goalsAgainst: number; leaderboard: Array<{actor: Actor; displayName: string; inGame: string[]; goals: number}>; songs: Array<{trackId; song; artist; byActor: Record<Actor, number>; goalsFor: number; goalsAgainst: number}>; topSong: {song; artist; goals: number}|null }>`
    - `goalsFor` counts roster and teammate goals.
    - The leaderboard lists every active roster player, including those on 0, then a `teammate` row only if it's above 0, then `opponent`.
  - `playerStats(db, slug, now): Promise<{ player: PlayerDoc; session: Counts; allTime: Counts; topSongs: Record<EventType, Array<{song; artist; count}>>; demoRecord: {victims: Array<{actor; count}>; demotedBy: Array<{actor; count}>}; favAssister: {actor; count}|null; favScorerAssisted: {actor; count}|null; recent: EventDoc[] }>`, where `Counts = Record<EventType, number>`
    - Assist counts come from `assist` events only. The favourite pairs come from `goal.assister`.
  - `listSessions(db, limit = 30): Promise<Array<{id; startedAt; endedAt; goalsFor; goalsAgainst}>>`
  - `playerStats` throws `NotFound` for an unknown slug.

- [ ] **Step 1: Failing tests** against `seedNight`, asserting exact counts from the fixture: scorebug totals, leaderboard order and zero rows, per-song byActor, topSong, a player's demo victims and assist pairs, and listSessions ordering.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with aggregation pipelines (`$match` → `$group`). Map actor slugs to display names from `listPlayers`. Use "Opponent" and "Teammate" for the special actors.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): session leaderboard, songs and player stats`.

---

### Task 9: Fun stats and legacy analytics over events

**Files:** Create `src/lib/rl/funstats.ts`, `src/lib/rl/legacyAnalytics.ts`, `src/lib/rl/__tests__/funstats.test.ts`, `src/lib/rl/__tests__/legacyAnalytics.test.ts`. Modify `src/app/api/analytics/route.ts` and `src/app/api/analytics/timeline/route.ts` so each calls the library and keeps its current query params and response shape.

**Interfaces:**
- Produces:
  - `funStats(db, scope, now): Promise<FunStats>`, where `FunStats = { demoLeaderboard: Array<{actor; displayName; count}>; demoGrid: { actors: Actor[]; counts: number[][] /* [attacker][victim] */ }; demoAnthem: {song; artist; count}|null; brickWall: {actor; displayName; saves; matchGuid; date}|null; playmaker: {top: {actor; displayName; count}|null; pair: {assister; scorer; count}|null}; victorySong: {song; artist; wins}|null; winRateBySong: Array<{song; artist; wins; matches; rate}> /* matches >= 3, rate desc then matches desc */; nightOfTheNight: Array<{actor; displayName; sessionId; total}> }`
  - `analyticsPayload(db, {timeFilter, playlistFilter}): Promise<…>` and `timelinePayload(db, {timeFilter, playlistFilter, groupBy}): Promise<…>`. These return exactly the JSON the current routes return, so the existing page keeps working until Task 15. They read `events` with `type:'goal'` and map `actor` to the display name (`'opponent'` → `"Opponent"`).

- [ ] **Step 1: Failing tests:**
  - On `seedNight` plus extra matches: the demoGrid cell [zach][opponent] equals the fixture count.
  - `winRateBySong` excludes a song seen in only 2 matches.
  - brickWall picks the single-match maximum, not the session total.
  - The playmaker pair is correct.
  - legacyAnalytics: for a fixture written in both legacy `goals` shape and `events` shape, `analyticsPayload` matches a snapshot of the old route's output. Capture it by running the old route's logic on the legacy fixture before deleting that logic.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, then switch the two analytics routes over.
- [ ] **Step 4: Run** `npm test && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): fun stats; analytics routes read events`.

---

### Task 10: v1 API routes

**Files:**
- Create: `src/lib/rl/request.ts`, and route files under `src/app/api/rl/v1/`:
  - `unlock`, `lock`, `events`, `events/last`, `events/[id]`, `events/reassign`
  - `goals`, `now-playing`, `sessions`, `stats`, `stats/fun`, `matches`
  - `players`, `pairing-codes`, `pair`, `keys`, `keys/[id]`, `helper/latest`
- Test: `src/lib/rl/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces:
  - `request.ts`: `type Ctx = {db: Db; now: Date}`
    - `getCtx(): Promise<Ctx>`
    - `requireWrite(req: NextRequest, db): Promise<{via: 'cookie'} | {via: 'key'; key: ApiKeyDoc}>` checks the cookie, then the Bearer header, then `?key=`. It throws `HttpError(401, 'locked')` with no credentials, or `HttpError(401, 'invalid_key')` for a bad key, and applies `allow(key._id)` → `HttpError(429, 'rate_limited')`.
    - `requireCookie(req)`
    - `withErrors(handler)` maps `HttpError`/`IngestError`/`AuthError`/`NotFound`/`RosterError` to `{error}` JSON with 400/401/404/409/429 codes. Mongo connection failures map to `503 {error:'unavailable'}`. Anything else is `500 {error:'server_error'}` with no message leakage.
  - Every route sets `export const dynamic = 'force-dynamic'`. Methods, auth and bodies follow spec §7 exactly.
  - `POST /pair` and `POST /unlock` are rate limited by IP via `allow('ip:'+ip, now, 10)`.
  - `/helper/latest` fetches `https://api.github.com/repos/friessssss/website-v2-fries/releases`, picks the newest release whose tag starts with `helper-v` and has an `.exe` asset, and caches the result for 10 min. It returns `{version, downloadUrl}`, or `404 {error:'no_release'}`.

- [ ] **Step 1: Failing route tests.** Call the exported handlers directly with `new NextRequest(...)`, using `vi.mock('@/lib/rl/request', …)` to inject the test db and a fixed clock:
  - Every write route returns 401 `locked` with no credentials.
  - `POST /goals` succeeds with a cookie and succeeds with `?key=`.
  - A revoked key → 401 `invalid_key`.
  - `POST /pair` with a valid code returns `apiKey` matching `/^rlk_/`. A reuse returns 400 `code_expired`.
  - `POST /events` with 51 events → 400 `too_many`.
  - `GET /stats?session=current` with no events → 200 with `sessionId: null`.
  - `DELETE /events/last` with a key removes the last goal.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `request.ts` and the routes.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS, and the build lists the new routes.
- [ ] **Step 5: Commit** `feat(rl): v1 API routes with passcode and key auth`.

---

### Task 11: Spotify link routes

**Files:** Create `src/app/api/rl/v1/spotify/connect/route.ts`, `src/app/api/rl/v1/spotify/callback/route.ts`, `src/app/api/rl/v1/spotify/[id]/route.ts`, `src/app/api/rl/v1/spotify/route.ts` (GET list: `{id, playerSlug, displayName, status, lastSeenPlayingAt}`, never tokens). Test: extend `routes.test.ts`.

**Interfaces:**
- Consumes: `linkAccount`, `listAccounts`, `unlinkAccount`, `httpSpotifyClient` (T5); `hmac` (T4).
- Produces:
  - `redirectUri()` = `${origin}/api/rl/v1/spotify/callback`, with origin from the request URL. **Action for Zach:** register both `https://zachrobertson.co/api/rl/v1/spotify/callback` and `http://localhost:3000/api/rl/v1/spotify/callback` in the Spotify developer dashboard.
  - The scopes match the current page's list.
  - `state` = base64url(`{player, nonce, exp}`) + `.` + hmac. The callback rejects a bad or expired state (10 min) with a redirect to `/RLTracker/settings?spotify=error`. On success it redirects to `?spotify=linked`.

- [ ] **Step 1: Failing tests:** connect without a cookie → 401. Connect with a cookie → 302 to `accounts.spotify.com/authorize`, with a `state` that verifies. A callback with a tampered state redirects with `spotify=error`. A callback with a valid state and a fake client creates one account.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Allow injecting the Spotify client through a module-level `setSpotifyClientForTests`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): per-friend Spotify linking`.

---

### Task 12: Migration and dev seed scripts

**Files:** Create `scripts/rl-migrate.ts`, `scripts/rl-dev-seed.ts`, `src/lib/rl/migrate.ts`, `src/lib/rl/__tests__/migrate.test.ts`

**Interfaces:**
- Produces:
  - `migrateLegacy(db): Promise<{copied: number; skipped: number}>`, following spec §13:
    - Runs `ensureIndexes` and `seedPlayers`.
    - Copies each `goals` doc with the same `_id` into `events` (`type:'goal'`, `source:'legacy'`). Display name maps to slug via the roster, case-insensitively, and `"Opponent"` → `opponent`. An unknown player name → `opponent` with `actorInGame` set to the old name.
    - Maps `timestamp` → `occurredAt`, and `progress` → `progressMs`.
    - Sets `songResolved: song !== 'Unknown'`.
    - Recomputes `sessionId` by walking the copied events in time order with the 3-hour rule.
    - Inserts with `ordered:false`, so a duplicate `_id` counts as skipped.
  - `scripts/rl-migrate.ts`: loads `.env.local`, runs `migrateLegacy(await getDb())`, prints counts, exits.
  - `scripts/rl-dev-seed.ts`: starts a `MongoMemoryServer` on port 27018, seeds the players plus the `seedNight` fixture, prints `MONGODB_URI=mongodb://127.0.0.1:27018/` and stays running. UI tasks use it: run `npm run dev` with that URI and `RL_GROUP_PASSCODE=test-passcode`.

- [ ] **Step 1: Failing test:** 5 legacy goals across two nights → 5 events in 2 sessions. Running it twice → `{copied:0, skipped:5}`. `"Vandy"` maps to `vandy`, and the old "Unknown" song maps to `songResolved:false`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl): legacy goal migration and dev seed`.

---

### Task 13: Design tokens, fonts, shared RL chrome

**Files:**
- Modify: `src/app/globals.css` (add the design-system tokens as CSS variables under `:root`, and `.rl-*` utility classes for chip, glass and prompt), `tailwind.config.ts` (`theme.extend.colors`: `surface`, `ink`, `line`, `glyph`, `lime`, `danger` via `rgb(var(--…) / <alpha>)` or raw values; `fontFamily.mono`), `src/app/layout.tsx` (add `JetBrains_Mono` from `next/font/google` as CSS variable `--font-mono`, keep Abel)
- Create: `src/components/rl/RLNav.tsx`, `src/components/rl/GlyphField.tsx`, `src/components/rl/UnlockPrompt.tsx`, `src/components/rl/HelperStatus.tsx`, `src/components/rl/useRlApi.ts`, `src/components/rl/useUnlocked.ts`, `src/components/rl/ascii.ts`, `src/components/rl/__tests__/ascii.test.ts`

**Interfaces:**
- Produces:
  - `RLNav({active}: {active: 'tracker'|'analytics'|'songs'|'settings'})`. A mono prompt row: `> RLTracker  > analytics  > songs  > settings`. The active item is ink, the rest ink-50. Links to `/RLTracker`, `/analytics`, `/analytics/songs`, `/RLTracker/settings`.
  - `GlyphField()`. A fixed full-page canvas of the `. : - + * # D` ramp in `glyph` colour, slow drift, one still frame under reduced motion. Reuse logic from `src/components/AsciiDitherBackground.tsx` if it fits: import it if its props allow the glyph colour, otherwise write a smaller one.
  - `usePoll<T>(url: string, ms = 5000): {data: T|undefined; error: string|undefined; refresh(): void}`
  - `useUnlocked(): {unlocked: boolean; unlock(passcode): Promise<boolean>; lock(): Promise<void>}`. Reads `GET /api/rl/v1/unlock` → `{unlocked}`, so add a GET to the Task 10 unlock route.
  - `UnlockPrompt({onUnlocked})`: an inline passcode field with an "Unlock" button. On a wrong code it shows "That passcode didn't work."
  - `HelperStatus({helpers})`: the single lime dot plus "auto-tracking · N helpers". It shows grey "No helper running" when no key has `lastUsedAt` within 2 min. The data comes from the new public endpoint `GET /api/rl/v1/helpers` → `[{label, lastUsedAt}]` (labels only), which is added in this task.
  - `asciiFromImageData(data: Uint8ClampedArray, w: number, h: number, cols: number, rows: number): string[]`. Brightness-samples the image into the ramp (dark → space, bright → `D`).

- [ ] **Step 1: Failing test:** `asciiFromImageData` on a 2×1 black and white image at 2×1 gives `[' D']`, and it returns `rows` lines of `cols` chars.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the tokens, fonts and components.
- [ ] **Step 4: Run** `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rl-ui): design tokens, mono font, RL nav and shared chrome`.

---

### Task 14: Tracker page (Scorebug)

**Files:** Rewrite `src/app/RLTracker/page.tsx`. Create `src/components/rl/Scorebug.tsx`, `NowPlaying.tsx`, `Leaderboard.tsx`, `GoalButtons.tsx`, `GoalFeed.tsx`, `SessionPicker.tsx`, `src/components/rl/format.ts`, `src/components/rl/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `/api/rl/v1/stats`, `/events`, `/now-playing`, `/helpers`, `/players`, `/goals`, `/events/last`, `/events/[id]` (T10). Components from T13.
- Produces:
  - `Scorebug({goalsFor, goalsAgainst, totalGoals, label})`: a glass panel showing "US 7 | TONIGHT · 11 GOALS | 4 THEM". Our score is ink, theirs ink-60.
  - `NowPlaying({track, hostName})`: canvas glyph art from `track.albumArt`. Load the image with `crossOrigin='anonymous'` (Spotify's CDN sends CORS headers) and fall back to plain glyph noise if the image fails. Shows the song, "artist · {host}'s jam" and the progress.
  - `Leaderboard({rows, highlightActor})`: each roster row is a `Link` to `/RLTracker/players/[slug]`, with the in-game name in mono under the name, a bar in ink-70 and a count. The Opponent row uses danger. The highlight is a 1.2 s `tint-10` background fade.
  - `GoalButtons({players, onLogged})`: one chip per player, plus Opponent and "undo". Unlocked: POST, then call `onLogged`. Locked: render `UnlockPrompt`.
  - `GoalFeed({events, editable})`: rows show time, actor, song and time into the song. Tags: `auto`/`manual`, "song unknown" with a "Set song" inline form (free text song/artist → PATCH), and "sent late". Editable rows get "Change player" (select) and "Delete" (inline confirm, no `confirm()`).
  - `format.ts`: `formatClock(d: Date): string` ("21:41" in Denver), `formatProgress(ms): string` ("2:14"), `actorLabel(actor, players): string`.
  - Page:
    - `RLNav active="tracker"` and `GlyphField`.
    - Desktop layout per the approved mockup: Scorebug top-centre, NowPlaying left, Leaderboard right, then the bottom bar (HelperStatus + GoalButtons), then the feed below the fold.
    - Mobile: one column, with the button bar fixed to the bottom including `env(safe-area-inset-bottom)` padding.
    - Polls stats/events/now-playing every 5 s. When a new event id appears, highlights its actor's row.
    - Empty session state: "No goals yet tonight. They'll show up here as soon as someone scores."

- [ ] **Step 1: Failing tests** for `format.ts`: `formatProgress(134000) === '2:14'`, `formatClock(new Date('2026-11-02T04:41:00Z')) === '21:41'`, and `actorLabel('opponent', ROSTER) === 'Opponent'`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the components and page.
- [ ] **Step 4: Verify.** `npm test && npm run build` passes. Start `npm run rl:seed` and `npm run dev` with the seed URI, then with Playwright take screenshots of `/RLTracker` at 1280×800 and 390×844. Check against the mockup (https://claude.ai/artifact/PSVWPHtoBG6FSfTPcz2Kug, direction B):
  - Exactly one lime element.
  - No emoji.
  - Opponent shown in red text.
  - No horizontal scroll at 390.
  - Unlocking with `test-passcode` and pressing "Ashton" adds a feed row within 5 s.
- [ ] **Step 5: Commit** `feat(rl-ui): Scorebug tracker page`.

---

### Task 15: Player page and analytics restyle with Fun stats

**Files:**
- Create: `src/app/RLTracker/players/[slug]/page.tsx`, `src/components/rl/StatCard.tsx`, `src/components/rl/DemoGrid.tsx`, `src/components/rl/FunStats.tsx`, `src/components/rl/analytics/chartTheme.ts`, plus chart components split out of the analytics page (`SongBarChart.tsx`, `ArtistBarChart.tsx`, `TimelineChart.tsx`, `AnalyticsFilters.tsx`)
- Modify: `src/app/analytics/page.tsx` (becomes composition only, target under 250 lines), `src/app/analytics/songs/page.tsx`, `src/app/api/rl/v1/...` (add `GET /players/[slug]/stats` → `playerStats`, if not added in Task 10)

**Interfaces:**
- Consumes: `/api/rl/v1/players/[slug]/stats`, `/stats/fun`, `/sessions`, `/api/analytics`, `/api/analytics/timeline`.
- Produces:
  - `chartTheme.ts`: `RL_CHART_DEFAULTS` (Abel and mono fonts, ink-60 ticks, line-10 grid, no legend box fill) and `seriesColor(index: number, actor: Actor): string`. Opponent → `#ef4444`, others cycle the ink ladder `[.9,.7,.5,.35]` alpha of `#f5f8f1`.
  - `StatCard({title, value, detail, note, href?})`. The note is the one-line "how this is counted" text from spec §9. The win-rate and victory-song cards include "A match usually spans several songs."
  - `DemoGrid({actors, counts})`: an attacker-by-victim table in mono, with cell intensity as an ink alpha, an Opponent row and column label in danger, and `overflow-x:auto`.
  - Player page:
    - Header with display name plus in-game aliases.
    - A tonight vs all-time toggle with four stat numbers (goals, assists, saves, demos).
    - Top songs per stat, the demo record (two lists), favourite assister and scorer, and the recent feed (`GoalFeed`, read-only).
    - An unknown slug renders "No player called {slug}."
  - Analytics page:
    - `RLNav active="analytics"`, `SessionPicker` (current / past sessions from `/sessions` / all time) and the existing filters and charts, restyled.
    - A "Fun stats" section of `StatCard`s and the `DemoGrid`.
  - Songs page: restyled, with goals / assists / saves / demos tabs (query `/api/rl/v1/stats` song data per type: add an optional `type` param to `sessionStats` songs if not present, defaulting to `goal`).

- [ ] **Step 1: Failing test** for `seriesColor`: opponent → `#ef4444`, and index 0 gives an rgba containing `0.9`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** `npm test && npm run build` passes. Take Playwright screenshots of `/analytics`, `/analytics/songs` and `/RLTracker/players/ashton` at 1280 and 390 against the seed. Check:
  - Every Fun stats card shows its note.
  - Opponent is red.
  - No emoji.
  - The demo grid scrolls inside its own box at 390.
- [ ] **Step 5: Commit** `feat(rl-ui): player pages, restyled analytics, fun stats`.

---

### Task 16: Settings page

**Files:** Create `src/app/RLTracker/settings/page.tsx`, `src/components/rl/settings/{GetHelper,Roster,SpotifyLinks,Devices,Shortcuts}.tsx`

**Interfaces:**
- Consumes: `/unlock`, `/players` (GET/PUT), `/events/reassign`, `/spotify` (+ `connect`, `DELETE`), `/pairing-codes`, `/keys`, `/helper/latest` (T10, T11), plus a new cookie-only `GET /api/rl/v1/unknown-names` → `recentUnknownNames` (add it in this task).
- Produces: a page that shows `UnlockPrompt` while locked. Once unlocked, five ruled sections in this order:
  1. **GetHelper.** A download button from `/helper/latest` (when there's no release, the button is disabled with the text "The helper isn't released yet."). Then three numbered steps: "Download and run RLGoalTracker.exe. Windows may warn you once: choose More info, then Run anyway." / "Enter the pairing code from Devices below." / "Play. Goals, assists, saves and demos log themselves."
  2. **Roster.** An editable table of display name and aliases (comma-separated), saved with "Save roster". `duplicate_alias` shows "Two players can't share an in-game name." Underneath, the "Unrecognised names" list with a "This is…" select → reassign.
  3. **SpotifyLinks.** Per player: "Linked as {displayName}" with Unlink, "Needs relinking" in danger plus a Relink button, or "Link Spotify". It reads the `?spotify=linked|error` query and shows a one-line result.
  4. **Devices.** "Add a device" shows the code in large mono with a live countdown from `expiresAt`. A list of helper keys: label, last seen, Revoke (inline confirm).
  5. **Shortcuts.** "Create shortcut key" (label input) shows the key once, with copy. Then the per-player trigger URL table (`https://zachrobertson.co/api/rl/v1/goals?key=…` with body note), plus short Stream Deck (use any "Web request" / HTTP plugin, method POST, JSON body `{"player":"ashton"}`) and iPhone Shortcuts ("Get contents of URL", method POST, header `Authorization: Bearer <key>`, JSON body) instructions.
  - Copy buttons use `navigator.clipboard.writeText` and fall back to selecting the text.

- [ ] **Step 1: Verify the API pieces with tests:** add a `routes.test.ts` case where `GET /unknown-names` without a cookie returns 401, and with a cookie lists a seeded unknown name.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement the route and page.**
- [ ] **Step 4: Verify.** `npm test && npm run build` passes. On the seed with Playwright:
  - Unlock.
  - Add a device and see a 6-char code.
  - Create a shortcut key, then `curl -X POST "http://localhost:3000/api/rl/v1/goals?key=<key>" -H 'content-type: application/json' -d '{"player":"ashton"}'` returns 200 and the tracker shows it.
  - Revoke the key, and the same curl returns 401.
- [ ] **Step 5: Commit** `feat(rl-ui): settings for roster, Spotify, devices and shortcuts`.

---

### Task 17: Remove legacy routes and finish

**Files:** Delete `src/app/api/goals/route.ts`, `src/app/api/spotify/callback/route.ts`, `src/app/api/spotify/current-track/route.ts`, `src/app/api/spotify/current-track-oauth/route.ts`, `src/components/FriendNavBar.tsx`. Modify `src/data/home.ts` and any other reference found by grep.

- [ ] **Step 1: Find references:** `grep -rn "api/goals\|api/spotify\|FriendNavBar" src`. Expected: only the files being deleted, plus references you update.
- [ ] **Step 2: Delete and update.**
- [ ] **Step 3: Verify:** `npm test && npm run lint && npm run build` all pass, and `grep -rn "console.log" src/lib/rl src/app/api/rl` returns nothing.
- [ ] **Step 4: Add a short section to the repo's README** (create it if absent): the env vars list, `npm run rl:migrate`, the Spotify redirect URIs to register, and `npm run rl:seed` for local UI work.
- [ ] **Step 5: Commit** `chore(rl): remove legacy goal and Spotify routes`.

**Deploy checklist for Zach** (not code; listed in the final report):
1. Set `RL_GROUP_PASSCODE`, `RL_COOKIE_SECRET` and `RL_TOKEN_KEY` in Vercel.
2. Register the new Spotify redirect URIs.
3. Run `npm run rl:migrate` against production once.
4. Each Jam host links Spotify in Settings.
