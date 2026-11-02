package media

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

func TestParseWindowTitle(t *testing.T) {
	cases := []struct {
		in, artist, title string
		ok                bool
	}{
		{"Daft Punk - One More Time", "Daft Punk", "One More Time", true},
		// Split on the FIRST " - ": titles often contain it, artists rarely.
		{"Queen - Bohemian Rhapsody - Remastered 2011", "Queen", "Bohemian Rhapsody - Remastered 2011", true},
		{"  Artist  -  Title  ", "Artist", "Title", true},
		{"AC/DC, Foo - Bar", "AC/DC, Foo", "Bar", true},
		// Paused / idle / not a song.
		{"Spotify", "", "", false},
		{"Spotify Premium", "", "", false},
		{"Spotify Free", "", "", false},
		{"spotify premium", "", "", false},
		{"", "", "", false},
		{"Default IME", "", "", false},
		{"GDI+ Window (Spotify.exe)", "", "", false},
		{"Artist-Title", "", "", false}, // no spaced dash
		{" - Title", "", "", false},
		{"Artist - ", "", "", false},
	}
	for _, c := range cases {
		a, ti, ok := ParseWindowTitle(c.in)
		if a != c.artist || ti != c.title || ok != c.ok {
			t.Errorf("ParseWindowTitle(%q) = %q, %q, %v; want %q, %q, %v", c.in, a, ti, ok, c.artist, c.title, c.ok)
		}
	}
}

func TestFromWindowTitles(t *testing.T) {
	// Spotify.exe owns several top-level windows; only one carries the song.
	title, artist, ok := FromWindowTitles([]string{"", "Default IME", "MSCTFIME UI", "Muse - Uprising", "GDI+ Window (Spotify.exe)"})
	if !ok || title != "Uprising" || artist != "Muse" {
		t.Fatalf("got %q %q %v", title, artist, ok)
	}
	if _, _, ok := FromWindowTitles([]string{"Spotify Premium", "Default IME"}); ok {
		t.Fatal("paused Spotify reported a song")
	}
	if _, _, ok := FromWindowTitles(nil); ok {
		t.Fatal("no windows reported a song")
	}
}

func TestPickSession(t *testing.T) {
	spotify := Session{AppID: "Spotify.exe", Playing: true, Title: "Uprising", Artist: "Muse"}
	spotifyStore := Session{AppID: "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", Playing: true, Title: "Starlight", Artist: "Muse"}
	browser := Session{AppID: "MSEdge", Playing: true, Title: "Some Video", Artist: "Channel"}
	pausedSpotify := spotify
	pausedSpotify.Playing = false
	pausedBrowser := browser
	pausedBrowser.Playing = false

	cases := []struct {
		name          string
		current       *Session
		all           []Session
		title, artist string
		ok            bool
	}{
		{"spotify preferred over current", &browser, []Session{browser, spotify}, "Uprising", "Muse", true},
		{"store spotify app id", nil, []Session{browser, spotifyStore}, "Starlight", "Muse", true},
		{"paused spotify falls back to current", &browser, []Session{pausedSpotify, browser}, "Some Video", "Channel", true},
		{"current spotify", &spotify, []Session{spotify}, "Uprising", "Muse", true},
		{"nothing playing", &pausedBrowser, []Session{pausedSpotify, pausedBrowser}, "", "", false},
		{"no sessions", nil, nil, "", "", false},
		{"playing but no title", &Session{AppID: "x", Playing: true}, nil, "", "", false},
		{"other playing session that is not current is ignored", &pausedBrowser, []Session{pausedBrowser, {AppID: "vlc", Playing: true, Title: "t"}}, "", "", false},
	}
	for _, c := range cases {
		title, artist, ok := PickSession(c.current, c.all)
		if title != c.title || artist != c.artist || ok != c.ok {
			t.Errorf("%s: got %q %q %v", c.name, title, artist, ok)
		}
	}
}

func TestFirst(t *testing.T) {
	none := func() (string, string, bool) { return "", "", false }
	a := func() (string, string, bool) { return "A", "a", true }
	var bCalled bool
	b := func() (string, string, bool) { bCalled = true; return "B", "b", true }
	if title, _, ok := First(none, a, b)(); !ok || title != "A" || bCalled {
		t.Fatalf("got %q %v (b called %v)", title, ok, bCalled)
	}
	if _, _, ok := First(none, none)(); ok {
		t.Fatal("all empty reported a song")
	}
	if _, _, ok := First()(); ok {
		t.Fatal("no readers reported a song")
	}
}

// fakeClock is a manually advanced clock, safe for concurrent use.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

// fakeReader returns the configured song; when block is set it waits for a
// release before returning.
type fakeReader struct {
	calls   atomic.Int32
	mu      sync.Mutex
	title   string
	artist  string
	ok      bool
	block   bool
	release chan struct{}
}

func (r *fakeReader) set(title, artist string, ok bool) {
	r.mu.Lock()
	r.title, r.artist, r.ok = title, artist, ok
	r.mu.Unlock()
}

func (r *fakeReader) read() (string, string, bool) {
	r.calls.Add(1)
	r.mu.Lock()
	block, rel := r.block, r.release
	r.mu.Unlock()
	if block {
		<-rel
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.title, r.artist, r.ok
}

func newCache(r *fakeReader, clk *fakeClock, wait time.Duration) *Cache {
	c := NewCache(r.read)
	c.Now = clk.Now
	c.Wait = wait
	return c
}

func song(title, artist string) *model.Song { return model.LocalSong(title, artist) }

func eq(a, b *model.Song) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func TestCacheReusesReadingForOneSecond(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	r := &fakeReader{}
	r.set("Uprising", "Muse", true)
	c := newCache(r, clk, time.Second)

	if got := c.Song(); !eq(got, song("Uprising", "Muse")) {
		t.Fatalf("first read: %+v", got)
	}
	r.set("Starlight", "Muse", true)
	clk.Add(999 * time.Millisecond)
	if got := c.Song(); !eq(got, song("Uprising", "Muse")) || r.calls.Load() != 1 {
		t.Fatalf("within TTL: %+v (calls %d)", got, r.calls.Load())
	}
	clk.Add(time.Millisecond)
	if got := c.Song(); !eq(got, song("Starlight", "Muse")) || r.calls.Load() != 2 {
		t.Fatalf("after TTL: %+v (calls %d)", got, r.calls.Load())
	}
}

func TestCacheCachesNothingPlaying(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	r := &fakeReader{}
	c := newCache(r, clk, time.Second)
	if got := c.Song(); got != nil {
		t.Fatalf("nothing playing: %+v", got)
	}
	if got := c.Song(); got != nil || r.calls.Load() != 1 {
		t.Fatalf("cached empty reading: %+v (calls %d)", got, r.calls.Load())
	}
	// A blank title from the source is "nothing playing" too.
	r.set("  ", "Muse", true)
	clk.Add(time.Second)
	if got := c.Song(); got != nil {
		t.Fatalf("blank title: %+v", got)
	}
}

func TestCacheSlowReadReturnsLastValueWithinWait(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	r := &fakeReader{}
	r.set("Uprising", "Muse", true)
	c := newCache(r, clk, 20*time.Millisecond)
	if got := c.Song(); !eq(got, song("Uprising", "Muse")) {
		t.Fatalf("first read: %+v", got)
	}

	// The next read hangs: Song must give up after Wait and return the
	// last value instead of blocking the caller.
	rel := make(chan struct{})
	r.mu.Lock()
	r.block, r.release = true, rel
	r.mu.Unlock()
	r.set("Starlight", "Muse", true)
	clk.Add(2 * time.Second)
	start := time.Now()
	got := c.Song()
	if el := time.Since(start); el > 500*time.Millisecond {
		t.Fatalf("Song blocked for %v", el)
	}
	if !eq(got, song("Uprising", "Muse")) {
		t.Fatalf("slow read: %+v", got)
	}
	// While the read is still running no second read is started, and a
	// read that is already overdue is not waited for again.
	start = time.Now()
	got = c.Song()
	if el := time.Since(start); el > 15*time.Millisecond {
		t.Fatalf("waited %v on an overdue read", el)
	}
	if !eq(got, song("Uprising", "Muse")) || r.calls.Load() != 2 {
		t.Fatalf("second call during slow read: %+v (calls %d)", got, r.calls.Load())
	}

	// When the slow read finishes, its value is used.
	r.mu.Lock()
	r.block = false
	r.mu.Unlock()
	close(rel)
	waitUntil(t, func() bool { return eq(c.Song(), song("Starlight", "Muse")) })
	if n := r.calls.Load(); n != 2 {
		t.Fatalf("calls %d, want 2 (the finished read is fresh)", n)
	}
}

func TestCacheDropsValueStaleBeyondMaxStale(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	r := &fakeReader{}
	r.set("Uprising", "Muse", true)
	c := newCache(r, clk, 10*time.Millisecond)
	c.Song()

	rel := make(chan struct{})
	defer close(rel)
	r.mu.Lock()
	r.block, r.release = true, rel
	r.mu.Unlock()
	clk.Add(MaxStale + time.Millisecond)
	if got := c.Song(); got != nil {
		t.Fatalf("value older than MaxStale used: %+v", got)
	}
}

func TestCacheFirstReadTimesOut(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	rel := make(chan struct{})
	defer close(rel)
	r := &fakeReader{block: true, release: rel}
	r.set("Uprising", "Muse", true)
	c := newCache(r, clk, 10*time.Millisecond)
	if got := c.Song(); got != nil {
		t.Fatalf("no reading yet: %+v", got)
	}
}

func TestCacheConcurrentCallers(t *testing.T) {
	clk := &fakeClock{t: time.Unix(1000, 0)}
	r := &fakeReader{}
	r.set("Uprising", "Muse", true)
	c := newCache(r, clk, time.Second)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if j%10 == 0 {
					clk.Add(300 * time.Millisecond)
				}
				if got := c.Song(); !eq(got, song("Uprising", "Muse")) {
					t.Errorf("got %+v", got)
					return
				}
			}
		}()
	}
	wg.Wait()
}

func TestCacheNilReader(t *testing.T) {
	var c *Cache
	if c.Song() != nil {
		t.Fatal("nil cache reported a song")
	}
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestCachePanickingReaderIsNothingPlaying(t *testing.T) {
	c := NewCache(func() (string, string, bool) { panic("winrt") })
	c.Wait = time.Second
	if got := c.Song(); got != nil {
		t.Fatalf("got %+v", got)
	}
}
