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
	loadKey = func() (string, error) { return "k", nil }
	replayDrainWait = 10 * time.Second

	if code := runReplay(srv.URL, "testdata/match-tcp.bin"); code != 0 {
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
	loadKey = func() (string, error) { return "", nil }
	if code := runReplay("http://127.0.0.1:1", "testdata/match-tcp.bin"); code != 1 {
		t.Fatalf("exit %d", code)
	}
}
