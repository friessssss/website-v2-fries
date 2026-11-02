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

Generate secrets with `openssl rand -base64 32`.

### Spotify redirect URIs

Register both in the Spotify dashboard:

- Production: `https://zachrobertson.co/api/rl/v1/spotify/callback`
- Local: `http://127.0.0.1:3000/api/rl/v1/spotify/callback`

Spotify rejects `localhost`, so open the local dev site at `http://127.0.0.1:3000`.

### Commands

- `npm run rl:migrate` copies the legacy `goals` collection into the new collections. It prints the counts copied and skipped (already migrated), the ids that were invalid, and the player names it could not map (saved as opponent).
- `npm run rl:seed` starts a local in-memory MongoDB with sample data for UI work and prints the `MONGODB_URI` and `RL_TOKEN_KEY` to use.
- `npm test` runs the Vitest suite.
