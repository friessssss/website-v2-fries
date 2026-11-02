//go:build windows

package media

// NowPlaying returns the track playing on this PC: from the System Media
// Transport Controls (Spotify's session preferred) and, when that finds
// nothing, from the Spotify window title. It may block on OS calls; callers
// on a hot path use a Cache.
func NowPlaying() (title, artist string, ok bool) { return nowPlaying() }

var nowPlaying = First(smtcNowPlaying, spotifyWindowNowPlaying)
