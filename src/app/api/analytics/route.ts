import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

interface GoalData {
  player: string;
  song: string;
  artist: string;
  timestamp: string;
  progress: number;
  sessionId?: string;
}

interface PlayerGoals {
  player: string;
  goals: number;
}

interface SongAnalytics {
  song: string;
  artist: string;
  friendsGoals: number;
  opponentGoals: number;
  totalGoals: number;
  netScore: number; // friendsGoals - opponentGoals
  playerBreakdown: PlayerGoals[];
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'lifetime';
    
    console.log('Fetching analytics with time filter:', timeFilter);
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('rl-tracker');
    const goalsCollection = db.collection('goals');
    
    // Build date filter for MongoDB
    let dateFilter = {};
    const now = new Date();
    
    switch (timeFilter) {
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFilter = { timestamp: { $gte: weekAgo.toISOString() } };
        break;
      case 'month':
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateFilter = { timestamp: { $gte: monthAgo.toISOString() } };
        break;
      case '3months':
        const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        dateFilter = { timestamp: { $gte: threeMonthsAgo.toISOString() } };
        break;
      case 'year':
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        dateFilter = { timestamp: { $gte: yearAgo.toISOString() } };
        break;
      case 'lifetime':
      default:
        // No date filtering, get all goals
        dateFilter = {};
        break;
    }
    
    // Fetch all goals with the time filter
    const allGoals = await goalsCollection.find(dateFilter).toArray();
    
    // Convert MongoDB documents to GoalData format
    const validGoals: GoalData[] = allGoals.map(goal => ({
      player: goal.player,
      song: goal.song,
      artist: goal.artist,
      timestamp: goal.timestamp,
      progress: goal.progress,
      sessionId: goal.sessionId
    }));
    
    if (!validGoals.length) {
      return NextResponse.json({ 
        songs: [],
        artists: [],
        totalFriendsGoals: 0,
        totalOpponentGoals: 0,
        totalSongs: 0,
        totalArtists: 0
      });
    }
    
    // Group goals by song
    const songMap = new Map<string, {
      song: string;
      artist: string;
      friendsGoals: number;
      opponentGoals: number;
      totalGoals: number;
      netScore: number;
      playerBreakdown: Map<string, number>;
    }>();
    
    validGoals.forEach(goal => {
      const songKey = `${goal.song} - ${goal.artist}`;
      
      if (!songMap.has(songKey)) {
        songMap.set(songKey, {
          song: goal.song,
          artist: goal.artist,
          friendsGoals: 0,
          opponentGoals: 0,
          totalGoals: 0,
          netScore: 0,
          playerBreakdown: new Map(),
        });
      }
      
      const songData = songMap.get(songKey)!;
      songData.totalGoals++;
      
      // Track goals per player
      const currentPlayerGoals = songData.playerBreakdown.get(goal.player) || 0;
      songData.playerBreakdown.set(goal.player, currentPlayerGoals + 1);
      
      if (goal.player === 'Opponent') {
        songData.opponentGoals++;
      } else {
        songData.friendsGoals++;
      }
      
      songData.netScore = songData.friendsGoals - songData.opponentGoals;
    });
    
    // Convert to array and sort by total goals (descending)
    const songs = Array.from(songMap.values())
      .map(songData => ({
        ...songData,
        playerBreakdown: Array.from(songData.playerBreakdown.entries())
          .map(([player, goals]) => ({ player, goals }))
          .sort((a, b) => b.goals - a.goals) // Sort by goals descending
      }))
      .sort((a, b) => b.totalGoals - a.totalGoals);
    
    // Group goals by artist
    const artistMap = new Map<string, {
      artist: string;
      friendsGoals: number;
      opponentGoals: number;
      totalGoals: number;
      netScore: number;
      playerBreakdown: Map<string, number>;
      songs: string[];
    }>();
    
    validGoals.forEach(goal => {
      if (!artistMap.has(goal.artist)) {
        artistMap.set(goal.artist, {
          artist: goal.artist,
          friendsGoals: 0,
          opponentGoals: 0,
          totalGoals: 0,
          netScore: 0,
          playerBreakdown: new Map(),
          songs: [],
        });
      }
      
      const artistData = artistMap.get(goal.artist)!;
      artistData.totalGoals++;
      
      // Track unique songs
      if (!artistData.songs.includes(goal.song)) {
        artistData.songs.push(goal.song);
      }
      
      // Track goals per player
      const currentPlayerGoals = artistData.playerBreakdown.get(goal.player) || 0;
      artistData.playerBreakdown.set(goal.player, currentPlayerGoals + 1);
      
      if (goal.player === 'Opponent') {
        artistData.opponentGoals++;
      } else {
        artistData.friendsGoals++;
      }
      
      artistData.netScore = artistData.friendsGoals - artistData.opponentGoals;
    });
    
    // Convert artist data to array
    const artists = Array.from(artistMap.values())
      .map(artistData => ({
        ...artistData,
        playerBreakdown: Array.from(artistData.playerBreakdown.entries())
          .map(([player, goals]) => ({ player, goals }))
          .sort((a, b) => b.goals - a.goals) // Sort by goals descending
      }))
      .sort((a, b) => b.totalGoals - a.totalGoals);
    
    // Calculate totals
    const totalFriendsGoals = songs.reduce((sum, song) => sum + song.friendsGoals, 0);
    const totalOpponentGoals = songs.reduce((sum, song) => sum + song.opponentGoals, 0);
    
    console.log(`Analytics: ${songs.length} songs, ${artists.length} artists, ${totalFriendsGoals} friends goals, ${totalOpponentGoals} opponent goals`);
    
    return NextResponse.json({
      songs,
      artists,
      totalFriendsGoals,
      totalOpponentGoals,
      totalSongs: songs.length,
      totalArtists: artists.length
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
} 