# Redis Setup Guide (Vercel KV Alternative)

Your RL Tracker now uses Redis for data storage! Here's how to set it up:

## 🚀 Setup Steps

### 1. Create Redis Database

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project (`website-v2-fries`)
3. Go to **Storage** tab
4. Click **Create Database**
5. Choose **Redis** from the Marketplace Database Providers
6. Select a region close to you
7. Click **Create**

### 2. Get Your Connection Details

After creating the database:
1. Copy the **Connection String** (looks like: `redis://...`)
2. This will be your `REDIS_URL` environment variable

### 3. Add Environment Variables

Add these to your `.env.local` file:

```env
# Spotify API (you already have these)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token

# Redis (add this)
REDIS_URL=your_redis_connection_string
```

### 4. Deploy to Vercel

1. Push your code to GitHub
2. Vercel will automatically deploy
3. Add the same environment variables in your Vercel project settings

## 🎯 What's Working Now

- ✅ **Goal Storage**: Goals are saved to Redis
- ✅ **Session Tracking**: Each gaming session gets a unique ID
- ✅ **Recent Goals Display**: Shows last 5 goals with song info
- ✅ **Real-time Updates**: Goals appear immediately after scoring
- ✅ **Data Persistence**: Goals stored for 30 days

## 📊 Data Structure

Each goal stores:
```json
{
  "player": "Zach",
  "song": "Song Name",
  "artist": "Artist Name", 
  "timestamp": "2025-01-03T05:20:08.771Z",
  "progress": 6507,
  "sessionId": "session_1704256808771"
}
```

## 🔧 Next Steps

Once KV is working, we can add:
- **Analytics Dashboard**: Which songs bring the most goals
- **Player Statistics**: Individual player performance
- **Song Recommendations**: Best songs for scoring
- **Export Data**: Download your goal history

## 🐛 Troubleshooting

If goals aren't saving:
1. Check browser console for errors
2. Verify environment variables are set
3. Make sure Redis is properly connected
4. Check Vercel function logs

The Redis integration is now ready! 🎮⚽ 