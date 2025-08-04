# Spotify OAuth Setup Guide

## 🎯 **OAuth Flow Implementation**

Your RL Tracker now uses a **client-side OAuth flow** that eliminates token expiration issues!

## 🔧 **Setup Steps:**

### **1. Update Spotify App Settings**

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Select your app
3. Go to **Settings**
4. Add this **Redirect URI**:
   ```
   https://zachrobertson.co/api/spotify/callback
   ```

### **2. Environment Variables**

Add these to your Vercel project settings:

```
NEXT_PUBLIC_SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
MONGODB_URI=your_mongodb_connection_string
```

### **3. Update Scopes**

Make sure your Spotify app has these scopes:
- `user-read-currently-playing`
- `user-read-playback-state`
- `playlist-read-private`
- `user-read-private`

## 🎵 **How It Works:**

### **User Experience:**
1. Friend visits RL Tracker
2. Sees prominent "Connect Spotify" button
3. Clicks button → redirects to Spotify
4. Logs in and authorizes your app
5. Returns to RL Tracker with automatic song tracking
6. Tokens refresh automatically in background

### **Benefits:**
- ✅ **No more token expiration issues**
- ✅ **Each friend uses their own Spotify account**
- ✅ **Automatic token refresh**
- ✅ **Secure token storage in cookies**
- ✅ **One-time setup per user**

## 🚀 **Deployment:**

1. Update your Spotify app redirect URI
2. Add environment variables to Vercel
3. Deploy the updated code
4. Test the OAuth flow

## 🔍 **Testing:**

1. Visit your RL Tracker page
2. Click "Connect Spotify Account"
3. Complete the authorization flow
4. Verify song tracking works
5. Check that tokens refresh automatically

## 🎯 **What's Different:**

- **Before**: Server-side tokens that expired every 60 minutes
- **After**: Client-side OAuth with automatic refresh
- **Before**: Manual token management
- **After**: Seamless user experience

This new approach completely eliminates the token expiration problems! 🎵 