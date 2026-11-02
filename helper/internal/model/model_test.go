package model

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

func TestEventRoundTrip(t *testing.T) {
	gt := 3.0
	in := Event{Kind: "goal", MatchGUID: "g", At: time.Date(2026, 1, 2, 3, 4, 5, 6_000_000, time.UTC), GameTime: &gt, Scorer: &PlayerRef{"A", 1}}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	if m["at"] != "2026-01-02T03:04:05.006Z" || m["gameTime"] != 3.0 || len(m) != 5 {
		t.Fatalf("got %s", b)
	}
	var out Event
	if err := json.Unmarshal(b, &out); err != nil || !out.At.Equal(in.At) || out.Scorer.Name != "A" || *out.GameTime != 3 {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestEventSongOmittedWhenNil(t *testing.T) {
	b, _ := json.Marshal(Event{Kind: "save", MatchGUID: "g", At: time.Unix(0, 0)})
	var m map[string]any
	json.Unmarshal(b, &m)
	if _, ok := m["song"]; ok {
		t.Fatalf("song present: %s", b)
	}
}

func TestEventSongRoundTrip(t *testing.T) {
	in := Event{Kind: "goal", MatchGUID: "g", At: time.Unix(0, 0), Song: &Song{Title: "Time", Artist: "", Source: "local"}}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	json.Unmarshal(b, &raw)
	var song map[string]any
	if err := json.Unmarshal(raw["song"], &song); err != nil {
		t.Fatalf("%s: %v", b, err)
	}
	// artist is always sent (it may be empty); source is always "local".
	if song["title"] != "Time" || song["artist"] != "" || song["source"] != "local" || len(song) != 3 {
		t.Fatalf("song json: %s", b)
	}
	var out Event
	if err := json.Unmarshal(b, &out); err != nil || out.Song == nil || *out.Song != *in.Song {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestLocalSong(t *testing.T) {
	if s := LocalSong("  ", "Artist"); s != nil {
		t.Fatalf("blank title: %+v", s)
	}
	s := LocalSong("  Title \n", " Artist ")
	if s == nil || *s != (Song{Title: "Title", Artist: "Artist", Source: "local"}) {
		t.Fatalf("trimmed: %+v", s)
	}
	long := strings.Repeat("é", 250)
	s = LocalSong(long, long)
	if utf8.RuneCountInString(s.Title) != 200 || utf8.RuneCountInString(s.Artist) != 200 || !utf8.ValidString(s.Title) {
		t.Fatalf("capped: %d %d", utf8.RuneCountInString(s.Title), utf8.RuneCountInString(s.Artist))
	}
	// Capping must not leave trailing whitespace behind.
	s = LocalSong(strings.Repeat("a", 199)+" b", "x")
	if s.Title != strings.Repeat("a", 199) {
		t.Fatalf("cap then trim: %q", s.Title)
	}
}

// utf16Len is the length JavaScript's String.length reports.
func utf16Len(s string) int { return len(utf16.Encode([]rune(s))) }

func TestLocalSongCapsAtUTF16CodeUnits(t *testing.T) {
	// Each emoji is 2 UTF-16 code units: 150 emoji = 300 units, capped to 100 emoji.
	s := LocalSong(strings.Repeat("😀", 150), strings.Repeat("😀", 150))
	if utf16Len(s.Title) != 200 || utf16Len(s.Artist) != 200 || utf8.RuneCountInString(s.Title) != 100 {
		t.Fatalf("emoji cap: %d units, %d runes", utf16Len(s.Title), utf8.RuneCountInString(s.Title))
	}
	// A surrogate pair is never split: 199 units + an emoji does not fit.
	s = LocalSong(strings.Repeat("a", 199)+"😀", "x")
	if s.Title != strings.Repeat("a", 199) || !utf8.ValidString(s.Title) {
		t.Fatalf("pair split: %q", s.Title)
	}
	// Exactly 200 units is kept as is.
	in := strings.Repeat("a", 198) + "😀"
	if s = LocalSong(in, ""); s.Title != in {
		t.Fatalf("200 units trimmed: %q", s.Title)
	}
}
