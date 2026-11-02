package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// stubReplay replaces the package vars for one test.
func stubReplay(t *testing.T, key string) *bool {
	t.Helper()
	oldKey, oldWait := loadKey, replayDrainWait
	t.Cleanup(func() { loadKey, replayDrainWait = oldKey, oldWait })
	called := false
	loadKey = func() (string, error) { called = true; return key, nil }
	replayDrainWait = 10 * time.Second
	return &called
}

// eventServer records uploaded events.
func eventServer(t *testing.T) (*httptest.Server, func() []model.Event) {
	t.Helper()
	var mu sync.Mutex
	var got []model.Event
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/rl/v1/events" || r.Header.Get("Authorization") != "Bearer k" {
			http.Error(w, r.URL.Path+" "+r.Header.Get("Authorization"), http.StatusNotFound)
			return
		}
		var body struct{ Events []model.Event }
		json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		got = append(got, body.Events...)
		mu.Unlock()
		res := make([]map[string]string, len(body.Events))
		for i := range res {
			res[i] = map[string]string{"status": "ok"}
		}
		json.NewEncoder(w).Encode(map[string]any{"results": res})
	}))
	t.Cleanup(srv.Close)
	return srv, func() []model.Event {
		mu.Lock()
		defer mu.Unlock()
		return append([]model.Event(nil), got...)
	}
}

func TestReplayUploadsFixture(t *testing.T) {
	srv, uploaded := eventServer(t)
	stubReplay(t, "k")

	if code := runReplay(srv.URL, true, "testdata/match-tcp.bin"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	var kinds []string
	for _, e := range uploaded() {
		kinds = append(kinds, e.Kind)
	}
	want := []string{"match_start", "goal", "goal", "save", "goal", "demo", "match_end"}
	if len(kinds) != len(want) {
		t.Fatalf("uploaded %v", kinds)
	}
	for i := range want {
		if kinds[i] != want[i] {
			t.Fatalf("uploaded %v", kinds)
		}
	}
}

func TestReplayNoKey(t *testing.T) {
	stubReplay(t, "")
	if code := runReplay("http://127.0.0.1:1", true, "testdata/match-tcp.bin"); code != 1 {
		t.Fatalf("exit %d", code)
	}
}

func TestReplayRefusesProductionBaseURL(t *testing.T) {
	for _, c := range []struct {
		base     string
		explicit bool
	}{
		{baseURL, false}, // --base-url not passed
		{"http://localhost:3000", false},
		{baseURL, true}, // passed, but it is the compiled site
		{baseURL + "/", true},
		{"https://zachrobertson.co", true}, // any spelling of the live site
		{"https://www.zachrobertson.co/", true},
		{"http://WWW.ZachRobertson.co:443/api", true},
		{"https://zachrobertson.co.", true},
	} {
		called := stubReplay(t, "k")
		if code := runReplay(c.base, c.explicit, "testdata/match-tcp.bin"); code != 1 || *called {
			t.Fatalf("%+v: exit %d, key loaded %v", c, code, *called)
		}
	}
}

func TestReplayStopsOnUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	defer srv.Close()
	stubReplay(t, "k")
	replayDrainWait = 30 * time.Second
	start := time.Now()
	if code := runReplay(srv.URL, true, "testdata/match-tcp.bin"); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if d := time.Since(start); d > 10*time.Second {
		t.Fatalf("took %v", d)
	}
}

func TestReplayTruncatedAfterGoalUploadsGoal(t *testing.T) {
	b, err := os.ReadFile("testdata/match-tcp.bin")
	if err != nil {
		t.Fatal(err)
	}
	// Cut the capture right after the first live GoalScored message.
	i := bytes.Index(b, []byte(`{"Event":"GoalScored"`))
	j := bytes.Index(b[i+1:], []byte(`{"Event":`))
	path := filepath.Join(t.TempDir(), "cut.bin")
	os.WriteFile(path, b[:i+1+j], 0o644)

	srv, uploaded := eventServer(t)
	stubReplay(t, "k")
	if code := runReplay(srv.URL, true, path); code != 0 {
		t.Fatalf("exit %d", code)
	}
	evs := uploaded()
	if len(evs) != 2 || evs[0].Kind != "match_start" || evs[1].Kind != "goal" || evs[1].Scorer.Name != "OppPlayer1" {
		t.Fatalf("uploaded %+v", evs)
	}
}
