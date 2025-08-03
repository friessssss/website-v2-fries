'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Bounded from '@/components/Bounded';
import Heading from '@/components/Heading';

interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  isPlaying: boolean;
  timestamp?: string;
  progress?: number;
}

export default function RLTracker() {
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [goalCount, setGoalCount] = useState(0);
  const [sessionId] = useState(() => 'default');
  const [recentGoals, setRecentGoals] = useState<any[]>([]);

    const fetchCurrentTrack = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const response = await fetch('/api/spotify/current-track');
      if (!response.ok) {
        throw new Error('Failed to fetch current track');
      }
      const data = await response.json();
      console.log('Frontend received track data:', data);
      setCurrentTrack(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const fetchRecentGoals = useCallback(async () => {
    try {
      const response = await fetch(`/api/goals?session=${sessionId}&limit=10`);
      if (response.ok) {
        const data = await response.json();
        setRecentGoals(data.goals || []);
      }
    } catch (error) {
      console.error('Error fetching recent goals:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchCurrentTrack();
    fetchRecentGoals();
    // Refresh every 5 seconds for more responsive updates
    const interval = setInterval(fetchCurrentTrack, 5000);
    return () => clearInterval(interval);
  }, [fetchCurrentTrack, fetchRecentGoals]);

  const handleManualRefresh = () => {
    fetchCurrentTrack();
  };

  const formatLastUpdate = (date: Date) => {
    return date.toLocaleTimeString();
  };

  const handleGoal = async (player: string) => {
    const goalData = {
      player,
      song: currentTrack?.name || 'Unknown',
      artist: currentTrack?.artist || 'Unknown',
      timestamp: new Date().toISOString(),
      progress: currentTrack?.progress || 0,
      sessionId,
    };
    
    try {
      const response = await fetch('/api/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(goalData),
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Goal stored successfully:', result);
        setLastGoal(`${player} scored! (${currentTrack?.name})`);
        setGoalCount(prev => prev + 1);
        
        // Refresh recent goals
        fetchRecentGoals();
        
        // Clear the last goal message after 3 seconds
        setTimeout(() => setLastGoal(null), 3000);
      } else {
        const errorData = await response.json();
        console.error('Failed to store goal:', errorData);
        setLastGoal(`Error storing goal for ${player}: ${errorData.details || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error storing goal:', error);
      setLastGoal(`Error storing goal for ${player}`);
    }
  };

  const handleRemoveLastGoal = async () => {
    try {
      const response = await fetch(`/api/goals?sessionId=${sessionId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const result = await response.json();
        console.log('Goal removed successfully:', result);
        setLastGoal(`Removed: ${result.removedGoal?.player} scored during ${result.removedGoal?.song}`);
        setGoalCount(prev => Math.max(0, prev - 1));
        
        // Refresh recent goals
        fetchRecentGoals();
        
        // Clear the message after 3 seconds
        setTimeout(() => setLastGoal(null), 3000);
      } else {
        const errorData = await response.json();
        console.error('Failed to remove goal:', errorData);
        setLastGoal(`Error removing goal: ${errorData.details || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error removing goal:', error);
      setLastGoal('Error removing goal');
    }
  };

  return (
    <Bounded>
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
        <div>
          <Heading size="xl" className="mb-8">
            RL Tracker
          </Heading>
          
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                isRefreshing ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
              }`}></div>
              <span className="text-sm text-gray-600">
                {isRefreshing ? 'Updating...' : 'Auto-refreshing every 5s'}
              </span>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isRefreshing ? 'Updating...' : 'Refresh Now'}
            </button>
          </div>
          
          {lastUpdate && (
            <p className="text-xs text-gray-500 mb-4">
              Last updated: {formatLastUpdate(lastUpdate)}
            </p>
          )}
          
          {loading && (
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span>Loading current track...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800">Error: {error}</p>
              <p className="text-red-600 text-sm mt-2">
                Make sure your Spotify account is connected and you&apos;re currently playing music.
              </p>
            </div>
          )}

          {currentTrack && !loading && (
            <div className={`bg-white rounded-lg shadow-lg p-6 border transition-all duration-300 ${
              isRefreshing ? 'opacity-75' : 'opacity-100'
            }`}>
              <div className="flex items-center space-x-4">
                {currentTrack.albumArt && (
                  <Image 
                    src={currentTrack.albumArt} 
                    alt={`${currentTrack.album} album art`}
                    width={64}
                    height={64}
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {currentTrack.name}
                  </h3>
                  <p className="text-gray-600">{currentTrack.artist}</p>
                  <p className="text-sm text-gray-500">{currentTrack.album}</p>
                  <div className="flex items-center mt-2">
                    <div className={`w-2 h-2 rounded-full mr-2 ${
                      currentTrack.isPlaying ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                    }`}></div>
                    <span className="text-sm text-gray-600">
                      {currentTrack.isPlaying ? 'Now Playing' : 'Paused'}
                    </span>
                  </div>
                  {currentTrack.timestamp && (
                    <div className="mt-2 text-xs text-gray-500">
                      <div>API Time: {new Date(currentTrack.timestamp).toLocaleTimeString()}</div>
                      {currentTrack.progress && (
                        <div>Progress: {Math.floor(currentTrack.progress / 1000)}s</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Goal Tracking Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 border mt-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">Goal Tracking</h3>
          
          {lastGoal && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-medium">🎉 {lastGoal}</p>
            </div>
          )}
          
          <div className="mb-4">
            <p className="text-sm text-gray-600 mb-2">Goals tracked this session: {goalCount}</p>
          </div>

          {/* Opponent Goal Button */}
          <div className="mb-6">
            <button
              onClick={() => handleGoal('Opponent')}
              className="w-full py-3 px-4 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors duration-200 shadow-md"
            >
              🚨 OPPONENT SCORED
            </button>
          </div>

          {/* Player Goal Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleGoal('Vandy')}
              className="py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200 shadow-md"
            >
              Vandy ⚽
            </button>
            <button
              onClick={() => handleGoal('Ashton')}
              className="py-3 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors duration-200 shadow-md"
            >
              Ashton ⚽
            </button>
            <button
              onClick={() => handleGoal('Sam')}
              className="py-3 px-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors duration-200 shadow-md"
            >
              Sam ⚽
            </button>
            <button
              onClick={() => handleGoal('Mason')}
              className="py-3 px-4 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition-colors duration-200 shadow-md"
            >
              Mason ⚽
            </button>
            <button
              onClick={() => handleGoal('Jake')}
              className="py-3 px-4 bg-teal-600 text-white font-semibold rounded-lg hover:bg-teal-700 transition-colors duration-200 shadow-md"
            >
              Jake ⚽
            </button>
            <button
              onClick={() => handleGoal('Zach')}
              className="py-3 px-4 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors duration-200 shadow-md"
            >
              Zach ⚽
            </button>
          </div>

          {/* Remove Last Goal Button */}
          <div className="mt-4">
            <button
              onClick={handleRemoveLastGoal}
              disabled={goalCount === 0}
              className="w-full py-3 px-4 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 shadow-md"
            >
              🗑️ Remove Last Goal
            </button>
          </div>
        </div>

        {/* Recent Goals Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 border mt-6">
          <h3 className="text-xl font-semibold mb-4 text-gray-900">Recent Goals</h3>
          
          {recentGoals.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No goals recorded yet. Score some goals to see them here!</p>
          ) : (
            <div className="space-y-3">
              {recentGoals.slice(0, 5).map((goal, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                      {goal.player.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{goal.player}</p>
                      <p className="text-sm text-gray-600">{goal.song} - {goal.artist}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      {new Date(goal.timestamp).toLocaleTimeString()}
                    </p>
                    <p className="text-xs text-gray-400">
                      {Math.floor(goal.progress / 1000)}s into song
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">How it works</h3>
          <ul className="space-y-2 text-gray-600">
            <li>• Connect your Spotify account</li>
            <li>• Start playing music</li>
            <li>• Play Rocket League</li>
            <li>• Track goals scored during each song</li>
            <li>• Analyze which songs bring the most goals!</li>
          </ul>
        </div>
      </div>
    </Bounded>
  );
} 