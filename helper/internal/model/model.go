// Package model defines the event wire format shared with the site (spec section 7).
package model

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// PlayerRef identifies a player as the game reports them.
type PlayerRef struct {
	Name string `json:"name"`
	Team int    `json:"team"`
}

// Event is one helper event. Which fields are set depends on Kind.
// At is serialised as RFC3339 with milliseconds in UTC.
type Event struct {
	Kind      string         `json:"kind"`
	MatchGUID string         `json:"matchGuid"`
	At        time.Time      `json:"at"`
	GameTime  *float64       `json:"gameTime,omitempty"`
	Scorer    *PlayerRef     `json:"scorer,omitempty"`
	Assister  *PlayerRef     `json:"assister,omitempty"`
	Player    *PlayerRef     `json:"player,omitempty"`
	Attacker  *PlayerRef     `json:"attacker,omitempty"`
	Victim    *PlayerRef     `json:"victim,omitempty"`
	Players   []PlayerRef    `json:"players,omitempty"`
	Score     map[string]int `json:"score,omitempty"`
	// Song is the track playing on this PC when the event happened (stat
	// events and heartbeats only); nil when nothing is playing.
	Song *Song `json:"song,omitempty"`
}

// Song is a track read from the local media player.
type Song struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Source string `json:"source"` // always "local"
}

// SongFieldMax is the longest title or artist the site accepts (in characters).
const SongFieldMax = 200

// LocalSong builds a "local" Song with title and artist trimmed and capped
// at SongFieldMax characters. It returns nil when the title is blank.
func LocalSong(title, artist string) *Song {
	title, artist = capField(title), capField(artist)
	if title == "" {
		return nil
	}
	return &Song{Title: title, Artist: artist, Source: "local"}
}

func capField(s string) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= SongFieldMax {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:SongFieldMax]))
}

// TimeLayout is RFC3339 with milliseconds; times are always sent in UTC.
const TimeLayout = "2006-01-02T15:04:05.000Z07:00"

// FormatTime renders t as RFC3339 with milliseconds in UTC.
func FormatTime(t time.Time) string { return t.UTC().Format(TimeLayout) }

type eventAlias Event

// MarshalJSON writes At as RFC3339 with milliseconds in UTC.
func (e Event) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		eventAlias
		At string `json:"at"`
	}{eventAlias(e), FormatTime(e.At)})
}

// UnmarshalJSON accepts any RFC3339 timestamp for At (used by the on-disk queue).
func (e *Event) UnmarshalJSON(b []byte) error {
	aux := struct {
		*eventAlias
		At string `json:"at"`
	}{eventAlias: (*eventAlias)(e)}
	if err := json.Unmarshal(b, &aux); err != nil {
		return err
	}
	t, err := time.Parse(time.RFC3339Nano, aux.At)
	if err != nil {
		return err
	}
	e.At = t
	return nil
}
