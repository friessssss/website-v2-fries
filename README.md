## Zach Robertson — Personal Site

Next.js 14 app router project powering Zach's personal site, Rocket League telemetry tools, and Spotify integrations. The marketing surface is driven by Sanity CMS with a dual-mode landing experience:

- **Fancy mode** — Neo-brutalist layout with Lenis smooth scrolling and a Three.js fluid cursor.
- **Simple mode** — Accessible stacked layout for folks who prefer traditional scrolling.

## Requirements

- Node.js 20+
- npm 10+
- Sanity project (v3)
- MongoDB + Redis/KV for Rocket League + Spotify services (see `MONGODB_SETUP.md`, `REDIS_SETUP.md`, `VERCEL_KV_SETUP.md`)

## Scripts

| Script        | Description                              |
| ------------- | ---------------------------------------- |
| `npm run dev` | Start Next.js locally on `localhost:3000` |
| `npm run build` | Production build                        |
| `npm run start` | Run the built output                    |
| `npm run lint` | ESLint                                   |
| `npm run studio` | Launch Sanity Studio locally           |

## Environment Variables

Create `.env.local` with at least:

```
NEXT_PUBLIC_SANITY_PROJECT_ID=xxxx
NEXT_PUBLIC_SANITY_DATASET=production
NEXT_PUBLIC_SANITY_API_VERSION=2024-06-01
SANITY_PREVIEW_SECRET=some-long-string
SANITY_REVALIDATE_SECRET=another-secret
```

Existing Spotify + Rocket League services keep their previous envs (see the `SPOTIFY_*` docs in the repo).

## Sanity Studio

1. `npm run studio` to open the embedded Studio (`http://localhost:3333` by default) or visit `/studio` when running `npm run dev`.
2. Manage:
   - `siteSettings` document for nav/footer/meta + accent colors.
   - `homePage` document for hero, about, experience, projects, Rocket League, and Now Playing copy.
3. Webhook → `POST /api/revalidate` with `secret` = `SANITY_REVALIDATE_SECRET` and payload `{ "tag": "sanity-home", "path": "/" }` to refresh ISR.

## Fancy vs Simple Landing

- The hero toggle stores the preferred mode in `localStorage`. Reduced-motion users default to the Simple variant.
- Fancy mode additionally loads Lenis + the fluid cursor Canvas. Simple mode avoids those scripts entirely.
- Share content between both modes via Sanity (no duplication required).

## Rocket League + Spotify

All existing analytics, OAuth, and tracking routes remain untouched. After deploying:

1. Run through `RLTracker` to confirm goal logging still works.
2. Connect Spotify via `/RLTracker` and ensure `/api/spotify/*` endpoints respond (see `SPOTIFY_SETUP.md`).

## Deployment

Deploy to Vercel (recommended) or any platform that supports Next.js 14 app router. Make sure Sanity env vars + Spotify credentials are set in the hosting environment. For Studio previews, point your Sanity project’s CORS + webhook configs to the deployed domain.
