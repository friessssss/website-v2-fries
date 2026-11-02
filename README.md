# zachrobertson.co

Personal site of Zach Robertson, built with Next.js 14 and TypeScript. It holds the portfolio pages plus the RL Tracker, a private Rocket League stats app for a friend group.

## RL Tracker

### Environment variables

| Name | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (database `rl-tracker`) |
| `SPOTIFY_CLIENT_ID` | Spotify app client id |
| `SPOTIFY_CLIENT_SECRET` | Spotify app client secret |
| `RL_GROUP_PASSCODE` | Shared passcode that unlocks the tracker |
| `RL_COOKIE_SECRET` | Secret used to sign the unlock cookie |
| `RL_TOKEN_KEY` | 32-byte base64 key that encrypts stored Spotify tokens |
| `GITHUB_TOKEN` | Optional. Authenticates helper release lookups to avoid GitHub's unauthenticated rate limit; a fine-grained token with public read access is enough |

Generate secrets with `openssl rand -base64 32`.

### Spotify redirect URIs

Register both in the Spotify dashboard:

- Production: `https://zachrobertson.co/api/rl/v1/spotify/callback`
- Local: `http://127.0.0.1:3000/api/rl/v1/spotify/callback`

Spotify rejects `localhost`, so open the local dev site at `http://127.0.0.1:3000`.

### Commands

- `npm run rl:migrate` copies the legacy `goals` collection into the new collections. It prints the counts copied and skipped (already migrated), the ids that were invalid, and the player names it could not map (saved as opponent).
- `npm run rl:import-christmas` imports the Christmas League spreadsheet history (2021–2023, from `data/christmas-league-2021-2023.json`) as goal events with source `import`. Run it after `npm run rl:migrate` so songs and the playlist can be linked to the migrated tracker goals. It is safe to re-run. Options: `--playlist-id=` and `--playlist-name=` when the Christmas playlist cannot be detected. It prints inserted, skipped, linked songs, the playlist used, and every song it could not link. The JSON was produced once by `scripts/christmas-league/convert.py` (`python3 -I scripts/christmas-league/convert.py <workbook.xlsx> <out.json>`).
- `npm run rl:seed` starts a local in-memory MongoDB with sample data for UI work and prints the `MONGODB_URI` and `RL_TOKEN_KEY` to use.
- `npm test` runs the Vitest suite.
