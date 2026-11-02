package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

func TestPostEventsSendsBatch(t *testing.T) {
	var gotAuth, gotUA, gotPath string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotUA, gotPath = r.Header.Get("Authorization"), r.Header.Get("User-Agent"), r.URL.Path
		json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(200)
		w.Write([]byte(`{"results":[{"status":"recorded","id":"abc","song":"Hey","actorDisplay":"Zach"}]}`))
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, Key: "k", Version: "1.2.3"}
	gt := 12.5
	at := time.Date(2026, 11, 2, 5, 6, 7, 123_000_000, time.FixedZone("x", 3600))
	res, err := c.PostEvents(context.Background(), []model.Event{{Kind: "goal", MatchGUID: "g", At: at, GameTime: &gt, Scorer: &model.PlayerRef{Name: "Z", Team: 0}}}, at)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/rl/v1/events" || gotAuth != "Bearer k" || gotUA != "RLGoalTracker/1.2.3" {
		t.Fatalf("path=%q auth=%q ua=%q", gotPath, gotAuth, gotUA)
	}
	if body["helperVersion"] != "1.2.3" || body["sentAt"] != "2026-11-02T04:06:07.123Z" {
		t.Fatalf("body %v", body)
	}
	ev := body["events"].([]any)[0].(map[string]any)
	if ev["kind"] != "goal" || ev["gameTime"] != 12.5 || ev["at"] != "2026-11-02T04:06:07.123Z" {
		t.Fatalf("event %v", ev)
	}
	if _, ok := ev["assister"]; ok {
		t.Fatal("assister should be omitted")
	}
	if len(res) != 1 || res[0] != (Result{Status: "recorded", ID: "abc", Song: "Hey", ActorDisplay: "Zach"}) {
		t.Fatalf("res %+v", res)
	}
}

func TestPostEventsErrors(t *testing.T) {
	long := strings.Repeat("x", 800)
	cases := []struct {
		status int
		body   string
		check  func(error) bool
	}{
		{401, `{"error":"invalid_key"}`, func(e error) bool { return errors.Is(e, ErrUnauthorized) }},
		{503, `{"error":"unavailable"}`, func(e error) bool { return errors.Is(e, ErrRetryable) }},
		{429, `{"error":"rate_limited"}`, func(e error) bool { return errors.Is(e, ErrRetryable) }},
		{400, long, func(e error) bool {
			var r ErrRejected
			return errors.As(e, &r) && r.Status == 400 && len(r.Body) == 500
		}},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			w.Write([]byte(tc.body))
		}))
		c := &Client{BaseURL: srv.URL, Key: "k"}
		_, err := c.PostEvents(context.Background(), nil, time.Now())
		srv.Close()
		if !tc.check(err) {
			t.Errorf("status %d: got %v", tc.status, err)
		}
	}
}

func TestPostEventsNetworkErrorRetryable(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	c := &Client{BaseURL: url, Key: "k"}
	if _, err := c.PostEvents(context.Background(), nil, time.Now()); !errors.Is(err, ErrRetryable) {
		t.Fatalf("got %v", err)
	}
}

func TestPair(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]string
		json.NewDecoder(r.Body).Decode(&b)
		if r.URL.Path != "/api/rl/v1/pair" || r.Header.Get("Authorization") != "" {
			t.Errorf("path %q auth %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		if b["code"] == "good" && b["label"] == "u@pc" {
			w.WriteHeader(201)
			w.Write([]byte(`{"apiKey":"secret"}`))
			return
		}
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"code_expired"}`))
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL}
	key, err := c.Pair(context.Background(), "good", "u@pc")
	if err != nil || key != "secret" {
		t.Fatalf("key=%q err=%v", key, err)
	}
	if _, err := c.Pair(context.Background(), "bad", "u@pc"); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("got %v", err)
	}
}

func TestLatest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/rl/v1/helper/latest" {
			t.Errorf("path %q", r.URL.Path)
		}
		w.Write([]byte(`{"version":"1.1.0","downloadUrl":"https://x/h.exe"}`))
	}))
	defer srv.Close()
	v, u, err := (&Client{BaseURL: srv.URL + "/"}).Latest(context.Background())
	if err != nil || v != "1.1.0" || u != "https://x/h.exe" {
		t.Fatalf("%q %q %v", v, u, err)
	}
}

func TestPingSendsKeyAndAccepts204(t *testing.T) {
	var gotAuth, gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath, gotMethod = r.Header.Get("Authorization"), r.URL.Path, r.Method
		w.WriteHeader(204)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, Key: "k1"}
	if err := c.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	if gotMethod != "POST" || gotPath != "/api/rl/v1/ping" || gotAuth != "Bearer k1" {
		t.Fatalf("method=%q path=%q auth=%q", gotMethod, gotPath, gotAuth)
	}
}

func TestPingUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(401)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, Key: "bad"}
	if err := c.Ping(context.Background()); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("got %v", err)
	}
}

// Only 400/422 reject an event; any other non-success status is the server's
// problem and is retried (final review I3).
func TestPostEventsStatusClassification(t *testing.T) {
	for _, st := range []int{400, 422} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(st) }))
		_, err := (&Client{BaseURL: srv.URL, Key: "k"}).PostEvents(context.Background(), nil, time.Now())
		srv.Close()
		var r ErrRejected
		if !errors.As(err, &r) || r.Status != st {
			t.Errorf("status %d: want ErrRejected, got %v", st, err)
		}
	}
	for _, st := range []int{403, 404, 405, 408, 409, 413, 418, 500, 502} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(st) }))
		_, err := (&Client{BaseURL: srv.URL, Key: "k"}).PostEvents(context.Background(), nil, time.Now())
		srv.Close()
		if !errors.Is(err, ErrRetryable) {
			t.Errorf("status %d: want ErrRetryable, got %v", st, err)
		}
	}
}

// A redirect must never turn the POST into a GET (final review minor).
func TestPostEventsRefusesRedirect(t *testing.T) {
	var gets int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			gets++
			w.Write([]byte(`{"results":[]}`))
			return
		}
		http.Redirect(w, r, "/elsewhere", http.StatusMovedPermanently)
	}))
	defer srv.Close()
	_, err := (&Client{BaseURL: srv.URL, Key: "k"}).PostEvents(context.Background(), nil, time.Now())
	if !errors.Is(err, ErrRetryable) {
		t.Fatalf("want ErrRetryable, got %v", err)
	}
	if gets != 0 {
		t.Fatalf("redirect was followed as GET %d times", gets)
	}
	// Ping is a POST too.
	if err := (&Client{BaseURL: srv.URL, Key: "k"}).Ping(context.Background()); !errors.Is(err, ErrRetryable) || gets != 0 {
		t.Fatalf("ping: %v gets=%d", err, gets)
	}
}

func TestPostEventsResultCountMismatchRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"results":[{"status":"recorded"}]}`))
	}))
	defer srv.Close()
	evs := []model.Event{{Kind: "goal", MatchGUID: "g"}, {Kind: "goal", MatchGUID: "g"}}
	if _, err := (&Client{BaseURL: srv.URL, Key: "k"}).PostEvents(context.Background(), evs, time.Now()); !errors.Is(err, ErrRetryable) {
		t.Fatalf("got %v", err)
	}
}
