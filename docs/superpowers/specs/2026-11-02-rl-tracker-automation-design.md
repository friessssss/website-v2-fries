# RL Tracker: Automation, Stats and Redesign

**Date:** 2026-11-02
**Status:** Draft for review
**Owner:** Zach

## 1. Purpose

The RL Tracker records which song was playing when someone in the friend group scores in Rocket League. Today every goal is logged by hand on `/RLTracker`. That is tedious, and the page does not match the rest of zachrobertson.co.

This project:

1. **Automates logging.** A small Windows helper app reads Rocket League's official local Stats API and reports goals, assists, saves, demos and match results to the site. The server attaches the current Spotify Jam track to each event.
2. **Opens an API** so goals can also be logged from Stream Deck buttons, iPhone Shortcuts and similar tools.
3. **Adds stats.** The main view stays focused on goals per song per person and goals against. Clicking a player opens deeper stats, and a new "Fun stats" section covers demos, saves, assists and match results.
4. **Redesigns the UI** in the "Scorebug" direction, built on the Zach Robertson design system.

### Success criteria

- A friend can go from "never installed" to "auto-tracking" in under two minutes: download, run, type a 6-character code. No file editing, no copying keys.
- In a normal online match (EAC on), every goal, assist, save and demo involving the lobby is recorded once, with the correct person and the song playing at that moment, without anyone pressing a button.
- Manual logging still works from the website and from a Stream Deck or phone shortcut.
- Existing goal history keeps showing up in all-time analytics.
- The tracker, analytics and settings pages read as part of zachrobertson.co.

### Context and constraints (from the user)

- The group plays on **separate Windows PCs** in a Discord call. **Everyone is on Windows.**
- Music comes from a **Spotify Jam** that any one of the friends may host on a given night.
- Matches are online with **Easy Anti-Cheat on**, so BakkesMod and other injected mods are out. The Stats API is an official, built-in game feature.
- **Easy setup for friends** is the top priority. Automate every setup step that can be automated.
- **Roster.** In-game names differ from display names:

  | Display | In-game name |
  |---|---|
  | Vandy | v9ndy |
  | Ashton | Ash |
  | Sam | Samdree |
  | Mason | ImFanzo |
  | Jake | Tubbs McGee |
  | Zach | Fries |

- Writes are protected by **one shared group passcode** set in the Vercel environment (`RL_GROUP_PASSCODE`). The value is never committed to the repo. Reading the scoreboard and analytics stays public.

### Assumptions to verify (Spike, task 1)

- The exact JSON shapes of `GoalScored`, `StatfeedEvent` (types `Assist`, `Save`, `Demolish`), match start, match end, and the periodic state update. In particular, whether the scorer's team and the assister appear on `GoalScored`, and what `MainTarget` and `SecondaryTarget` contain for demos.
- Whether port 49123 speaks raw TCP JSON or WebSocket on the current build, and whether a WebSocket also exists on 49124.
- Which of `TAStatsAPI.ini` and `DefaultStatsAPI.ini` the current build reads.
- What Spotify's `currently-playing` endpoint returns for a **Jam guest**, compared with the host.

The design works with any of these outcomes. The spike decides details inside the helper's parser and the Spotify account picker.

## 2. Current state

- `src/app/RLTracker/page.tsx` (547 lines): polls Spotify every 20s, has hardcoded player buttons, writes to MongoDB `rl-tracker.goals` with `sessionId: 'default'`.
- `src/app/api/goals/route.ts`: unauthenticated POST, GET and DELETE.
- `src/app/api/spotify/{callback,current-track,current-track-oauth}`: Spotify tokens live in **httpOnly cookies in the browser that connected**, so nothing but that browser can look up the current track. Token refresh code is duplicated across two routes.
- `src/app/analytics/page.tsx` (1,103 lines) and `src/app/analytics/songs/page.tsx`, backed by `src/app/api/analytics/*`.
- No tests.

## 3. Architecture

```
 Friend's PC (any number)              zachrobertson.co (Next.js 14, Vercel)              Spotify
┌───────────────────────┐  HTTPS+key  ┌─────────────────────────────────────────┐        ┌─────────┐
│ Rocket League         │             │ /api/rl/v1/*                            │ tokens │         │
│  └ Stats API :49123   │──events──►  │   events ingest → dedupe → roster match │◄──────►│ Web API │
│ RLGoalTracker.exe     │────────────►│   → now-playing lookup (any linked,     │        │         │
│  (tray app)           │             │      active account)                    │        └─────────┘
└───────────────────────┘             │ src/lib/rl/*  (all logic)               │
 Stream Deck / Shortcuts ───────────► │ MongoDB rl-tracker                      │
   (manual goals, same API)           │ UI: /RLTracker, /RLTracker/players/[slug],
                                      │     /RLTracker/settings, /analytics     │
                                      └─────────────────────────────────────────┘
```

### Code layout

```
src/lib/rl/
  db.ts          collections + index setup
  auth.ts        passcode cookie (signed), API key hash/verify, pairing codes
  players.ts     roster CRUD, in-game name → player resolution
  spotify.ts     token refresh, now-playing, active-account picker
  events.ts      record events (dedupe, song attach), corrections
  matches.ts     match lifecycle, heartbeat song sampling
  sessions.ts    session rollover rule
  stats.ts       aggregations for leaderboard, player pages, fun stats
src/app/api/rl/v1/...   thin route handlers over src/lib/rl
src/components/rl/...   UI components
helper/                 Go module for RLGoalTracker.exe
scripts/rl-migrate.ts   one-time data migration
```

Route handlers only parse input, call `src/lib/rl`, and shape output. All behaviour lives in the library so it can be unit tested.

## 4. Data model (MongoDB `rl-tracker`)

### `players` (new)
```ts
{ _id, slug: "ashton", displayName: "Ashton", aliases: ["Ash"], active: true, createdAt }
```
Seeded with the six friends above. Aliases are matched case-insensitively and with whitespace trimmed. Two special actors are not stored as players: `"opponent"` and `"teammate"` (a non-roster player on our team).

### `events` (new, replaces `goals`)
```ts
{
  _id,
  type: "goal" | "assist" | "save" | "demo",
  actor: "<player slug>" | "opponent" | "teammate",
  actorInGame?: string,            // raw name from the game
  target?: "<slug>" | "opponent" | "teammate",   // demos only: who got demoed
  targetInGame?: string,
  assister?: "<slug>" | "teammate" | "opponent", // goals only, when known
  // song at the moment of the event
  song: string | null, artist: string | null, album?: string | null,
  trackId?: string | null, albumArt?: string | null,
  progressMs?: number | null, playlist?: string | null, playlistId?: string | null,
  songResolved: boolean,
  // context
  occurredAt: Date,                // when it happened, on the server's clock (see section 5, late events)
  sessionId: string,
  matchGuid?: string, gameTime?: number,   // helper events only
  source: "helper" | "manual" | "legacy",
  reportedBy?: ObjectId,           // apiKeys._id
  dedupeKey?: string,              // unique, sparse
  createdAt: Date,
}
```
Indexes: `{dedupeKey: 1}` unique sparse, `{sessionId: 1, occurredAt: -1}`, `{type: 1, actor: 1}`, `{matchGuid: 1}`.

**Dedupe key:** `${matchGuid}:${type}:${gameTime}:${actorInGame}:${targetInGame ?? ""}` (names lowercased). Manual events have no key.

### `matches` (new)
```ts
{
  _id, guid, sessionId,
  startedAt: Date, endedAt?: Date,
  ourTeam?: 0 | 1, ourScore?: number, theirScore?: number,
  result?: "win" | "loss",
  songs: [{ trackId, song, artist, firstSeenAt }],   // distinct tracks heard during the match
  victorySong?: { trackId, song, artist },           // track at match end, set only on wins
}
```
Index: `{guid: 1}` unique.

**"Our team"** is the team with the most roster players on it in that match. It's decided from the first event or state update that lists players, and stored on the match.

### `sessions`
A session is not stored separately. `sessionId` is derived: when an event arrives, if the most recent event happened more than **3 hours** earlier, a new session starts with id `YYYY-MM-DD-HHmm` (in America/Denver time) based on the first event. Otherwise the event joins the current session. "Current session" in the API means the latest session id, if its last event is under 3 hours old.

### `spotifyAccounts` (new)
```ts
{ _id, playerSlug, spotifyUserId, displayName,
  refreshTokenEnc: string,          // AES-256-GCM with RL_TOKEN_KEY
  accessToken?: string, accessTokenExpiresAt?: Date,
  status: "ok" | "needs_relink",
  lastSeenPlayingAt?: Date, createdAt }
```

### `apiKeys` (new)
```ts
{ _id, label, kind: "helper" | "shortcut", hash, prefix,   // sha-256 of the key; prefix for display
  createdAt, lastUsedAt?, revokedAt? }
```

### `pairingCodes` (new)
```ts
{ _id, code, expiresAt, usedAt? }    // TTL index on expiresAt
```
Codes are 6 characters from an unambiguous alphabet (no 0/O/1/I) and valid for 10 minutes.

## 5. Spotify: picking the current song

1. Load all `spotifyAccounts` with `status: "ok"`.
2. Ask each account's `currently-playing` in parallel, using a cached access token and refreshing it when expired. Timeout: 2.5s each.
3. Keep only accounts that are **playing** (`is_playing: true` with an item).
4. If more than one is playing:
   1. Prefer the track that most accounts agree on, which covers everyone being in the Jam.
   2. If there's a tie, prefer the account with the most recent `lastSeenPlayingAt`.
5. Update `lastSeenPlayingAt` on the chosen account.
6. If none is playing or every call fails, the event is saved with `songResolved: false`.
7. A `401` or `400 invalid_grant` on refresh sets that account to `needs_relink`.

**Late events:** each helper batch carries `sentAt` (helper clock). If `sentAt - at` for an event is more than **2 minutes** (the helper was offline), the server skips the lookup and saves `songResolved: false`. The current song is no longer the one that was playing. Both times come from the same clock, so a PC clock that's off doesn't matter. The server stores `occurredAt = serverReceivedAt - (sentAt - at)`.

The playlist name is looked up the same way as today, from the `context` URI, and cached per playlist id for an hour.

`GET /now-playing` uses the same picker and caches the result for 3s to keep Spotify calls low while several tabs poll.

## 6. Auth

- **Group passcode.** `POST /api/rl/v1/unlock {passcode}` compares against `RL_GROUP_PASSCODE` in constant time. On success it sets cookie `rl_unlock` (httpOnly, secure, sameSite=lax, 90 days), an HMAC of a fixed payload plus the passcode, signed with `RL_COOKIE_SECRET`. Changing the passcode invalidates every cookie.
- **API keys.** The format is `rlk_` followed by 32 random base62 characters. Only the SHA-256 hash is stored. A key is accepted from `Authorization: Bearer <key>`, or from `?key=` for tools that can't set headers. `lastUsedAt` updates at most once a minute.
- **Write endpoints** accept either a valid cookie or a valid key, unless the table in section 7 says otherwise.
- **Rate limit:** per key, 120 requests a minute (in-memory per serverless instance; this is a guard, not a security boundary).

New environment variables: `RL_GROUP_PASSCODE`, `RL_COOKIE_SECRET`, `RL_TOKEN_KEY` (32 bytes, base64). Existing: `MONGODB_URI`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`.

## 7. API (`/api/rl/v1`)

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /unlock`, `POST /lock` | none / cookie | Set or clear the passcode cookie |
| `POST /events` | key | Helper batch ingest (see below) |
| `POST /goals` | key or cookie | Manual goal: `{ player: slug \| "opponent" \| "teammate" }` |
| `DELETE /events/last` | key or cookie | Undo the most recent event in the current session (optionally `?type=goal`) |
| `PATCH /events/:id` | cookie | Change actor, target, assister, or song (`{trackId}` or free text) |
| `DELETE /events/:id` | cookie | Delete an event |
| `POST /events/reassign` | cookie | `{ inGameName, player }`: add the alias and repoint past events with that `actorInGame`/`targetInGame` |
| `GET /events?session=current\|<id>\|all&type=&player=&limit=&before=` | public | Feed, newest first, cursor by `before` |
| `GET /now-playing` | public | `{ track \| null, hostSlug \| null }` |
| `GET /sessions` | public | Session ids with start, end and goal totals |
| `GET /stats?session=&player=` | public | Counts per player and type, goals per song per player, goals against |
| `GET /stats/fun?session=` | public | Fun-stats payload (section 9) |
| `GET /matches?session=` | public | Matches with results and songs |
| `GET /players`, `PUT /players` | public / cookie | Roster read and replace |
| `POST /pairing-codes` | cookie | New 6-character code |
| `POST /pair` | code | `{ code, label }` → `{ apiKey }`. Burns the code and creates a `helper` key |
| `POST /keys` | cookie | Create a `shortcut` key `{ label }` and return it once |
| `GET /keys`, `DELETE /keys/:id` | cookie | List (prefix, label, last used) and revoke |
| `GET /spotify/connect?player=` | cookie | Start OAuth for that friend (state is a signed `{player, nonce}`) |
| `GET /spotify/callback` | state | Store the encrypted refresh token, then redirect to settings |
| `DELETE /spotify/:id` | cookie | Unlink |
| `GET /helper/latest` | public | `{ version, downloadUrl }` from the latest `helper-v*` GitHub Release |

### `POST /events` body
```json
{
  "helperVersion": "1.0.0",
  "sentAt": "ISO",
  "events": [
    { "kind": "match_start", "matchGuid": "…", "at": "ISO", "players": [{"name":"Fries","team":0}, …] },
    { "kind": "goal", "matchGuid": "…", "at": "ISO", "gameTime": 182.4,
      "scorer": {"name":"Ash","team":0}, "assister": {"name":"Samdree","team":0} },
    { "kind": "assist", "matchGuid": "…", "at": "ISO", "gameTime": 182.4, "player": {"name":"Samdree","team":0} },
    { "kind": "save", "matchGuid": "…", "at": "ISO", "gameTime": 201.0, "player": {"name":"v9ndy","team":0} },
    { "kind": "demo", "matchGuid": "…", "at": "ISO", "gameTime": 220.7,
      "attacker": {"name":"Fries","team":0}, "victim": {"name":"xXRando","team":1} },
    { "kind": "heartbeat", "matchGuid": "…", "at": "ISO" },
    { "kind": "match_end", "matchGuid": "…", "at": "ISO", "score": {"0": 3, "1": 2} }
  ]
}
```
The response returns one result per input event: `{ status: "recorded" | "duplicate" | "ignored", id? }`. Batches can hold up to 50 events.

How the server handles each kind:
- **match_start** upserts the match and decides `ourTeam`.
- **goal / assist / save / demo** resolve names to actors:
  - A roster alias resolves to that player.
  - Otherwise, a name on `ourTeam` becomes `teammate`, and anyone else becomes `opponent`.
  - Then the server attaches the song and records the event with its dedupe key.
  - An `assist` event that duplicates a goal's `assister` is still recorded as its own `assist` event. Stats count assists from `assist` events only.
- **heartbeat** adds the current track to `matches.songs` if it isn't there yet. It doesn't create an event.
- **match_end** sets the scores and the result. On a win, it records `victorySong` from the current track.
- An event for an unknown `matchGuid` creates the match lazily.

## 8. Helper app (`helper/`, Go)

### Distribution
- A GitHub Actions workflow runs when a tag matching `helper-v*` is pushed. It runs `go test`, builds `RLGoalTracker.exe` for `windows/amd64` with `-ldflags "-H windowsgui -X main.version=…"`, and attaches it to a GitHub Release.
- The site's "Get the helper" button links to `/api/rl/v1/helper/latest` → the release asset.
- The exe is **unsigned**. The download card tells friends to expect one SmartScreen prompt ("More info → Run anyway").

### First run
1. **Pairing window** (a small native dialog): "Enter the code from zachrobertson.co/RLTracker/settings". It calls `POST /pair` with `label = <Windows username>@<PC name>` and stores the key in **Windows Credential Manager**.
2. **Find Rocket League**, in this order:
   1. Steam: read `libraryfolders.vdf` from the Steam install path in the registry, then check each library for `steamapps/common/rocketleague`.
   2. Epic: parse `%ProgramData%/Epic/UnrealEngineLauncher/LauncherInstalled.dat` for the `Sugar` app.
   3. Common default paths.
   4. A folder picker.
3. **Enable the Stats API.** Choose `TAGame/Config/TAStatsAPI.ini` if it exists, otherwise `DefaultStatsAPI.ini`. Back it up as `<name>.rltracker.bak`, the first time only. Under `[TAGame.MatchStatsExporter_TA]`, set `PacketSendRate=20` and keep everything else. If Rocket League is running, show "Restart Rocket League once to start tracking."
4. **Install itself.** Copy to `%LOCALAPPDATA%/RLGoalTracker/RLGoalTracker.exe` and add `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\RLGoalTracker`. No admin rights needed.
5. Move to the system tray.

### Running
- **Tray icon states:**
  - Grey: Rocket League not running.
  - Lime: connected.
  - Amber: offline, with events queued.
  - Red: re-pair needed.
- **Tray menu:** Status line, Open tracker, Toasts on/off, Pause tracking, Re-pair, Quit.
- **Connecting:**
  - Try `127.0.0.1:49123` every 5s.
  - Detect the protocol from the first bytes: an HTTP `101` upgrade means WebSocket, otherwise newline- or brace-delimited JSON.
  - Also try a WebSocket on `49124`.
- **Parsing:** map raw messages to the event kinds in section 7. The match GUID comes from the message, and `at` is the local clock.
  - Heartbeat every 30s while a match is active.
  - De-duplicate locally within a match, because the game can repeat statfeed messages.
- **Upload queue:** an append-only JSONL file in the install folder.
  - Flush every 2s, in batches of up to 50.
  - On a network error, back off exponentially up to 60s. Events persist across restarts.
  - On `401`, stop flushing and switch to the red "re-pair" state.
- **Toast** on goals by roster players: "Ashton scored · Midnight City". It can be switched off.
- **Self-update:** on start and every 12 hours, compare with `/helper/latest`. If newer, download it next to the current exe, swap them on the next launch, and restart.

### Package layout
```
helper/
  main.go
  internal/config      install dir, key storage (wincred)
  internal/rlpath      Steam/Epic discovery
  internal/statsini    ini patching
  internal/statsapi    connection + protocol sniffing + message parsing
  internal/queue       persistent upload queue
  internal/api         site client
  internal/tray        tray + toasts + pairing dialog
  internal/update      self-update
  testdata/            recorded Stats API streams (from the spike), fixture vdf/dat/ini files
```

## 9. Stats

All stats are aggregations over `events` and `matches`, computed in `src/lib/rl/stats.ts` with MongoDB aggregation pipelines.

### Main view (tracker)
- **Scorebug:** goals for (roster + teammate) against goals by the opponent, for the selected session.
- **Leaderboard:** goals per roster player, plus a separate Opponent row.
- **Goals per song by person:** the song breakdown, same as current analytics.
- **"Top song tonight":** the song with the most goals for.

### Player page (`/RLTracker/players/[slug]`)
- Goals, assists, saves and demos, for this session and all time.
- Top songs for each stat.
- **Demo record:** victims they demo most, and who demos them most.
- Favorite assister / favorite scorer to assist.
- Their recent events.

### Fun stats (`/analytics`, "Fun stats" section)
| Card | Definition |
|---|---|
| Demo leaderboard | Demos by actor, roster plus Opponent |
| Who demos who | Grid of demo counts, attacker × victim (roster + Opponent + Teammate) |
| Demo anthem | Track with the most demos (any actor) |
| Brick wall | Most saves by one player in one match |
| Playmaker | Most assists, plus the assister→scorer pair with the most goals |
| Victory song | Track most often playing at the end of a won match |
| Win rate by song | For each track in `matches.songs`: wins ÷ matches it appeared in. Minimum 3 matches |
| Night of the night | Each player's best session by goals + assists + saves |

Every card shows a one-line note on how it's counted. The two song-and-match cards add that a match usually spans several songs.

## 10. UI

Built on the **Zach Robertson design system**:
- **Type:** Abel for all headings and text, with no bold. JetBrains Mono for meta, chips, labels and `> ` prompts. Both loaded with `next/font/google`.
- **Colour:** ground `#040705`, and the white-alpha ink ladder (`ink`, `ink-90/70/60/50/40`).
- **Borders:** `line-20/10/08` hairlines, radii of 4px for chips and cards and 8px for glass panels.
- **Lime** is used for exactly one thing per screen: the live helper-status dot.
- **Opponent** uses `danger`, always as a labelled word.
- **No emoji.**
- The grey ASCII glyph field (`glyph` token) is the page background on tracker pages.
- Respect `prefers-reduced-motion`.

The tokens are added as CSS variables in `globals.css` and exposed to Tailwind via `theme.extend`.

### Components (`src/components/rl/`)
- `Scorebug`
- `NowPlaying`: album art redrawn as ASCII on a canvas from the real cover image, sampled in brightness and drawn with the `. : - + * # D` ramp.
- `Leaderboard`
- `GoalFeed`
- `GoalButtons`
- `HelperStatus`
- `SessionPicker`
- `StatCard`
- `DemoGrid`
- `UnlockPrompt`
- `RLNav`: replaces `FriendNavBar` with a `> RLTracker  > analytics  > songs  > settings` prompt row.

### Pages
- **`/RLTracker`:** Scorebug at the top, then now playing on the left and the leaderboard (each row linking to the player page) on the right.
  - A bottom bar holds the helper status and manual buttons for each roster player, plus Opponent and Undo. When locked, it shows an "Unlock to log goals" prompt instead.
  - Below the fold: tonight's feed with an `auto`/`manual` tag. Unlocked users can edit or delete entries, and "song unknown" entries show a "Set song" action.
  - Polls `/events?session=current` and `/now-playing` every 5s.
  - The leaderboard row of a new goal highlights briefly.
  - Mobile order: scorebug, now playing, leaderboard, feed, with the button bar fixed to the bottom.
- **`/RLTracker/players/[slug]`:** the player page (section 9).
- **`/RLTracker/settings`:** passcode-gated, with five sections:
  1. **Get the helper:** download button and three numbered steps.
  2. **Roster:** players and aliases. Unrecognised in-game names seen recently, with a "This is…" reassign action.
  3. **Spotify:** link status per friend.
  4. **Devices:** "Add a device" pairing code with a countdown, plus paired helpers with last seen and revoke.
  5. **Shortcuts:** create a shortcut key, then copy per-player trigger URLs. Includes Stream Deck and iPhone Shortcuts instructions.
- **`/analytics`:** existing charts restyled (Chart.js series in the ink ladder, Opponent in `danger`), a `SessionPicker` (current / past sessions / all time), and the new Fun stats section. The 1,103-line page is split into chart components under `src/components/rl/analytics/`.
- **`/analytics/songs`:** restyled. It reads from `events`, and gains per-stat tabs (goals / assists / saves / demos).

### Copy
Plain and a little dry, per the design system. Errors say what happened and what to do, for example: "Spotify for Ashton needs relinking. Open settings to relink."

## 11. Error handling

| Situation | Behaviour |
|---|---|
| No linked Spotify account playing | Save the event with `songResolved: false`. The feed shows "Song unknown" with a "Set song" action |
| Spotify refresh revoked | Account → `needs_relink`. Settings and tracker show a relink notice |
| Helper upload over 2 min late | Save without a song lookup and mark it "sent late" in the feed |
| Same event from several helpers | Unique `dedupeKey`. Later reports return `duplicate` |
| Unknown in-game name | Saved as `teammate` / `opponent` with the raw name. Settings lists it for reassigning |
| Invalid key | `401 {error:"invalid_key"}`. The helper switches to re-pair state |
| Locked browser tries to write | `401 {error:"locked"}`. The UI shows the unlock prompt |
| Expired or used pairing code | `400 {error:"code_expired"}`. The helper asks again |
| Mongo unavailable | `503 {error:"unavailable"}`. The helper keeps the events queued |
| Stats API port closed | The helper stays grey and retries every 5s |

Server logs never include tokens, keys or passcodes. The existing verbose `console.log` calls are removed.

## 12. Testing

- **Vitest** (new dev dependency) for `src/lib/rl/*`, with `mongodb-memory-server` for aggregation tests:
  - roster resolution (case, whitespace, aliases, teammate vs opponent)
  - dedupe keys
  - session rollover at 3h
  - Spotify picker (majority track, tie-break, none playing, revoked token) against a fake client
  - late-event rule
  - passcode cookie sign/verify and API key hashing
  - pairing code expiry and single use
  - each stats aggregation against a fixture data set
- **Route tests:** every write endpoint rejects requests with no cookie or key and accepts each valid method.
- **Go tests:**
  - parsing recorded Stats API streams over both TCP and WebSocket framing
  - ini patcher: keeps other settings, safe to run twice, makes a backup
  - Steam `libraryfolders.vdf` and Epic `LauncherInstalled.dat` discovery against fixtures
  - queue persistence and backoff
  - local per-match dedupe
- **Manual acceptance:** one real online match with two helpers running. Check that each goal, assist, save and demo appears once, with the right people and song, and that the match result and victory song are recorded.

## 13. Migration

`scripts/rl-migrate.ts` (run once with `npx tsx`, safe to re-run):
1. Create collections and indexes.
2. Seed `players` with the six friends and their aliases, if they don't exist yet.
3. Copy each `goals` document into `events` as `type: "goal"`, `source: "legacy"`:
   - `player` maps to `actor` by display name. `"Opponent"` maps to `opponent`.
   - `timestamp` → `occurredAt`.
   - The song fields are copied, with `songResolved: song !== "Unknown"`.
   - `sessionId` is recomputed with the 3-hour rule.
   - The legacy `_id` is kept as the new event's `_id`, which makes reruns safe.
4. Leave `goals` in place as a backup. Deleting it is a manual step after you've checked the new pages.

Spotify accounts must be relinked once through Settings, because the old cookie tokens can't be moved server-side.

## 14. Rollout

Each phase ships on its own:

1. **Spike:** record raw Stats API output for all four event types and match start/end in a real match, saved to `helper/testdata/`. Check Spotify `currently-playing` from a Jam guest account.
2. **Server core:** `src/lib/rl/*`, data model, migration script, v1 API, tests. The old routes remain.
3. **Access:** passcode unlock, Settings (roster, Spotify linking, devices, shortcuts).
4. **UI:** new `/RLTracker`, player pages, restyled analytics with Fun stats, `RLNav`. Then delete `/api/goals`, `/api/spotify/*` and `FriendNavBar`.
5. **Helper:** Go app, CI release workflow, download card wired to `/helper/latest`.

## 15. Out of scope

- A Discord bot.
- Code signing the helper.
- macOS or console support for the helper. Console or Mac players are still tracked when any PC player in the match runs it.
- Shots, touches, boost and other Stats API fields beyond goals, assists, saves, demos and match results.
- Per-user accounts or roles beyond the shared passcode.
- A no-download browser connection to the Stats API.
