import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

interface GoalData {
  player: string;
  song: string;
  artist: string;
  timestamp: string;
  progress: number;
  sessionId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const goalData: GoalData = await request.json();
    
    // Create Redis client
    const client = createClient({
      url: process.env.REDIS_URL,
    });
    
    await client.connect();
    
    // Generate a unique key for this goal
    const goalKey = `goal:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    
    // Store the goal data
    await client.setEx(goalKey, 60 * 60 * 24 * 30, JSON.stringify(goalData)); // Expire in 30 days
    
    // Also store in a session list for easy retrieval
    const sessionId = goalData.sessionId || 'default';
    await client.lPush(`session:${sessionId}:goals`, goalKey);
    
    await client.disconnect();
    
    console.log('Goal stored:', goalKey, goalData);
    
    return NextResponse.json({ 
      success: true, 
      goalId: goalKey,
      message: `${goalData.player} scored during ${goalData.song}!`
    });
  } catch (error) {
    console.error('Error storing goal:', error);
    return NextResponse.json(
      { error: 'Failed to store goal' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session') || 'default';
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Create Redis client
    const client = createClient({
      url: process.env.REDIS_URL,
    });
    
    await client.connect();
    
    // Get recent goals for this session
    const goalKeys = await client.lRange(`session:${sessionId}:goals`, 0, limit - 1);
    
    if (!goalKeys.length) {
      await client.disconnect();
      return NextResponse.json({ goals: [] });
    }
    
    // Fetch all goal data
    const goals = await Promise.all(
      goalKeys.map(async (key) => {
        const goalData = await client.get(key);
        return goalData ? JSON.parse(goalData) : null;
      })
    );
    
    await client.disconnect();
    
    // Filter out any null values and sort by timestamp
    const validGoals = goals
      .filter(goal => goal !== null)
      .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return NextResponse.json({ goals: validGoals });
  } catch (error) {
    console.error('Error retrieving goals:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve goals' },
      { status: 500 }
    );
  }
} 