# Spotify Integration Setup

To get your RL Tracker working with Spotify, you'll need to set up Spotify API credentials.

## Step 1: Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with your Spotify account
3. Click "Create App"
4. Fill in the app details:
   - App name: "RL Tracker" (or whatever you prefer)
   - App description: "Personal project for tracking Rocket League goals with music"
   - Redirect URI: `http://localhost:3000/api/spotify/callback` (for development)
5. Accept the terms and create the app

## Step 2: Get Your Credentials

After creating the app, you'll see:
- **Client ID** - Copy this
- **Client Secret** - Click "Show Client Secret" and copy this

## Step 3: Get a Refresh Token

You'll need to get a refresh token. The easiest way is to use this tool:

1. Go to [Spotify Token Generator](https://github.com/spotify/web-api-auth-examples)
2. Or use this simple method:
   - Visit: `https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost:3000/api/spotify/callback&scope=user-read-currently-playing`
   - Replace `YOUR_CLIENT_ID` with your actual client ID
   - Authorize the app
   - Copy the `code` from the URL
   - Use a tool like Postman or curl to exchange the code for a refresh token

## Step 4: Set Environment Variables

Create a `.env.local` file in your project root with:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token_here
```

## Step 5: Test It

1. Start your development server: `npm run dev`
2. Go to `/RLTracker`
3. Start playing music on Spotify
4. You should see your current track displayed!

## Troubleshooting

- Make sure you're playing music on Spotify
- Check that all environment variables are set correctly
- The refresh token doesn't expire, so you only need to get it once
- If you get errors, check the browser console and server logs

## Next Steps

Once this is working, we can add:
- Goal tracking functionality
- Song history
- Analytics on which songs correlate with more goals
- Integration with your existing Prismic CMS for data storage 