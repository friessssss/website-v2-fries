package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestReplayUploadsFixture(t *testing.T) {
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
	defer srv.Close()
	stubReplay(t, "k")

	if code := runReplay(srv.URL, true, "testdata/match-tcp.bin"); code != 0 {
		t.Fatalf("exit %d", code)
	}
	mu.Lock()
	defer mu.Unlock()
	var kinds []string
	for _, e := range got {
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
