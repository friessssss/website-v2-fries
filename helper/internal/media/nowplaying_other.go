//go:build !windows

package media

// NowPlaying reports nothing outside Windows (the helper only ships for
// Windows; this keeps the module building and testing elsewhere).
func NowPlaying() (title, artist string, ok bool) { return "", "", false }
