import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.NODE_ENV === 'production' 
  ? 'https://zachrobertson.co/api/spotify/callback'
  : 'http://localhost:3000/api/spotify/callback';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    // Handle authorization errors
    if (error) {
      console.error('Spotify authorization error:', error);
      let errorMessage = 'Spotify authorization was cancelled or failed';
      
      // Provide more specific error messages
      if (error === 'access_denied') {
        errorMessage = 'You denied the required permissions. Please grant all permissions to use the RL Tracker.';
      } else if (error === 'invalid_scope') {
        errorMessage = 'The requested permissions are not valid. Please try reconnecting.';
      }
      
      return NextResponse.redirect(
        `${process.env.NODE_ENV === 'production' ? 'https://zachrobertson.co' : 'http://localhost:3000'}/RLTracker?error=spotify_auth_failed&message=${encodeURIComponent(errorMessage)}`
      );
    }

    if (!code) {
      console.error('No authorization code received');
      return NextResponse.redirect(
        `${process.env.NODE_ENV === 'production' ? 'https://zachrobertson.co' : 'http://localhost:3000'}/RLTracker?error=no_code&message=${encodeURIComponent('No authorization code received from Spotify')}`
      );
    }

    // Note: We could verify the state parameter here, but since it's stored in sessionStorage
    // and we're on the server side, we'll skip that for now to keep it simple

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      return NextResponse.redirect(
        `${process.env.NODE_ENV === 'production' ? 'https://zachrobertson.co' : 'http://localhost:3000'}/RLTracker?error=token_exchange_failed&message=${encodeURIComponent('Failed to exchange authorization code for tokens')}`
      );
    }

    const tokenData = await tokenResponse.json();
    
    // Create a secure response with tokens
    const response = NextResponse.redirect(
      `${process.env.NODE_ENV === 'production' ? 'https://zachrobertson.co' : 'http://localhost:3000'}/RLTracker?success=true`
    );

    // Set secure, httpOnly cookies with the tokens
    response.cookies.set('spotify_access_token', tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokenData.expires_in, // Token expires in this many seconds
      path: '/',
    });

    response.cookies.set('spotify_refresh_token', tokenData.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });

    console.log('Spotify tokens set successfully');
    return response;

  } catch (error) {
    console.error('Error in Spotify callback:', error);
    return NextResponse.redirect(
      `${process.env.NODE_ENV === 'production' ? 'https://zachrobertson.co' : 'http://localhost:3000'}/RLTracker?error=callback_error&message=${encodeURIComponent('An error occurred during Spotify authorization')}`
    );
  }
} 