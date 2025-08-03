'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import Bounded from '@/components/Bounded';
import Heading from '@/components/Heading';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

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

export default function Analytics() {
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState('lifetime');
  const [viewMode, setViewMode] = useState<'songs' | 'artists'>('songs');

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('Fetching analytics from:', `/api/analytics?timeFilter=${timeFilter}`);
      const response = await fetch(`/api/analytics?timeFilter=${timeFilter}`);
      
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Response error text:', errorText);
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
  }, [timeFilter]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

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

  // Create datasets for each player
  const createPlayerDatasets = () => {
    const friends = ['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'];
    const datasets: any[] = [];
    
    // Create datasets for friends (positive values)
    friends.forEach(player => {
      const data = analyticsData?.songs.slice(0, 20).map(song => {
        const playerData = song.playerBreakdown?.find(p => p.player === player);
        return playerData ? playerData.goals : 0;
      }) || [];
      
      // Only include datasets that have at least one non-zero value
      if (data.some(value => value !== 0)) {
        datasets.push({
          label: player,
          data: data,
          backgroundColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderWidth: 1,
          stack: 'Friends',
        });
      }
    });
    
    // Create dataset for opponents (separate bar)
    const opponentData = analyticsData?.songs.slice(0, 20).map(song => {
      const playerData = song.playerBreakdown?.find(p => p.player === 'Opponent');
      return playerData ? playerData.goals : 0;
    }) || [];
    
    if (opponentData.some(value => value !== 0)) {
      datasets.push({
        label: 'Opponent',
        data: opponentData,
        backgroundColor: playerColors['Opponent'],
        borderColor: playerColors['Opponent'],
        borderWidth: 1,
        stack: 'Opponents',
      });
    }
    
    return datasets;
  };

  // Create datasets for artists
  const createArtistDatasets = () => {
    const friends = ['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'];
    const datasets: any[] = [];
    
    // Create datasets for friends (positive values)
    friends.forEach(player => {
      const data = analyticsData?.artists.slice(0, 20).map(artist => {
        const playerData = artist.playerBreakdown?.find(p => p.player === player);
        return playerData ? playerData.goals : 0;
      }) || [];
      
      // Only include datasets that have at least one non-zero value
      if (data.some(value => value !== 0)) {
        datasets.push({
          label: player,
          data: data,
          backgroundColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderWidth: 1,
          stack: 'Friends',
        });
      }
    });
    
    // Create dataset for opponents (separate bar)
    const opponentData = analyticsData?.artists.slice(0, 20).map(artist => {
      const playerData = artist.playerBreakdown?.find(p => p.player === 'Opponent');
      return playerData ? playerData.goals : 0;
    }) || [];
    
    if (opponentData.some(value => value !== 0)) {
      datasets.push({
        label: 'Opponent',
        data: opponentData,
        backgroundColor: playerColors['Opponent'],
        borderColor: playerColors['Opponent'],
        borderWidth: 1,
        stack: 'Opponents',
      });
    }
    
    return datasets;
  };

  // Prepare chart data based on view mode
  const chartData = viewMode === 'songs' ? {
    labels: analyticsData?.songs.slice(0, 20).map(song => 
      `${cleanSongName(song.song)} - ${song.artist}`
    ) || [],
    datasets: createPlayerDatasets(),
  } : {
    labels: analyticsData?.artists.slice(0, 20).map(artist => 
      `${artist.artist} (${artist.songs.length} songs)`
    ) || [],
    datasets: createArtistDatasets(),
  };

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          padding: 20,
        },
      },
      title: {
        display: true,
        text: viewMode === 'songs' ? 'Goals per Song - Science Team vs Opponents' : 'Goals per Artist - Science Team vs Opponents',
        font: {
          size: 16,
          weight: 'bold',
        },
        padding: 20,
      },
      tooltip: {
        enabled: false, // Disable tooltips completely
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: {
          maxRotation: 45,
          minRotation: 45,
          font: {
            size: 10,
          },
        },
      },
      y: {
        stacked: true,
        title: {
          display: true,
          text: 'Goals',
        },
        ticks: {
          callback: function(value) {
            return Math.abs(Number(value));
          },
        },
        // Start at zero for cleaner display
        beginAtZero: true,
        grid: {
          color: '#E5E7EB',
          lineWidth: 1,
        },
      },
    },
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
  };

  if (loading) {
    return (
      <Bounded>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="flex items-center space-x-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span>Loading analytics...</span>
          </div>
        </div>
      </Bounded>
    );
  }

  if (error) {
    return (
      <Bounded>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-red-800 font-semibold mb-2">Error Loading Analytics</h2>
          <p className="text-red-600">{error}</p>
          <button
            onClick={fetchAnalytics}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </Bounded>
    );
  }

  if (!analyticsData || analyticsData.songs.length === 0) {
    return (
      <Bounded>
        <div className="text-center py-12">
          <Heading size="xl" className="mb-4">
            Analytics
          </Heading>
          <p className="text-gray-600 mb-6">
            No goals have been tracked yet. Start playing Rocket League and tracking goals to see analytics here!
          </p>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>
      </Bounded>
    );
  }

  return (
    <Bounded>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <Heading size="xl">Analytics</Heading>
          <button
            onClick={fetchAnalytics}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Refresh Data
          </button>
        </div>



        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">{analyticsData.totalFriendsGoals}</div>
            <div className="text-sm text-green-700">Science Team Goals</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-600">{analyticsData.totalOpponentGoals}</div>
            <div className="text-sm text-red-700">Opponent Goals</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">{analyticsData.totalSongs}</div>
            <div className="text-sm text-blue-700">Songs Tracked</div>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-indigo-600">{analyticsData.totalArtists}</div>
            <div className="text-sm text-indigo-700">Artists Tracked</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-600">
              {analyticsData.totalFriendsGoals - analyticsData.totalOpponentGoals > 0 ? '+' : ''}
              {analyticsData.totalFriendsGoals - analyticsData.totalOpponentGoals}
            </div>
            <div className="text-sm text-purple-700">Net Score</div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white rounded-lg shadow-lg p-6 border">
          <div className="h-[600px]">
            <Bar data={chartData} options={chartOptions} />
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Showing top 20 {viewMode === 'songs' ? 'songs' : 'artists'} by total goals. Positive axis = Science Team goals, Negative axis = Opponent goals. Each color represents a different player.
          </p>
        </div>

        {/* Controls */}
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
          </div>
          
          <div className="text-sm text-gray-600">
            {viewMode === 'songs' ? (
              <span>Showing {analyticsData?.songs.length || 0} songs</span>
            ) : (
              <span>Showing {analyticsData?.artists.length || 0} artists</span>
            )}
          </div>
        </div>

        {/* Top Data Table */}
        <div className="bg-white rounded-lg shadow-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">
            Top {viewMode === 'songs' ? 'Songs' : 'Artists'} by Total Goals
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">{viewMode === 'songs' ? 'Song' : 'Artist'}</th>
                  {viewMode === 'artists' && <th className="text-center py-2">Songs</th>}
                  <th className="text-center py-2">Friends</th>
                  <th className="text-center py-2">Opponents</th>
                  <th className="text-center py-2">Total</th>
                  <th className="text-center py-2">Net Score</th>
                </tr>
              </thead>
              <tbody>
                {(viewMode === 'songs' ? analyticsData.songs : analyticsData.artists).slice(0, 10).map((item, index) => (
                  <tr key={index} className="border-b hover:bg-gray-50">
                    <td className="py-2">
                      <div>
                        <div className="font-medium">
                          {viewMode === 'songs' ? (item as SongAnalytics).song : (item as ArtistAnalytics).artist}
                        </div>
                        {viewMode === 'songs' && (
                          <div className="text-sm text-gray-500">{(item as SongAnalytics).artist}</div>
                        )}
                      </div>
                    </td>
                    {viewMode === 'artists' && (
                      <td className="text-center py-2">
                        <span className="text-blue-600 font-semibold">{(item as ArtistAnalytics).songs.length}</span>
                      </td>
                    )}
                    <td className="text-center py-2">
                      <span className="text-green-600 font-semibold">{item.friendsGoals}</span>
                    </td>
                    <td className="text-center py-2">
                      <span className="text-red-600 font-semibold">{item.opponentGoals}</span>
                    </td>
                    <td className="text-center py-2 font-semibold">{item.totalGoals}</td>
                    <td className="text-center py-2">
                      <span className={`font-semibold ${
                        item.netScore > 0 ? 'text-green-600' : 
                        item.netScore < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {item.netScore > 0 ? '+' : ''}{item.netScore}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Bounded>
  );
} 