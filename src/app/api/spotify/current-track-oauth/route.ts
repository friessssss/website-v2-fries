import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Token refresh failed:', response.status, errorText);
    throw new Error(`Failed to refresh access token: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function getCurrentTrack(accessToken: string) {
  const response = await fetch(`https://api.spotify.com/v1/me/player/currently-playing?t=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 204) {
      return null; // No track currently playing
    }
    
    if (response.status === 401) {
      throw new Error('TOKEN_EXPIRED');
    }
    
    throw new Error(`Failed to fetch current track: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function getPlaylistInfo(accessToken: string, playlistId: string) {
  try {
    if (!playlistId || playlistId.length === 0) {
      return null;
    }

    const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      images: data.images,
    };
  } catch (error) {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get tokens from cookies
    const accessToken = request.cookies.get('spotify_access_token')?.value;
    const refreshToken = request.cookies.get('spotify_refresh_token')?.value;

    if (!accessToken || !refreshToken) {
      return NextResponse.json(
        { error: 'Not authenticated', needsAuth: true },
        { status: 401 }
      );
    }

    let currentAccessToken = accessToken;

    try {
      // Try to get current track
      const currentTrackData = await getCurrentTrack(currentAccessToken);

      if (!currentTrackData || !currentTrackData.item) {
        return NextResponse.json({
          name: 'No track playing',
          artist: '',
          album: '',
          albumArt: '',
          isPlaying: false,
          playlist: null,
        });
      }

      const track = currentTrackData.item;
      const albumArt = track.album.images[0]?.url || '';

      // Get playlist information if available
      let playlistInfo = null;
      try {
        if (currentTrackData.context && currentTrackData.context.type === 'playlist' && currentTrackData.context.uri) {
          const playlistId = currentTrackData.context.uri.split(':').pop();
          if (playlistId && playlistId.length > 0) {
            playlistInfo = await getPlaylistInfo(currentAccessToken, playlistId);
          }
        }
      } catch (error) {
        // Continue without playlist info
      }

      const response = {
        name: track.name,
        artist: track.artists.map((artist: any) => artist.name).join(', '),
        album: track.album.name,
        albumArt,
        isPlaying: currentTrackData.is_playing,
        timestamp: new Date().toISOString(),
        progress: currentTrackData.progress_ms,
        playlist: playlistInfo,
      };

      return NextResponse.json(response);

    } catch (error) {
      if (error instanceof Error && error.message === 'TOKEN_EXPIRED') {
        // Token expired, try to refresh
        try {
          const newAccessToken = await refreshAccessToken(refreshToken);
          
          // Try again with new token
          const currentTrackData = await getCurrentTrack(newAccessToken);
          
          if (!currentTrackData || !currentTrackData.item) {
            return NextResponse.json({
              name: 'No track playing',
              artist: '',
              album: '',
              albumArt: '',
              isPlaying: false,
              playlist: null,
            });
          }

          const track = currentTrackData.item;
          const albumArt = track.album.images[0]?.url || '';

          // Get playlist information if available
          let playlistInfo = null;
          try {
            if (currentTrackData.context && currentTrackData.context.type === 'playlist' && currentTrackData.context.uri) {
              const playlistId = currentTrackData.context.uri.split(':').pop();
              if (playlistId && playlistId.length > 0) {
                playlistInfo = await getPlaylistInfo(newAccessToken, playlistId);
              }
            }
          } catch (error) {
            // Continue without playlist info
          }

          const response = {
            name: track.name,
            artist: track.artists.map((artist: any) => artist.name).join(', '),
            album: track.album.name,
            albumArt,
            isPlaying: currentTrackData.is_playing,
            timestamp: new Date().toISOString(),
            progress: currentTrackData.progress_ms,
            playlist: playlistInfo,
          };

          // Set new access token in cookie
          const apiResponse = NextResponse.json(response);
          apiResponse.cookies.set('spotify_access_token', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 3600, // 1 hour
            path: '/',
          });

          return apiResponse;

        } catch (refreshError) {
          // Refresh failed, user needs to re-authenticate
          return NextResponse.json(
            { error: 'Authentication expired', needsAuth: true },
            { status: 401 }
          );
        }
      }
      
      throw error;
    }

  } catch (error) {
    console.error('Spotify API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current track' },
      { status: 500 }
    );
  }
} 