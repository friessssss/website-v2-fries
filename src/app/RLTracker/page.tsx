'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import Image from 'next/image';
import Bounded from '@/components/Bounded';
import Heading from '@/components/Heading';
import FriendNavBar from '@/components/FriendNavBar';
import Toast from '@/components/Toast';
import { useSearchParams } from 'next/navigation';

interface SpotifyTrack {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  isPlaying: boolean;
  timestamp?: string;
  progress?: number;
  playlist?: {
    id: string;
    name: string;
    description: string;
    images: any[];
  } | null;
}

function RLTrackerContent() {
  const searchParams = useSearchParams();
  const [currentTrack, setCurrentTrack] = useState<SpotifyTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastGoal, setLastGoal] = useState<string | null>(null);
  const [goalCount, setGoalCount] = useState(0);
  const [sessionId] = useState(() => 'default');
  const [recentGoals, setRecentGoals] = useState<any[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);

    const fetchCurrentTrack = useCallback(async () => {
    try {
      setIsRefreshing(true);
      console.log('Frontend: Fetching current track...');
      
      const response = await fetch('/api/spotify/current-track');
      console.log('Frontend: Response status:', response.status);
      
      const data = await response.json();
      console.log('Frontend: Response data:', data);
      
      if (!response.ok) {
        if (data.needsAuth) {
          console.log('Frontend: Needs authentication');
          setIsAuthenticated(false);
          setError('Please connect your Spotify account to start tracking');
          return;
        }
        throw new Error(data.message || 'Failed to fetch current track');
      }
      
      console.log('Frontend: Successfully received track data:', data);
      setCurrentTrack(data);
      setLastUpdate(new Date());
      setError(null);
      setIsAuthenticated(true);
    } catch (err) {
      console.error('Frontend: Error fetching track:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const refreshAllData = useCallback(async () => {
    try {
      setIsRefreshing(true);
      console.log('Frontend: Refreshing all data...');
      
      // Fetch both current track and recent goals simultaneously
      const [trackResponse, goalsResponse] = await Promise.all([
        fetch('/api/spotify/current-track'),
        fetch(`/api/goals?session=${sessionId}&limit=10`)
      ]);
      
      console.log('Frontend: Track response status:', trackResponse.status);
      console.log('Frontend: Goals response status:', goalsResponse.status);
      
      const trackData = await trackResponse.json();
      const goalsData = await goalsResponse.json();
      
      console.log('Frontend: Track data:', trackData);
      console.log('Frontend: Goals data:', goalsData);
      
      if (!trackResponse.ok) {
        if (trackData.needsAuth) {
          console.log('Frontend: Needs authentication');
          setIsAuthenticated(false);
          setError('Please connect your Spotify account to start tracking');
          return;
        }
        throw new Error(trackData.message || 'Failed to fetch current track');
      }
      
      if (!goalsResponse.ok) {
        console.error('Frontend: Failed to fetch goals:', goalsData);
      }
      
      console.log('Frontend: Successfully received all data');
      setCurrentTrack(trackData);
      setRecentGoals(goalsData.goals || []);
      setLastUpdate(new Date());
      setError(null);
      setIsAuthenticated(true);
    } catch (err) {
      console.error('Frontend: Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [sessionId]);

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

  // Handle URL parameters for OAuth callback
  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const message = searchParams.get('message');

    if (success === 'true') {
      setShowToast(true);
      setToastMessage('✅ Spotify connected successfully!');
      setIsAuthenticated(true);
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (error) {
      setShowToast(true);
      setToastMessage(`❌ ${message || 'Failed to connect Spotify'}`);
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [searchParams]);

  useEffect(() => {
    refreshAllData();
    // Refresh every 20 seconds to reduce token usage and improve stability
    const interval = setInterval(refreshAllData, 20000);
    return () => clearInterval(interval);
  }, [refreshAllData]);

  const connectSpotify = () => {
    const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || 'your-client-id';
    const redirectUri = process.env.NODE_ENV === 'production' 
      ? 'https://zachrobertson.co/api/spotify/callback'
      : 'http://localhost:3000/api/spotify/callback';
    
    // More comprehensive scopes to ensure we get all needed permissions
    const scopes = [
      'user-read-currently-playing',
      'user-read-playback-state',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-read-private',
      'user-read-email',
      'user-read-playback-position'
    ];

    // Add state parameter for security and better tracking
    const state = Math.random().toString(36).substring(7);
    
    // show_dialog=true forces Spotify to show the authorization dialog even if previously authorized
    // This ensures users can grant permissions again if they previously denied some
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes.join('%20')}&state=${state}&show_dialog=true`;
    
    // Store state in sessionStorage for verification
    sessionStorage.setItem('spotify_auth_state', state);
    
    window.location.href = authUrl;
  };

  const handleManualRefresh = () => {
    refreshAllData();
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
      playlist: currentTrack?.playlist?.name || null,
      playlistId: currentTrack?.playlist?.id || null,
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
        const message = `${player} scored! (${currentTrack?.name})`;
        setToastMessage(message);
        setShowToast(true);
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
    <>
      <Toast 
        message={toastMessage} 
        isVisible={showToast} 
        onClose={() => setShowToast(false)} 
      />
      <FriendNavBar />
      <Bounded>
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
        <div className={`transition-opacity duration-1000 ${isRefreshing ? 'opacity-80' : 'opacity-100'}`}>
          <Heading size="xl" className="mb-8">
            RL Tracker
          </Heading>
          
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${
                isRefreshing ? 'bg-[#c3ff41] animate-pulse' : 'bg-[#c3ff41]'
              }`}></div>
              <span className="text-sm text-white/70">
                {isRefreshing ? 'Updating...' : 'Auto-refreshing every 20s'}
              </span>
            </div>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="px-4 py-2 glass-panel border border-white/8 text-[#f5f8f1] rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors duration-200"
            >
              {isRefreshing ? 'Updating...' : 'Refresh Now'}
            </button>
          </div>
          
          {lastUpdate && (
            <p className="text-xs text-white/50 mb-4">
              Last updated: {formatLastUpdate(lastUpdate)}
            </p>
          )}
          
          {loading && (
            <div className="flex items-center space-x-2 text-white/70">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#c3ff41]"></div>
              <span>Loading current track...</span>
            </div>
          )}

          {!isAuthenticated && (
            <div className="glass-panel border border-white/8 rounded-lg p-8 text-center">
              <div className="mb-6">
                <div className="text-6xl mb-4">🎵</div>
                <h3 className="text-2xl font-semibold text-[#f5f8f1] mb-2">
                  Connect Your Spotify Account
                </h3>
                <p className="text-white/70 mb-6">
                  Connect your Spotify account to automatically track which song is playing when goals are scored!
                </p>
              </div>
              
              <div className="glass-panel border border-white/8 rounded-lg p-4 mb-6 text-left">
                <h4 className="font-semibold text-[#f5f8f1] mb-2">📋 Before You Connect:</h4>
                <ul className="text-sm text-white/70 space-y-1">
                  <li>• Make sure you have <strong>Spotify Premium</strong> (recommended)</li>
                  <li>• Have music <strong>currently playing</strong> on your Spotify account</li>
                  <li>• Grant <strong>ALL requested permissions</strong> when prompted</li>
                  <li>• If you see &quot;Access Denied&quot;, try reconnecting</li>
                </ul>
              </div>
              
              <button
                onClick={connectSpotify}
                className="bg-[#c3ff41] hover:bg-[#b0e639] text-[#070b05] font-semibold py-4 px-8 rounded-lg text-lg transition-colors duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
              >
                🎵 Connect Spotify Account
              </button>
              
              <p className="text-sm text-white/50 mt-4">
                You&apos;ll be redirected to Spotify to authorize this app
              </p>
            </div>
          )}

          {error && isAuthenticated && (
            <div className="glass-panel border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400">Error: {error}</p>
              <div className="mt-3">
                <p className="text-red-300/80 text-sm mb-2">
                  {error.includes('Insufficient permissions') 
                    ? 'Your Spotify account needs additional permissions to read your currently playing track. This usually happens with free Spotify accounts or when certain permissions are restricted.'
                    : 'There was an issue with your Spotify connection.'
                  }
                </p>
                <div className="space-y-2">
                  <button
                    onClick={connectSpotify}
                    className="inline-block bg-[#c3ff41] text-[#070b05] px-4 py-2 rounded-lg hover:bg-[#b0e639] transition-colors duration-200 text-sm mr-2 font-semibold"
                  >
                    🔄 Reconnect Spotify
                  </button>
                  {error.includes('Insufficient permissions') && (
                    <div className="text-xs text-white/60 mt-2">
                      <p><strong>Note:</strong> Make sure you&apos;re using a Spotify Premium account and grant all requested permissions during authorization.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentTrack && !loading && isAuthenticated && (
            <div className={`glass-panel border border-white/8 rounded-lg p-6 transition-opacity duration-1000 ${
              isRefreshing ? 'opacity-85' : 'opacity-100'
            }`}>
              <div className="flex items-center space-x-4">
                {currentTrack.albumArt && (
                  <Image 
                    src={currentTrack.albumArt} 
                    alt={`${currentTrack.album} album art`}
                    width={144}
                    height={144}
                    className="w-36 h-36 rounded-lg object-cover"
                  />
                )}
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-[#f5f8f1]">
                    {currentTrack.name}
                  </h3>
                  <p className="text-white/70">{currentTrack.artist}</p>
                  <p className="text-sm text-white/50">{currentTrack.album}</p>
                  {currentTrack.playlist && (
                    <p className="text-sm text-[#c3ff41] font-medium">📜 {currentTrack.playlist.name}</p>
                  )}
                  <div className="flex items-center mt-2">
                    <div className={`w-2 h-2 rounded-full mr-2 ${
                      currentTrack.isPlaying ? 'bg-[#c3ff41] animate-pulse' : 'bg-white/40'
                    }`}></div>
                    <span className="text-sm text-white/70">
                      {currentTrack.isPlaying ? 'Now Playing' : 'Paused'}
                    </span>
                  </div>
                  {currentTrack.timestamp && (
                    <div className="mt-2 text-xs text-white/50">
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
        {isAuthenticated && (
          <div className={`glass-panel border border-white/8 rounded-lg p-6 mt-6 transition-opacity duration-1000 ${isRefreshing ? 'opacity-80' : 'opacity-100'}`}>
            <h3 className="text-xl font-semibold mb-4 text-[#f5f8f1]">Goal Tracking</h3>
            
            <div className="mb-4">
              <p className="text-sm text-white/70 mb-2">Goals tracked this session: {goalCount}</p>
            </div>

          {/* Opponent Goal Button */}
          <div className="mb-6">
            <button
              onClick={() => handleGoal('Opponent')}
              className="w-full py-3 px-4 bg-red-500/20 border border-red-500/40 text-red-300 font-semibold rounded-lg hover:bg-red-500/30 transition-colors duration-200"
            >
              🚨 OPPONENT SCORED
            </button>
          </div>

          {/* Player Goal Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleGoal('Vandy')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Vandy ⚽
            </button>
            <button
              onClick={() => handleGoal('Ashton')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Ashton ⚽
            </button>
            <button
              onClick={() => handleGoal('Sam')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Sam ⚽
            </button>
            <button
              onClick={() => handleGoal('Mason')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Mason ⚽
            </button>
            <button
              onClick={() => handleGoal('Jake')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Jake ⚽
            </button>
            <button
              onClick={() => handleGoal('Zach')}
              className="py-3 px-4 glass-panel border border-white/8 text-[#f5f8f1] font-semibold rounded-lg hover:bg-white/5 transition-colors duration-200"
            >
              Zach ⚽
            </button>
          </div>

          {/* Remove Last Goal Button */}
          <div className="mt-4">
            <button
              onClick={handleRemoveLastGoal}
              disabled={goalCount === 0}
              className="w-full py-3 px-4 glass-panel border border-white/8 text-white/60 font-semibold rounded-lg hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              🗑️ Remove Last Goal
            </button>
          </div>
        </div>
        )}

        {/* Recent Goals Section */}
        {isAuthenticated && (
          <div className={`glass-panel border border-white/8 rounded-lg p-6 mt-6 transition-opacity duration-1000 ${isRefreshing ? 'opacity-80' : 'opacity-100'}`}>
            <h3 className="text-xl font-semibold mb-4 text-[#f5f8f1]">Recent Goals</h3>
            
            {recentGoals.length === 0 ? (
              <p className="text-white/50 text-center py-4">No goals recorded yet. Score some goals to see them here!</p>
            ) : (
              <div className="space-y-3">
                {recentGoals.slice(0, 5).map((goal, index) => (
                  <div key={index} className="flex items-center justify-between p-3 glass-panel border border-white/8 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-[#c3ff41] text-[#070b05] rounded-full flex items-center justify-center text-sm font-bold">
                        {goal.player.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-[#f5f8f1]">{goal.player}</p>
                        <p className="text-sm text-white/70">{goal.song} - {goal.artist}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/50">
                        {new Date(goal.timestamp).toLocaleTimeString()}
                      </p>
                      <p className="text-xs text-white/40">
                        {Math.floor(goal.progress / 1000)}s into song
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
              </div>
      </Bounded>
    </>
  );
}

export default function RLTracker() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RLTrackerContent />
    </Suspense>
  );
} 