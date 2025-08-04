'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import Bounded from '@/components/Bounded';
import Heading from '@/components/Heading';
import FriendNavBar from '@/components/FriendNavBar';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
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

interface TimelinePeriod {
  period: string;
  friendsGoals: number;
  opponentGoals: number;
  totalGoals: number;
  netScore: number;
  playerBreakdown: PlayerGoals[];
  songs: string[];
}

interface TimelineData {
  timeline: TimelinePeriod[];
  totalGoals: number;
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
  const [playlistFilter, setPlaylistFilter] = useState<string>('');
  const [availablePlaylists, setAvailablePlaylists] = useState<string[]>([]);
  const [chartType, setChartType] = useState<'enhanced' | 'traditional' | 'timeline'>('enhanced');
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(new Set());
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [timelineGroupBy, setTimelineGroupBy] = useState<'hour' | 'day' | 'week' | 'month'>('day');

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
  }, [timeFilter, playlistFilter]);

  const fetchTimeline = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('timeFilter', timeFilter);
      params.append('groupBy', timelineGroupBy);
      if (playlistFilter) {
        params.append('playlistFilter', playlistFilter);
      }
      
      console.log('Fetching timeline from:', `/api/analytics/timeline?${params.toString()}`);
      const response = await fetch(`/api/analytics/timeline?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch timeline data: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Timeline data received:', data);
      setTimelineData(data);
    } catch (err) {
      console.error('Error fetching timeline:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [timeFilter, playlistFilter, timelineGroupBy]);

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

  useEffect(() => {
    if (chartType === 'timeline') {
      fetchTimeline();
    }
  }, [chartType, fetchTimeline]);

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

  // Create enhanced chart datasets with differential line
  const createEnhancedChartData = () => {
    const data = viewMode === 'songs' ? analyticsData?.songs.slice(0, 20) : analyticsData?.artists.slice(0, 20);
    if (!data) return { labels: [], datasets: [] };

    const labels = data.map(item => 
      viewMode === 'songs' 
        ? `${cleanSongName((item as SongAnalytics).song)} - ${(item as SongAnalytics).artist}`
        : `${(item as ArtistAnalytics).artist} (${(item as ArtistAnalytics).songs.length} songs)`
    );

    const friends = ['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'];
    const datasets: any[] = [];
    
    // Create datasets for friends (positive values) - filter out hidden players
    friends.forEach(player => {
      if (hiddenPlayers.has(player)) return; // Skip hidden players
      
      const playerData = data.map(item => {
        const playerBreakdown = item.playerBreakdown?.find(p => p.player === player);
        return playerBreakdown ? playerBreakdown.goals : 0;
      });
      
      if (playerData.some(value => value !== 0)) {
        datasets.push({
          label: player,
          data: playerData,
          backgroundColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          borderWidth: 2,
          stack: 'Goals',
          type: 'bar' as const,
          hoverBackgroundColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          hoverBorderColor: '#ffffff',
          hoverBorderWidth: 3,
        });
      }
    });
    
    // Create dataset for opponents (negative values)
    const opponentData = data.map(item => {
      const playerBreakdown = item.playerBreakdown?.find(p => p.player === 'Opponent');
      return playerBreakdown ? -playerBreakdown.goals : 0; // Negative values for opponents
    });
    
    if (opponentData.some(value => value !== 0)) {
      datasets.push({
        label: 'Opponent',
        data: opponentData,
        backgroundColor: playerColors['Opponent'],
        borderColor: playerColors['Opponent'],
        borderWidth: 2,
        stack: 'Goals',
        type: 'bar' as const,
        hoverBackgroundColor: playerColors['Opponent'],
        hoverBorderColor: '#ffffff',
        hoverBorderWidth: 3,
      });
    }

    // Calculate filtered differential based on visible players
    const filteredDifferentialData = data.map(item => {
      let visibleFriendsGoals = 0;
      let opponentGoals = item.opponentGoals;
      
      // Sum goals from visible players only
      friends.forEach(player => {
        if (!hiddenPlayers.has(player)) {
          const playerBreakdown = item.playerBreakdown?.find(p => p.player === player);
          visibleFriendsGoals += playerBreakdown ? playerBreakdown.goals : 0;
        }
      });
      
      return visibleFriendsGoals - opponentGoals;
    });

    // Add differential line overlay with recalculated values
    datasets.push({
      label: 'Goal Differential',
      data: filteredDifferentialData,
      borderColor: '#8B5CF6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      borderWidth: 3,
      fill: true,
      type: 'line' as const,
      pointBackgroundColor: '#8B5CF6',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 10,
      pointHoverBorderWidth: 3,
      tension: 0.4,
      hoverBorderColor: '#ffffff',
      hoverBorderWidth: 4,
    });



    return { labels, datasets };
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

  // Create timeline chart data
  const createTimelineChartData = () => {
    if (!timelineData?.timeline) return { labels: [], datasets: [] };

    const labels = timelineData.timeline.map(period => {
      const date = new Date(period.period);
      switch (timelineGroupBy) {
        case 'hour':
          return date.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric',
            hour12: true 
          });
        case 'day':
          return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
          });
        case 'week':
          return `Week of ${date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric' 
          })}`;
        case 'month':
          return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long' 
          });
        default:
          return date.toLocaleDateString();
      }
    });

    const friends = ['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'];
    const datasets: any[] = [];
    
    // Create line datasets for friends - filter out hidden players
    friends.forEach(player => {
      if (hiddenPlayers.has(player)) return; // Skip hidden players
      
      const playerData = timelineData.timeline.map(period => {
        const playerBreakdown = period.playerBreakdown?.find(p => p.player === player);
        return playerBreakdown ? playerBreakdown.goals : 0;
      });
      
      if (playerData.some(value => value !== 0)) {
        datasets.push({
          label: player,
          data: playerData,
          borderColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          backgroundColor: 'transparent',
          borderWidth: 3,
          type: 'line' as const,
          pointBackgroundColor: playerColors[player as keyof typeof playerColors] || '#9CA3AF',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 8,
          pointHoverBorderWidth: 3,
          tension: 0.4,
          fill: false,
          hoverBorderColor: '#ffffff',
          hoverBorderWidth: 4,
        });
      }
    });
    
    // Create line dataset for opponents
    const opponentData = timelineData.timeline.map(period => {
      const playerBreakdown = period.playerBreakdown?.find(p => p.player === 'Opponent');
      return playerBreakdown ? playerBreakdown.goals : 0; // Keep positive for line graph
    });
    
    if (opponentData.some(value => value !== 0)) {
      datasets.push({
        label: 'Opponent',
        data: opponentData,
        borderColor: playerColors['Opponent'],
        backgroundColor: 'transparent',
        borderWidth: 3,
        type: 'line' as const,
        pointBackgroundColor: playerColors['Opponent'],
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 8,
        pointHoverBorderWidth: 3,
        tension: 0.4,
        fill: false,
        hoverBorderColor: '#ffffff',
        hoverBorderWidth: 4,
      });
    }

    // Calculate filtered differential based on visible players
    const filteredDifferentialData = timelineData.timeline.map(period => {
      let visibleFriendsGoals = 0;
      let opponentGoals = period.opponentGoals;
      
      // Sum goals from visible players only
      friends.forEach(player => {
        if (!hiddenPlayers.has(player)) {
          const playerBreakdown = period.playerBreakdown?.find(p => p.player === player);
          visibleFriendsGoals += playerBreakdown ? playerBreakdown.goals : 0;
        }
      });
      
      return visibleFriendsGoals - opponentGoals;
    });

    // Add differential line with recalculated values
    datasets.push({
      label: 'Goal Differential',
      data: filteredDifferentialData,
      borderColor: '#8B5CF6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      borderWidth: 4,
      fill: true,
      type: 'line' as const,
      pointBackgroundColor: '#8B5CF6',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 10,
      pointHoverBorderWidth: 3,
      tension: 0.4,
      hoverBorderColor: '#ffffff',
      hoverBorderWidth: 5,
    });

    return { labels, datasets };
  };

  // Prepare chart data based on chart type and view mode
  const chartData = chartType === 'timeline' 
    ? createTimelineChartData()
    : (chartType === 'enhanced' 
      ? createEnhancedChartData()
      : (viewMode === 'songs' ? {
          labels: analyticsData?.songs.slice(0, 20).map(song => 
            `${cleanSongName(song.song)} - ${song.artist}`
          ) || [],
          datasets: createPlayerDatasets(),
        } : {
          labels: analyticsData?.artists.slice(0, 20).map(artist => 
            `${artist.artist} (${artist.songs.length} songs)`
          ) || [],
          datasets: createArtistDatasets(),
        }));

  const chartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: chartType === 'enhanced' ? 1500 : 2000,
      easing: 'easeInOutQuart',
      delay: (context) => context.dataIndex * 50,
      onProgress: (animation) => {
        const chart = animation.chart;
        const ctx = chart.ctx;
        const dataset = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        
        if (meta.data) {
          meta.data.forEach((bar, index) => {
            const value = dataset.data[index];
            if (typeof value === 'number' && value > 0) {
              const x = bar.x;
              const y = bar.y;
              
              // Add subtle glow effect
              ctx.save();
              ctx.shadowColor = 'rgba(59, 130, 246, 0.3)';
              ctx.shadowBlur = 10;
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
              ctx.restore();
            }
          });
        }
      },
    },
        plugins: {
      legend: {
        display: false, // Hide the legend completely
      },
      title: {
        display: true,
        text: chartType === 'timeline' 
          ? `Goal Timeline - Grouped by ${timelineGroupBy.charAt(0).toUpperCase() + timelineGroupBy.slice(1)}`
          : (chartType === 'enhanced' 
            ? (viewMode === 'songs' ? 'Enhanced Goal Differential - Songs' : 'Enhanced Goal Differential - Artists')
            : (viewMode === 'songs' ? 'Goals per Song - Science Team vs Opponents' : 'Goals per Artist - Science Team vs Opponents')),
        font: {
          size: 18,
          weight: 'bold',
        },
        padding: 25,
        color: '#1f2937',
      },
      tooltip: {
        enabled: false, // Disable tooltip - will be shown on click only
      },
    },
    scales: {
      x: {
        stacked: chartType === 'timeline' ? false : chartType === 'traditional',
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          maxRotation: chartType === 'timeline' ? 0 : 45,
          minRotation: chartType === 'timeline' ? 0 : 45,
          font: {
            size: chartType === 'timeline' ? 10 : 11,
            weight: 'bold',
          },
          color: '#6b7280',
        },
      },
      y: {
        stacked: chartType === 'timeline' ? false : true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        title: {
          display: true,
          text: chartType === 'timeline' ? 'Goals Over Time' : (chartType === 'enhanced' ? 'Goals & Differential' : 'Goals'),
          font: {
            size: 14,
            weight: 'bold',
          },
          color: '#374151',
        },
        ticks: {
          callback: function(value) {
            return chartType === 'timeline' ? Number(value) : Math.abs(Number(value));
          },
          font: {
            size: 12,
            weight: 'bold',
          },
          color: '#6b7280',
        },
        beginAtZero: chartType === 'timeline' ? true : chartType === 'traditional',
        ...(chartType === 'enhanced' && {
          grid: {
            color: 'rgba(0, 0, 0, 0.05)',
          },
        }),
      },
    },
    interaction: {
      mode: 'nearest' as const,
      intersect: false,
    },
  };

  if (loading) {
    return (
      <>
        <FriendNavBar />
        <Bounded>
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span>Loading analytics...</span>
            </div>
          </div>
        </Bounded>
      </>
    );
  }

  if (error) {
    return (
      <>
        <FriendNavBar />
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
      </>
    );
  }

  if (!analyticsData || analyticsData.songs.length === 0) {
    return (
      <>
        <FriendNavBar />
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
      </>
    );
  }

  return (
    <>
      <FriendNavBar />
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
          <div className="h-[600px] relative">
            {chartType === 'enhanced' && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Gradient overlay for enhanced chart */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-50/20 to-transparent"></div>
              </div>
            )}
            <Bar data={chartData} options={chartOptions} />
          </div>
          <div className="mt-4 text-center">
            {chartType === 'enhanced' && (
              <div className="flex items-center justify-center space-x-6 text-xs text-gray-600">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded"></div>
                  <span>Friend Goals</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span>Opponent Goals</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-purple-500 rounded"></div>
                  <span>Differential Line</span>
                </div>
              </div>
            )}
          </div>
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
            
            {chartType === 'timeline' && (
              <div>
                <label htmlFor="timelineGroupBy" className="block text-sm font-medium text-gray-700 mb-1">
                  Group By
                </label>
                <select
                  id="timelineGroupBy"
                  value={timelineGroupBy}
                  onChange={(e) => setTimelineGroupBy(e.target.value as 'hour' | 'day' | 'week' | 'month')}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="hour">Hour</option>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </div>
            )}
            
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
            
            <div>
              <label htmlFor="chartType" className="block text-sm font-medium text-gray-700 mb-1">
                Chart Type
              </label>
              <select
                id="chartType"
                value={chartType}
                onChange={(e) => setChartType(e.target.value as 'enhanced' | 'traditional' | 'timeline')}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="enhanced">Enhanced Differential</option>
                <option value="traditional">Traditional Stacked</option>
                <option value="timeline">Timeline View</option>
              </select>
            </div>
            
            {(chartType === 'enhanced' || chartType === 'timeline') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Player Filter
                </label>
                <div className="flex flex-wrap gap-2">
                  {['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'].map(player => (
                    <button
                      key={player}
                      onClick={() => {
                        const newHiddenPlayers = new Set(hiddenPlayers);
                        if (newHiddenPlayers.has(player)) {
                          newHiddenPlayers.delete(player);
                        } else {
                          newHiddenPlayers.add(player);
                        }
                        setHiddenPlayers(newHiddenPlayers);
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        hiddenPlayers.has(player)
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      }`}
                      style={{
                        backgroundColor: hiddenPlayers.has(player) 
                          ? '#e5e7eb' 
                          : playerColors[player as keyof typeof playerColors] + '20',
                        color: hiddenPlayers.has(player) 
                          ? '#6b7280' 
                          : playerColors[player as keyof typeof playerColors],
                      }}
                    >
                      {player}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          

        </div>





        {/* Player Stats */}
        <div className="bg-white rounded-lg shadow-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">Player Statistics</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {analyticsData.songs.flatMap(song => song.playerBreakdown)
              .reduce((acc, player) => {
                const existing = acc.find(p => p.player === player.player);
                if (existing) {
                  existing.goals += player.goals;
                } else {
                  acc.push({ ...player });
                }
                return acc;
              }, [] as PlayerGoals[])
              .sort((a, b) => {
                // Put Opponents at the end, sort others by goals
                if (a.player === 'Opponent') return 1;
                if (b.player === 'Opponent') return -1;
                return b.goals - a.goals;
              })
              .map((player) => (
                <div key={player.player} className={`rounded-lg p-4 text-center ${
                  player.player === 'Opponent' 
                    ? 'bg-red-50 border border-red-200' 
                    : 'bg-gray-50'
                }`}>
                  <div className={`text-2xl font-bold ${
                    player.player === 'Opponent' ? 'text-red-700' : 'text-gray-800'
                  }`}>{player.goals}</div>
                  <div className={`text-sm ${
                    player.player === 'Opponent' ? 'text-red-600' : 'text-gray-600'
                  }`}>{player.player === 'Opponent' ? 'Opponents' : player.player}</div>
                </div>
              ))}
          </div>
        </div>

        {/* Top Songs by Goal Differential */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Best Songs */}
          <div className="bg-white rounded-lg shadow-lg p-6 border">
            <h3 className="text-lg font-semibold mb-4 text-green-700">🏆 Top 5 Songs by Goal Differential</h3>
            <div className="space-y-3">
              {analyticsData.songs
                .filter(song => song.netScore > 0)
                .sort((a, b) => b.netScore - a.netScore)
                .slice(0, 5)
                .map((song, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium text-green-800">{cleanSongName(song.song)}</div>
                      <div className="text-sm text-green-600">{song.artist}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-green-700">+{song.netScore}</div>
                      <div className="text-xs text-green-600">
                        {song.friendsGoals}-{song.opponentGoals}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Worst Songs */}
          <div className="bg-white rounded-lg shadow-lg p-6 border">
            <h3 className="text-lg font-semibold mb-4 text-red-700">💀 Bottom 5 Songs by Goal Differential</h3>
            <div className="space-y-3">
              {analyticsData.songs
                .filter(song => song.netScore < 0)
                .sort((a, b) => a.netScore - b.netScore)
                .slice(0, 5)
                .map((song, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium text-red-800">{cleanSongName(song.song)}</div>
                      <div className="text-sm text-red-600">{song.artist}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-red-700">{song.netScore}</div>
                      <div className="text-xs text-red-600">
                        {song.friendsGoals}-{song.opponentGoals}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Top Songs by Total Goals */}
        <div className="bg-white rounded-lg shadow-lg p-6 border">
          <h3 className="text-lg font-semibold mb-4">
            Top {viewMode === 'songs' ? 'Songs' : 'Artists'} by Total Goals
          </h3>
          <div className="space-y-3">
            {(viewMode === 'songs' ? analyticsData.songs : analyticsData.artists).slice(0, 10).map((item, index) => (
              <div key={index} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className="text-lg font-bold text-gray-400 w-8">#{index + 1}</div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {viewMode === 'songs' ? (item as SongAnalytics).song : (item as ArtistAnalytics).artist}
                    </div>
                    {viewMode === 'songs' && (
                      <div className="text-sm text-gray-500">{(item as SongAnalytics).artist}</div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  {viewMode === 'artists' && (
                    <div className="text-center">
                      <div className="text-sm text-gray-500">Songs</div>
                      <div className="text-blue-600 font-semibold">{(item as ArtistAnalytics).songs.length}</div>
                    </div>
                  )}
                  
                  {/* Individual Player Contributions */}
                  <div className="flex items-center space-x-6">
                    {['Vandy', 'Ashton', 'Sam', 'Mason', 'Jake', 'Zach'].map(player => {
                      const playerData = item.playerBreakdown?.find(p => p.player === player);
                      const goals = playerData?.goals || 0;
                      const playerColors = {
                        'Vandy': '#6366F1',
                        'Ashton': '#10B981',
                        'Sam': '#F59E0B',
                        'Mason': '#8B5CF6',
                        'Jake': '#EC4899',
                        'Zach': '#06B6D4',
                      };
                      
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
                  
                  <div className="text-center">
                    <div className="text-sm text-gray-500">Opponents</div>
                    <div className="text-red-600 font-semibold">{item.opponentGoals}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-gray-500">Total</div>
                    <div className="font-semibold text-gray-900">{item.totalGoals}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-gray-500">Net Score</div>
                    <div className={`font-semibold ${
                      item.netScore > 0 ? 'text-green-600' : 
                      item.netScore < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {item.netScore > 0 ? '+' : ''}{item.netScore}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Bounded>
    </>
  );
} 