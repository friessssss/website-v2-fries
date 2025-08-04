import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

interface TimelineGoal {
  timestamp: string;
  player: string;
  song: string;
  artist: string;
  playlist?: string;
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeFilter = searchParams.get('timeFilter') || 'lifetime';
    const playlistFilter = searchParams.get('playlistFilter');
    const groupBy = searchParams.get('groupBy') || 'hour'; // hour, day, week, month
    
    console.log('Fetching timeline with time filter:', timeFilter, 'playlist filter:', playlistFilter, 'group by:', groupBy);
    
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
    
    // Add playlist filter if specified
    if (playlistFilter) {
      dateFilter = { ...dateFilter, playlist: playlistFilter };
    }
    
    // Fetch all goals with the time and playlist filters
    const allGoals = await goalsCollection.find(dateFilter).toArray();
    
    // Convert MongoDB documents to TimelineGoal format
    const validGoals: TimelineGoal[] = allGoals.map(goal => ({
      timestamp: goal.timestamp,
      player: goal.player,
      song: goal.song,
      artist: goal.artist,
      playlist: goal.playlist || undefined,
    }));
    
    if (!validGoals.length) {
      return NextResponse.json({ 
        timeline: [],
        totalGoals: 0
      });
    }
    
    // Sort goals by timestamp
    validGoals.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    // Group goals by time period
    const timelineMap = new Map<string, {
      period: string;
      friendsGoals: number;
      opponentGoals: number;
      totalGoals: number;
      netScore: number;
      playerBreakdown: Map<string, number>;
      songs: string[];
    }>();
    
    validGoals.forEach(goal => {
      const goalDate = new Date(goal.timestamp);
      let periodKey: string;
      
      switch (groupBy) {
        case 'hour':
          periodKey = goalDate.toISOString().slice(0, 13) + ':00:00.000Z'; // YYYY-MM-DDTHH:00:00.000Z
          break;
        case 'day':
          periodKey = goalDate.toISOString().slice(0, 10) + 'T00:00:00.000Z'; // YYYY-MM-DDT00:00:00.000Z
          break;
        case 'week':
          // Get start of week (Sunday)
          const dayOfWeek = goalDate.getDay();
          const startOfWeek = new Date(goalDate);
          startOfWeek.setDate(goalDate.getDate() - dayOfWeek);
          startOfWeek.setHours(0, 0, 0, 0);
          periodKey = startOfWeek.toISOString();
          break;
        case 'month':
          periodKey = goalDate.toISOString().slice(0, 7) + '-01T00:00:00.000Z'; // YYYY-MM-01T00:00:00.000Z
          break;
        default:
          periodKey = goalDate.toISOString().slice(0, 10) + 'T00:00:00.000Z';
      }
      
      if (!timelineMap.has(periodKey)) {
        timelineMap.set(periodKey, {
          period: periodKey,
          friendsGoals: 0,
          opponentGoals: 0,
          totalGoals: 0,
          netScore: 0,
          playerBreakdown: new Map(),
          songs: [],
        });
      }
      
      const periodData = timelineMap.get(periodKey)!;
      periodData.totalGoals++;
      
      // Track unique songs
      const songKey = `${goal.song} - ${goal.artist}`;
      if (!periodData.songs.includes(songKey)) {
        periodData.songs.push(songKey);
      }
      
      // Track goals per player
      const currentPlayerGoals = periodData.playerBreakdown.get(goal.player) || 0;
      periodData.playerBreakdown.set(goal.player, currentPlayerGoals + 1);
      
      if (goal.player === 'Opponent') {
        periodData.opponentGoals++;
      } else {
        periodData.friendsGoals++;
      }
      
      periodData.netScore = periodData.friendsGoals - periodData.opponentGoals;
    });
    
    // Convert to array and sort by period
    const timeline = Array.from(timelineMap.values())
      .map(periodData => ({
        ...periodData,
        playerBreakdown: Array.from(periodData.playerBreakdown.entries())
          .map(([player, goals]) => ({ player, goals }))
          .sort((a, b) => b.goals - a.goals) // Sort by goals descending
      }))
      .sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
    
    console.log(`Timeline: ${timeline.length} periods, ${validGoals.length} total goals`);
    
    return NextResponse.json({
      timeline,
      totalGoals: validGoals.length
    });
  } catch (error) {
    console.error('Error fetching timeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
} 