// Package media reads the track playing on this PC, so each event can carry
// the song even when the site's Spotify Web API link is unavailable.
//
// The OS calls live in the Windows-only files (System Media Transport
// Controls, then the Spotify window title); this file holds the pure parsing
// and selection logic plus the Cache that keeps reads off the parser's hot
// path.
package media

import (
	"strings"
	"sync"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// Reader reads the song playing now. ok is false when nothing is playing.
type Reader func() (title, artist string, ok bool)

// First returns a Reader that tries each reader in order and returns the
// first song found.
func First(readers ...Reader) Reader {
	return func() (string, string, bool) {
		for _, r := range readers {
			if title, artist, ok := r(); ok {
				return title, artist, true
			}
		}
		return "", "", false
	}
}

// idleTitles are the Spotify window titles shown while paused or idle.
var idleTitles = map[string]bool{"spotify": true, "spotify premium": true, "spotify free": true}

// ParseWindowTitle reads a Spotify window title. "Artist - Title" means a
// track is playing; it is split on the FIRST " - " because artist names
// rarely contain it while titles ("Song - Remastered 2011") often do.
func ParseWindowTitle(s string) (artist, title string, ok bool) {
	s = strings.TrimSpace(s)
	if idleTitles[strings.ToLower(s)] {
		return "", "", false
	}
	a, t, found := strings.Cut(s, " - ")
	a, t = strings.TrimSpace(a), strings.TrimSpace(t)
	if !found || a == "" || t == "" {
		return "", "", false
	}
	return a, t, true
}

// FromWindowTitles picks the song from the titles of Spotify's top-level
// windows (it owns several; only the main one names the track).
func FromWindowTitles(titles []string) (title, artist string, ok bool) {
	for _, s := range titles {
		if a, t, ok := ParseWindowTitle(s); ok {
			return t, a, true
		}
	}
	return "", "", false
}

// Session is one System Media Transport Controls session.
type Session struct {
	AppID   string // SourceAppUserModelId
	Playing bool   // PlaybackStatus == Playing
	Title   string
	Artist  string
}

func (s *Session) isSpotify() bool {
	return strings.Contains(strings.ToLower(s.AppID), "spotify")
}

func (s *Session) song() (string, string, bool) {
	if s == nil || !s.Playing || strings.TrimSpace(s.Title) == "" {
		return "", "", false
	}
	return s.Title, s.Artist, true
}

// PickSession prefers a playing Spotify session (current or not), else the
// current session if it is playing.
func PickSession(current *Session, all []Session) (title, artist string, ok bool) {
	if current != nil && current.isSpotify() {
		if title, artist, ok := current.song(); ok {
			return title, artist, true
		}
	}
	for i := range all {
		if all[i].isSpotify() {
			if title, artist, ok := all[i].song(); ok {
				return title, artist, true
			}
		}
	}
	return current.song()
}

// Cache timing.
const (
	// TTL is how long one reading is reused.
	TTL = time.Second
	// DefaultWait bounds how long Song blocks for a fresh reading.
	DefaultWait = 50 * time.Millisecond
	// MaxStale is the oldest reading Song falls back to while a read hangs.
	MaxStale = 15 * time.Second
)

// Cache reuses a reading for TTL and never blocks Song for longer than Wait:
// a slow read carries on in the background and Song returns the previous
// reading (unless it is older than MaxStale). At most one read runs at a time.
type Cache struct {
	Now  func() time.Time
	Wait time.Duration

	read Reader

	mu       sync.Mutex
	have     bool
	song     *model.Song
	at       time.Time
	inflight chan struct{} // closed when the running read finishes
	overdue  bool          // a caller already gave up waiting on inflight
}

// NewCache wraps read (usually NowPlaying).
func NewCache(read Reader) *Cache {
	return &Cache{Now: time.Now, Wait: DefaultWait, read: read}
}

// Song returns the song playing now, or nil. Safe for concurrent use and
// on a nil Cache.
func (c *Cache) Song() *model.Song {
	if c == nil || c.read == nil {
		return nil
	}
	c.mu.Lock()
	if c.have && c.Now().Sub(c.at) < TTL {
		s := c.song
		c.mu.Unlock()
		return s
	}
	if c.inflight == nil {
		done := make(chan struct{})
		c.inflight, c.overdue = done, false
		go c.refresh(done)
	}
	done, overdue := c.inflight, c.overdue
	c.mu.Unlock()

	if !overdue {
		t := time.NewTimer(c.Wait)
		select {
		case <-done:
			t.Stop()
			c.mu.Lock()
			s := c.song
			c.mu.Unlock()
			return s
		case <-t.C:
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	select {
	case <-done: // finished just now
		return c.song
	default:
	}
	c.overdue = true
	if c.have && c.Now().Sub(c.at) < MaxStale {
		return c.song
	}
	return nil
}

func (c *Cache) refresh(done chan struct{}) {
	var s *model.Song
	func() {
		defer func() { _ = recover() }() // a failing OS call means "unknown", never a crash
		if title, artist, ok := c.read(); ok {
			s = model.LocalSong(title, artist)
		}
	}()
	c.mu.Lock()
	c.song, c.have, c.at = s, true, c.Now()
	c.inflight = nil
	c.mu.Unlock()
	close(done)
}
