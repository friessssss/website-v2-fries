package model

import (
	"encoding/json"
	"testing"
	"time"
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
