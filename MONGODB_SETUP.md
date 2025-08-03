# MongoDB Atlas Setup Guide

Your RL Tracker now uses MongoDB Atlas for permanent data storage! Here's how to set it up:

## 🚀 Setup Steps

### 1. Create MongoDB Atlas Account

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Click **"Try Free"** or **"Get Started Free"**
3. Create an account or sign in

### 2. Create a Cluster

1. Click **"Build a Database"**
2. Choose **"FREE"** tier (M0)
3. Select your preferred cloud provider (AWS, Google Cloud, or Azure)
4. Choose a region close to you
5. Click **"Create"**

### 3. Set Up Database Access

1. In the left sidebar, click **"Database Access"**
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Create a username and password (save these!)
5. Set privileges to **"Read and write to any database"**
6. Click **"Add User"**

### 4. Set Up Network Access

1. In the left sidebar, click **"Network Access"**
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (for Vercel deployment)
4. Click **"Confirm"**

### 5. Get Your Connection String

1. Go back to **"Database"** in the sidebar
2. Click **"Connect"** on your cluster
3. Choose **"Connect your application"**
4. Copy the connection string
5. Replace `<password>` with your database user password
6. Replace `<dbname>` with `rl-tracker`

### 6. Add Environment Variables

Add this to your `.env.local` file:

```env
# Spotify API (you already have these)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REFRESH_TOKEN=your_spotify_refresh_token

# MongoDB (add this)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/rl-tracker?retryWrites=true&w=majority
```

### 7. Deploy to Vercel

1. Push your code to GitHub
2. Vercel will automatically deploy
3. Add the `MONGODB_URI` environment variable in your Vercel project settings

## 🎯 What's Working Now

- ✅ **Permanent Storage**: Goals are stored permanently (no 30-day limit!)
- ✅ **Better Performance**: MongoDB queries are faster than Redis for analytics
- ✅ **Scalable**: Can handle unlimited goals and complex queries
- ✅ **Real-time Updates**: Goals appear immediately after scoring
- ✅ **Advanced Analytics**: Better support for complex data analysis

## 📊 Data Structure

Each goal stores:
```json
{
  "_id": "ObjectId",
  "player": "Zach",
  "song": "Song Name",
  "artist": "Artist Name", 
  "timestamp": "2025-01-03T05:20:08.771Z",
  "progress": 6507,
  "sessionId": "default",
  "createdAt": "2025-01-03T05:20:08.771Z"
}
```

## 🔧 Benefits Over Redis

- **No Expiration**: Data never expires
- **Better Queries**: MongoDB aggregation for complex analytics
- **Indexing**: Can create indexes for faster queries
- **Scalability**: Handles large datasets better
- **Backup**: Automatic backups included

## 🐛 Troubleshooting

If goals aren't saving:
1. Check browser console for errors
2. Verify `MONGODB_URI` is set correctly
3. Ensure network access allows connections from anywhere
4. Check database user has read/write permissions

## 📈 Next Steps

With MongoDB, we can now add:
- **Advanced Analytics**: Complex aggregations and insights
- **Data Export**: Download your complete goal history
- **Player Statistics**: Detailed individual performance tracking
- **Song Recommendations**: AI-powered song suggestions
- **Historical Trends**: Long-term performance analysis 