import { NextRequest, NextResponse } from 'next/server';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

async function getAccessToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
    throw new Error('Missing Spotify credentials');
  }

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
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh access token');
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
      // No track currently playing
      return null;
    }
    throw new Error('Failed to fetch current track');
  }

  const data = await response.json();
  console.log('Raw Spotify API response:', JSON.stringify(data, null, 2));
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = await getAccessToken();
    const currentTrackData = await getCurrentTrack(accessToken);

    if (!currentTrackData || !currentTrackData.item) {
      return NextResponse.json({
        name: 'No track playing',
        artist: '',
        album: '',
        albumArt: '',
        isPlaying: false,
      });
    }

    const track = currentTrackData.item;
    const albumArt = track.album.images[0]?.url || '';

    const response = {
      name: track.name,
      artist: track.artists.map((artist: any) => artist.name).join(', '),
      album: track.album.name,
      albumArt,
      isPlaying: currentTrackData.is_playing,
      timestamp: new Date().toISOString(),
      progress: currentTrackData.progress_ms,
    };
    
    console.log('Spotify API Response:', response);
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Spotify API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current track' },
      { status: 500 }
    );
  }
} 