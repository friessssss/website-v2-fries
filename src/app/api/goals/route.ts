import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

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
    
    console.log('Attempting to store goal:', goalData);
    console.log('MongoDB URI exists:', !!process.env.MONGODB_URI);
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('rl-tracker');
    const goalsCollection = db.collection('goals');
    
    console.log('Connected to MongoDB successfully');
    
    // Add creation timestamp
    const goalToStore = {
      ...goalData,
      createdAt: new Date(),
      _id: new ObjectId()
    };
    
    // Store the goal data
    console.log('Storing goal data...');
    const result = await goalsCollection.insertOne(goalToStore);
    
    console.log('Goal stored successfully:', result.insertedId, goalData);
    
    return NextResponse.json({ 
      success: true, 
      goalId: result.insertedId.toString(),
      message: `${goalData.player} scored during ${goalData.song}!`
    });
  } catch (error) {
    console.error('Error storing goal:', error);
    return NextResponse.json(
      { 
        error: 'Failed to store goal',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session') || 'default';
    const limit = parseInt(searchParams.get('limit') || '50');
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('rl-tracker');
    const goalsCollection = db.collection('goals');
    
    // Get recent goals for this session, sorted by timestamp
    const goals = await goalsCollection
      .find({ sessionId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    
    // Convert MongoDB documents to plain objects
    const goalsData = goals.map(goal => ({
      player: goal.player,
      song: goal.song,
      artist: goal.artist,
      timestamp: goal.timestamp,
      progress: goal.progress,
      sessionId: goal.sessionId
    }));
    
    return NextResponse.json({ goals: goalsData });
  } catch (error) {
    console.error('Error retrieving goals:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve goals' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId') || 'default';
    
    console.log('Attempting to remove last goal for session:', sessionId);
    console.log('MongoDB URI exists:', !!process.env.MONGODB_URI);
    
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    
    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db('rl-tracker');
    const goalsCollection = db.collection('goals');
    
    console.log('Connected to MongoDB successfully');
    
    // Find the most recent goal for this session
    const lastGoal = await goalsCollection
      .findOne(
        { sessionId },
        { sort: { timestamp: -1 } }
      );
    
    if (!lastGoal) {
      return NextResponse.json(
        { error: 'No goals found to remove' },
        { status: 404 }
      );
    }
    
    console.log('Removing goal:', lastGoal._id);
    
    // Delete the goal
    await goalsCollection.deleteOne({ _id: lastGoal._id });
    
    console.log('Goal removed successfully:', lastGoal._id);
    
    return NextResponse.json({ 
      success: true, 
      removedGoal: {
        player: lastGoal.player,
        song: lastGoal.song,
        artist: lastGoal.artist,
        timestamp: lastGoal.timestamp,
        progress: lastGoal.progress,
        sessionId: lastGoal.sessionId
      },
      message: `Removed goal: ${lastGoal.player} scored during ${lastGoal.song}`
    });
  } catch (error) {
    console.error('Error removing goal:', error);
    return NextResponse.json(
      { 
        error: 'Failed to remove goal',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 