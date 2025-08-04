'use client';

import { useState, useCallback, useEffect } from 'react';
import Heading from '@/components/Heading';
import FriendNavBar from '@/components/FriendNavBar';

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
  netScore: number;
  playerBreakdown: PlayerGoals[];
  playlist?: string;
}

interface ArtistAnalytics {
  artist: string;
  friendsGoals: number;
  opponentGoals: number;
  totalGoals: number;
  netScore: number;
  playerBreakdown: PlayerGoals[];
  songs: string[];
}

interface AnalyticsData {
  songs: SongAnalytics[];
  artists: ArtistAnalytics[];
  totalFriendsGoals: number;
  totalOpponentGoals: number;
  totalSongs: number;
  totalArtists: number;
}

export default function SongsPage() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState('lifetime');
  const [playlistFilter, setPlaylistFilter] = useState<string>('');
  const [availablePlaylists, setAvailablePlaylists] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'songs' | 'artists'>('songs');

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      params.append('timeFilter', timeFilter);
      if (playlistFilter) {
        params.append('playlistFilter', playlistFilter);
      }
      
      console.log('Fetching analytics from:', `/api/analytics?${params.toString()}`);
      const response = await fetch(`/api/analytics?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch analytics data: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Analytics data received:', data);
      setAnalyticsData(data);
    } catch (err) {
      console.error('Error fetching analytics:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeFilter, playlistFilter]);

  // Function to fetch available playlists
  const fetchAvailablePlaylists = useCallback(async () => {
    try {
      const response = await fetch('/api/analytics?timeFilter=lifetime');
      if (response.ok) {
        const data = await response.json();
        // Extract unique playlists from the data
        const playlists = new Set<string>();
        data.songs.forEach((song: any) => {
          if (song.playlist) {
            playlists.add(song.playlist);
          }
        });
        setAvailablePlaylists(Array.from(playlists).sort());
      }
    } catch (error) {
      console.error('Error fetching playlists:', error);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  useEffect(() => {
    fetchAvailablePlaylists();
  }, [fetchAvailablePlaylists]);

  // Function to clean song names by removing parenthetical sections
  const cleanSongName = (songName: string) => {
    return songName.replace(/\s*\([^)]*\)/g, '').trim();
  };

  // Player colors for the chart - muted colors for friends, red for opponent
  const playerColors = {
    'Vandy': '#6366F1', // Muted Indigo
    'Ashton': '#10B981', // Muted Green
    'Sam': '#F59E0B', // Muted Amber
    'Mason': '#8B5CF6', // Muted Purple
    'Jake': '#EC4899', // Muted Pink
    'Zach': '#06B6D4', // Muted Cyan
    'Opponent': '#DC2626', // Red
  };

  if (loading) {
    return (
      <>
        <FriendNavBar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-lg font-semibold text-gray-600">Loading song data...</div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <FriendNavBar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-lg font-semibold text-red-600">Error: {error}</div>
          </div>
        </div>
      </>
    );
  }

  if (!analyticsData) {
    return (
      <>
        <FriendNavBar />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-lg font-semibold text-gray-600">No data available</div>
          </div>
        </div>
      </>
    );
  }

  // Sort data by net score (goal differential) in descending order
  const sortedData = viewMode === 'songs' 
    ? [...analyticsData.songs].sort((a, b) => b.netScore - a.netScore)
    : [...analyticsData.artists].sort((a, b) => b.netScore - a.netScore);

  return (
    <>
      {/* Navigation at the top */}
      <FriendNavBar />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Header */}
          <div className="text-center">
            <Heading size="xl" className="mb-4">
              All {viewMode === 'songs' ? 'Songs' : 'Artists'} by Goal Differential
            </Heading>
            <p className="text-gray-600 max-w-2xl mx-auto">
              View all {viewMode === 'songs' ? 'songs' : 'artists'} ranked by their goal differential
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center gap-4">
            <div>
              <label htmlFor="timeFilter" className="block text-sm font-medium text-gray-700 mb-1">
                Time Period
              </label>
              <select
                id="timeFilter"
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="lifetime">Lifetime</option>
                <option value="year">Last Year</option>
                <option value="3months">Last 3 Months</option>
                <option value="month">Last Month</option>
                <option value="week">Last Week</option>
              </select>
            </div>
            
            <div>
              <label htmlFor="viewMode" className="block text-sm font-medium text-gray-700 mb-1">
                View Mode
              </label>
              <select
                id="viewMode"
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as 'songs' | 'artists')}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="songs">Songs</option>
                <option value="artists">Artists</option>
              </select>
            </div>
            
            <div>
              <label htmlFor="playlistFilter" className="block text-sm font-medium text-gray-700 mb-1">
                Playlist Filter
              </label>
              <select
                id="playlistFilter"
                value={playlistFilter}
                onChange={(e) => setPlaylistFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Playlists</option>
                {availablePlaylists.map((playlist) => (
                  <option key={playlist} value={playlist}>
                    {playlist}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-sm text-gray-600">
            Showing {sortedData.length} {viewMode === 'songs' ? 'songs' : 'artists'}
          </div>
        </div>

        {/* Data List */}
        <div className="space-y-4">
          {sortedData.map((item, index) => (
                         <div 
               key={viewMode === 'songs' ? `${(item as SongAnalytics).song}-${item.artist}` : item.artist} 
               className="bg-white rounded-lg shadow-lg p-4 border hover:shadow-xl transition-shadow duration-200 relative overflow-hidden"
             >
               {/* Background tint overlay */}
               <div 
                 className="absolute inset-0 pointer-events-none"
                 style={{
                   backgroundColor: item.netScore > 0 
                     ? `rgba(34, 197, 94, ${Math.min(item.netScore * 0.08, 0.5)})` // Green tint, max 50% opacity
                     : item.netScore < 0 
                     ? `rgba(239, 68, 68, ${Math.min(Math.abs(item.netScore) * 0.08, 0.5)})` // Red tint, max 50% opacity
                     : 'transparent' // No tint for 0
                 }}
               />
               
               {/* Content */}
               <div className="relative z-10">
               <div className="flex items-center justify-between">
                 <div className="flex items-center space-x-4">
                   <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                     index < 3 ? 'bg-yellow-500' : 
                     index < 10 ? 'bg-gray-400' : 'bg-gray-300'
                   }`}>
                     {index + 1}
                   </div>
                   <div className="flex-1">
                     <div className="font-semibold text-lg text-gray-800">
                       {viewMode === 'songs' ? cleanSongName((item as SongAnalytics).song) : item.artist}
                     </div>
                     <div className="text-gray-600">
                       {viewMode === 'songs' ? item.artist : `${(item as ArtistAnalytics).songs.length} songs`}
                     </div>
                   </div>
                 </div>
                 
                 <div className="flex items-center space-x-6">
                   {/* Individual Player Contributions */}
                   <div className="flex items-center space-x-6">
                     {['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'].map(player => {
                       const playerData = item.playerBreakdown?.find((p: any) => p.player === player);
                       const goals = playerData?.goals || 0;
                       if (goals === 0) return null;
                       return (
                         <div key={player} className="text-center px-3">
                           <div className="text-sm text-gray-500">{player}</div>
                           <div
                             className="font-semibold"
                             style={{ color: playerColors[player as keyof typeof playerColors] }}
                           >
                             {goals}
                           </div>
                         </div>
                       );
                     })}
                   </div>

                   <div className="flex items-center space-x-6">
                     {/* Opponents */}
                     <div className="text-center px-3">
                       <div className="text-sm text-gray-500">Opponents</div>
                       <div className="font-semibold text-red-600">{item.opponentGoals}</div>
                     </div>
                     
                     {/* Total Goals */}
                     <div className="text-center px-3">
                       <div className="text-sm text-gray-500">Total Goals</div>
                       <div className="font-semibold text-gray-800">{item.totalGoals}</div>
                     </div>
                     
                     {/* Net Score */}
                     <div className="text-center px-3">
                       <div className="text-sm text-gray-500">Net Score</div>
                       <div className={`text-xl font-bold ${
                         item.netScore > 0 ? 'text-green-600' : 
                         item.netScore < 0 ? 'text-red-600' : 'text-gray-600'
                       }`}>
                         {item.netScore > 0 ? '+' : ''}{item.netScore}
                       </div>
                     </div>
                   </div>
                 </div>
               </div>
               </div>
             </div>
          ))}
        </div>

        {sortedData.length === 0 && (
          <div className="text-center py-12">
            <div className="text-lg font-semibold text-gray-600 mb-2">No {viewMode === 'songs' ? 'songs' : 'artists'} found</div>
            <div className="text-gray-500">Try adjusting your filters to see more results.</div>
          </div>
        )}
        </div>
      </div>
    </>
  );
} 