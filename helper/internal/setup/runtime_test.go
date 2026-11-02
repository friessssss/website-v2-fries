package setup

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/app"
)

func TestStateText(t *testing.T) {
	cases := []struct {
		s    app.State
		n    int
		want string
	}{
		{app.Idle, 0, "Waiting for Rocket League"},
		{app.Connected, 0, "Tracking"},
		{app.Queued, 3, "Offline — 3 events waiting"},
		{app.Queued, 1, "Offline — 1 event waiting"},
		{app.NeedsPair, 0, "Re-pair needed"},
		{app.Paused, 0, "Paused"},
	}
	for _, c := range cases {
		if got := StateText(c.s, c.n); got != c.want {
			t.Errorf("StateText(%v,%d)=%q want %q", c.s, c.n, got, c.want)
		}
	}
}

func TestGoalToast(t *testing.T) {
	if got := GoalToast("Ashton", "Midnight City"); got != "Ashton scored · Midnight City" {
		t.Fatal(got)
	}
	if got := GoalToast("Ashton", ""); got != "Ashton scored" {
		t.Fatal(got)
	}
}

func TestSettingsDefaultAndRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "settings.json")
	s := LoadSettings(p)
	if !s.Toasts {
		t.Fatal("toasts default on")
	}
	s.Toasts = false
	s.RLDir = `D:\Games\rocketleague`
	s.Shown = map[string]bool{"welcome": true}
	if err := SaveSettings(p, s); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	if !strings.Contains(string(b), `"toasts":false`) {
		t.Fatalf("file %s", b)
	}
	if got := LoadSettings(p); !reflect.DeepEqual(got, s) {
		t.Fatalf("got %+v", got)
	}
	os.WriteFile(p, []byte(`{"rlDir":"x"}`), 0o644)
	if got := LoadSettings(p); !got.Toasts || got.RLDir != "x" {
		t.Fatalf("missing toasts must default on: %+v", got)
	}
	os.WriteFile(p, []byte(`garbage`), 0o644)
	if got := LoadSettings(p); !got.Toasts {
		t.Fatal("corrupt file must give defaults")
	}
}

func TestSettingsStoreOncePersists(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	st := OpenSettings(p)
	if !st.Once("k") || st.Once("k") {
		t.Fatal("once semantics")
	}
	if err := st.Update(func(s *Settings) { s.Toasts = false }); err != nil {
		t.Fatal(err)
	}
	st2 := OpenSettings(p)
	if st2.Once("k") {
		t.Fatal("once key not persisted")
	}
	if st2.Get().Toasts {
		t.Fatal("toasts not persisted")
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); st2.Once(fmt.Sprint(i)) }(i)
	}
	wg.Wait()
	if n := len(OpenSettings(p).Get().Shown); n != 21 {
		t.Fatalf("shown %d", n)
	}
}

func TestLogTruncatesWhenLarge(t *testing.T) {
	p := filepath.Join(t.TempDir(), "helper.log")
	os.WriteFile(p, []byte(strings.Repeat("x", 2000)), 0o644)
	l, err := OpenLog(p, 1000)
	if err != nil {
		t.Fatal(err)
	}
	l.Logf("hello %d", 7)
	l.Close()
	b, _ := os.ReadFile(p)
	if strings.Contains(string(b), "xxx") || !strings.Contains(string(b), "hello 7\n") {
		t.Fatalf("log %q", b)
	}
	// Under the limit: appended, not truncated.
	l, _ = OpenLog(p, 1000)
	l.Logf("again")
	l.Close()
	b, _ = os.ReadFile(p)
	if !strings.Contains(string(b), "hello 7") || !strings.Contains(string(b), "again") {
		t.Fatalf("log %q", b)
	}
}

func TestSiteSetKeyIsUsedAndRaceFree(t *testing.T) {
	var mu sync.Mutex
	var auths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		auths = append(auths, r.Header.Get("Authorization"))
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer srv.Close()
	s := NewSite(api.Client{BaseURL: srv.URL, Key: "a"})
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); s.Ping(context.Background()) }()
		go func() { defer wg.Done(); s.SetKey("b") }()
	}
	wg.Wait()
	s.Ping(context.Background())
	mu.Lock()
	defer mu.Unlock()
	if auths[len(auths)-1] != "Bearer b" {
		t.Fatal(auths)
	}
}

// ---- controller ----

type fakeSink struct {
	mu    sync.Mutex
	texts []string
}

func (f *fakeSink) SetState(s app.State, text string) {
	f.mu.Lock()
	f.texts = append(f.texts, text)
	f.mu.Unlock()
}
func (f *fakeSink) last() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.texts) == 0 {
		return ""
	}
	return f.texts[len(f.texts)-1]
}

type fakeApp struct {
	pauses, resumes, needs atomic.Int32
}

func (a *fakeApp) Pause()        { a.pauses.Add(1) }
func (a *fakeApp) Resume()       { a.resumes.Add(1) }
func (a *fakeApp) SetNeedsPair() { a.needs.Add(1) }

type fakeSite struct {
	fakePairer
	mu      sync.Mutex
	keys    []string
	pingErr error
	pings   atomic.Int32
}

func (s *fakeSite) SetKey(k string) { s.mu.Lock(); s.keys = append(s.keys, k); s.mu.Unlock() }
func (s *fakeSite) Ping(ctx context.Context) error {
	s.pings.Add(1)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pingErr
}

type fakeKeys struct {
	mu      sync.Mutex
	saved   []string
	deleted int
}

func (k *fakeKeys) Save(s string) error {
	k.mu.Lock()
	k.saved = append(k.saved, s)
	k.mu.Unlock()
	return nil
}
func (k *fakeKeys) Delete() error { k.mu.Lock(); k.deleted++; k.mu.Unlock(); return nil }

func newCtl(d *fakeDialogs, site *fakeSite) (*Controller, *fakeSink, *fakeApp, *fakeKeys) {
	sink, a, keys := &fakeSink{}, &fakeApp{}, &fakeKeys{}
	c := &Controller{Dialogs: d, Site: site, Keys: keys, Label: "u@pc", Tray: sink, QueueLen: func() int { return 2 }, Logf: nolog}
	c.SetApp(a)
	return c, sink, a, keys
}

func TestControllerOnStateRendersText(t *testing.T) {
	c, sink, _, _ := newCtl(&fakeDialogs{}, &fakeSite{})
	c.OnState(app.Queued)
	if sink.last() != "Offline — 2 events waiting" {
		t.Fatal(sink.last())
	}
	if c.State() != app.Queued {
		t.Fatal(c.State())
	}
}

func TestControllerTogglePause(t *testing.T) {
	c, _, a, _ := newCtl(&fakeDialogs{}, &fakeSite{})
	c.TogglePause()
	c.TogglePause()
	if a.pauses.Load() != 1 || a.resumes.Load() != 1 {
		t.Fatal(a.pauses.Load(), a.resumes.Load())
	}
}

func TestControllerRepairSuccess(t *testing.T) {
	site := &fakeSite{fakePairer: fakePairer{key: "newkey"}}
	c, _, a, keys := newCtl(&fakeDialogs{codes: []string{"ABC123"}}, site)
	c.Repair(context.Background())
	// Save overwrites the stored key; deleting first could lose both keys
	// if the save then failed (final review minor).
	if keys.deleted != 0 || len(keys.saved) != 1 || keys.saved[0] != "newkey" {
		t.Fatalf("keys %+v", keys)
	}
	if len(site.keys) != 1 || site.keys[0] != "newkey" || a.resumes.Load() != 1 {
		t.Fatalf("site keys %q resumes %d", site.keys, a.resumes.Load())
	}
}

func TestControllerRepairCancelKeepsOldKey(t *testing.T) {
	site := &fakeSite{fakePairer: fakePairer{key: "newkey"}}
	c, _, a, keys := newCtl(&fakeDialogs{codes: []string{""}}, site)
	c.Repair(context.Background())
	if keys.deleted != 0 || len(keys.saved) != 0 || len(site.keys) != 0 || a.resumes.Load() != 0 {
		t.Fatal("cancel must change nothing")
	}
}

func TestControllerRepairNotReentrant(t *testing.T) {
	block := make(chan struct{})
	d := &blockingDialogs{fakeDialogs: fakeDialogs{codes: []string{"A"}}, block: block}
	site := &fakeSite{fakePairer: fakePairer{key: "k"}}
	sink, a, keys := &fakeSink{}, &fakeApp{}, &fakeKeys{}
	c := &Controller{Dialogs: d, Site: site, Keys: keys, Tray: sink, QueueLen: func() int { return 0 }, Logf: nolog}
	c.SetApp(a)
	done := make(chan struct{})
	go func() { c.Repair(context.Background()); close(done) }()
	waitUntil(t, func() bool { return d.asked.Load() == 1 })
	c.Repair(context.Background()) // second click while the dialog is open: ignored
	close(block)
	<-done
	if d.asked.Load() != 1 {
		t.Fatal("second repair opened another dialog")
	}
}

type blockingDialogs struct {
	fakeDialogs
	block chan struct{}
	asked atomic.Int32
}

func (b *blockingDialogs) AskPairingCode() (string, bool) {
	b.asked.Add(1)
	<-b.block
	return b.fakeDialogs.AskPairingCode()
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("timeout")
		}
		time.Sleep(time.Millisecond)
	}
}

// tickSleep returns a Sleep that waits for a tick per call and records durations.
func tickSleep(ticks chan struct{}, got *[]time.Duration, mu *sync.Mutex) func(context.Context, time.Duration) error {
	return func(ctx context.Context, d time.Duration) error {
		mu.Lock()
		*got = append(*got, d)
		mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticks:
			return nil
		}
	}
}

func TestPingLoopPingsImmediatelyThenEvery60s(t *testing.T) {
	site := &fakeSite{}
	c, _, _, _ := newCtl(&fakeDialogs{}, site)
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.PingLoop(ctx, tickSleep(ticks, &sleeps, &mu)); close(done) }()
	waitUntil(t, func() bool { return site.pings.Load() == 1 })
	ticks <- struct{}{}
	waitUntil(t, func() bool { return site.pings.Load() == 2 })
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if sleeps[0] != PingEvery || PingEvery != 60*time.Second {
		t.Fatal(sleeps)
	}
}

func TestPingLoopUnauthorizedSetsNeedsPair(t *testing.T) {
	site := &fakeSite{pingErr: api.ErrUnauthorized}
	c, _, a, _ := newCtl(&fakeDialogs{}, site)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	go c.PingLoop(ctx, tickSleep(ticks, &sleeps, &mu))
	waitUntil(t, func() bool { return a.needs.Load() == 1 })
}

func TestPingLoopSkipsWhenPausedOrNeedsPair(t *testing.T) {
	for _, s := range []app.State{app.Paused, app.NeedsPair} {
		site := &fakeSite{}
		c, _, _, _ := newCtl(&fakeDialogs{}, site)
		c.OnState(s)
		ctx, cancel := context.WithCancel(context.Background())
		ticks := make(chan struct{})
		var mu sync.Mutex
		var sleeps []time.Duration
		done := make(chan struct{})
		go func() { c.PingLoop(ctx, tickSleep(ticks, &sleeps, &mu)); close(done) }()
		ticks <- struct{}{}
		ticks <- struct{}{}
		cancel()
		<-done
		if n := site.pings.Load(); n != 0 {
			t.Fatalf("%v: pinged %d times", s, n)
		}
	}
}

func TestPingLoopRefreshesQueuedCount(t *testing.T) {
	site := &fakeSite{pingErr: api.ErrRetryable}
	sink, a := &fakeSink{}, &fakeApp{}
	var n atomic.Int32
	n.Store(2)
	c := &Controller{Dialogs: &fakeDialogs{}, Site: site, Keys: &fakeKeys{}, Tray: sink, QueueLen: func() int { return int(n.Load()) }, Logf: nolog}
	c.SetApp(a)
	c.OnState(app.Queued)
	n.Store(5)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	go c.PingLoop(ctx, tickSleep(ticks, &sleeps, &mu))
	waitUntil(t, func() bool { return sink.last() == "Offline — 5 events waiting" })
}

// ---- updater ----

func TestUpdaterDownloadsNewerThenRestartsWhenIdle(t *testing.T) {
	var downloads []string
	var restarted atomic.Int32
	var idle atomic.Bool
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	u := &Updater{
		Current: "1.0.0",
		Latest: func(ctx context.Context) (string, string, error) {
			return "helper-v1.1.0", "https://github.com/friessssss/website-v2-fries/releases/download/helper-v1.1.0/RLGoalTracker.exe", nil
		},
		Download: func(ctx context.Context, url, dest string) error {
			downloads = append(downloads, url+" -> "+dest)
			return nil
		},
		Dest:    "/inst/RLGoalTracker.new.exe",
		Idle:    idle.Load,
		Restart: func() { restarted.Add(1) },
		Logf:    nolog,
		Sleep:   tickSleep(ticks, &sleeps, &mu),
	}
	done := make(chan struct{})
	go func() { u.Loop(context.Background()); close(done) }()
	ticks <- struct{}{} // busy: wait another minute
	idle.Store(true)
	ticks <- struct{}{}
	<-done
	if len(downloads) != 1 || downloads[0] != "https://github.com/friessssss/website-v2-fries/releases/download/helper-v1.1.0/RLGoalTracker.exe -> /inst/RLGoalTracker.new.exe" {
		t.Fatal(downloads)
	}
	if restarted.Load() != 1 {
		t.Fatal("no restart")
	}
	mu.Lock()
	defer mu.Unlock()
	if sleeps[0] != RestartPoll {
		t.Fatal(sleeps)
	}
}

func TestUpdaterNotNewerChecksEvery12h(t *testing.T) {
	var checks atomic.Int32
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	u := &Updater{
		Current: "1.1.0",
		Latest: func(ctx context.Context) (string, string, error) {
			if checks.Add(1) == 1 {
				return "", "", errors.New("offline")
			}
			return "helper-v1.1.0", "u", nil
		},
		Download: func(ctx context.Context, url, dest string) error { t.Fatal("must not download"); return nil },
		Idle:     func() bool { return true },
		Restart:  func() { t.Fatal("must not restart") },
		Logf:     nolog,
		Sleep:    tickSleep(ticks, &sleeps, &mu),
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { u.Loop(ctx); close(done) }()
	ticks <- struct{}{}
	waitUntil(t, func() bool { return checks.Load() == 2 })
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if sleeps[0] != UpdateEvery || UpdateEvery != 12*time.Hour {
		t.Fatal(sleeps)
	}
}

func TestUpdaterRejectsNonGitHubURL(t *testing.T) {
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	var checks atomic.Int32
	u := &Updater{
		Current: "1.0.0",
		Latest: func(ctx context.Context) (string, string, error) {
			checks.Add(1)
			return "helper-v2.0.0", "https://evil.example/x.exe", nil
		},
		Download: func(ctx context.Context, url, dest string) error { t.Error("must not download"); return nil },
		Idle:     func() bool { return true },
		Restart:  func() { t.Error("must not restart") },
		Logf:     nolog,
		Sleep:    tickSleep(ticks, &sleeps, &mu),
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { u.Loop(ctx); close(done) }()
	waitUntil(t, func() bool { return checks.Load() == 1 })
	cancel()
	<-done
}

// ---- update restart loop (final review I1) ----

func TestUpdaterMarksPendingBeforeRestart(t *testing.T) {
	var order []string
	var mu sync.Mutex
	rec := func(s string) { mu.Lock(); order = append(order, s); mu.Unlock() }
	u := &Updater{
		Current: "1.0.0",
		Latest: func(ctx context.Context) (string, string, error) {
			return "helper-v1.1.0", "https://github.com/friessssss/website-v2-fries/releases/download/helper-v1.1.0/RLGoalTracker.exe", nil
		},
		Download:    func(ctx context.Context, url, dest string) error { return nil },
		Idle:        func() bool { return true },
		MarkPending: func(v string) { rec("pending " + v) },
		Restart:     func() { rec("restart") },
		Logf:        nolog,
		Sleep:       func(context.Context, time.Duration) error { return nil },
	}
	u.Loop(context.Background())
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(order, []string{"pending helper-v1.1.0", "restart"}) {
		t.Fatal(order)
	}
}

func TestUpdaterSkipsVersionButTakesNewer(t *testing.T) {
	ticks := make(chan struct{})
	var mu sync.Mutex
	var sleeps []time.Duration
	var checks atomic.Int32
	var downloads atomic.Int32
	restarted := make(chan struct{})
	u := &Updater{
		Current: "1.0.0",
		Latest: func(ctx context.Context) (string, string, error) {
			v := "helper-v1.1.0"
			if checks.Add(1) > 1 {
				v = "helper-v1.2.0"
			}
			return v, "https://github.com/friessssss/website-v2-fries/releases/download/" + v + "/RLGoalTracker.exe", nil
		},
		Skip:     func(v string) bool { return v == "helper-v1.1.0" },
		Download: func(ctx context.Context, url, dest string) error { downloads.Add(1); return nil },
		Idle:     func() bool { return true },
		Restart:  func() { close(restarted) },
		Logf:     nolog,
		Sleep:    tickSleep(ticks, &sleeps, &mu),
	}
	go u.Loop(context.Background())
	waitUntil(t, func() bool { return checks.Load() == 1 })
	if downloads.Load() != 0 {
		t.Fatal("skipped version was downloaded")
	}
	ticks <- struct{}{}
	<-restarted
	if downloads.Load() != 1 {
		t.Fatal("newer version not downloaded")
	}
	mu.Lock()
	defer mu.Unlock()
	if sleeps[0] != UpdateEvery {
		t.Fatal(sleeps)
	}
}

func TestResolvePendingUpdate(t *testing.T) {
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	// The swap took: the pending marker is cleared and nothing is skipped.
	s := Settings{PendingUpdate: "helper-v1.1.0"}
	ResolvePendingUpdate(&s, "1.1.0", now, nolog)
	if s.PendingUpdate != "" || s.SkipUpdate != "" {
		t.Fatalf("installed: %+v", s)
	}
	// Still on the old version: skip it for 12 h.
	s = Settings{PendingUpdate: "helper-v1.1.0"}
	ResolvePendingUpdate(&s, "1.0.0", now, nolog)
	if s.PendingUpdate != "" || s.SkipUpdate != "helper-v1.1.0" || !s.SkipUntil.Equal(now.Add(UpdateEvery)) {
		t.Fatalf("not installed: %+v", s)
	}
	if !s.SkipsUpdate("helper-v1.1.0", now.Add(time.Hour)) {
		t.Fatal("must skip within 12 h")
	}
	if !s.SkipsUpdate("v1.1.0", now.Add(time.Hour)) {
		t.Fatal("version spelling must not matter")
	}
	if s.SkipsUpdate("helper-v1.1.0", now.Add(UpdateEvery+time.Second)) {
		t.Fatal("must retry after 12 h")
	}
	if s.SkipsUpdate("helper-v1.2.0", now.Add(time.Hour)) {
		t.Fatal("a newer version is never skipped")
	}
	// No marker: nothing changes.
	s = Settings{SkipUpdate: "helper-v1.1.0", SkipUntil: now}
	ResolvePendingUpdate(&s, "1.0.0", now, nolog)
	if s.SkipUpdate != "helper-v1.1.0" {
		t.Fatalf("no marker: %+v", s)
	}
}

func TestSettingsPausedAndUpdateFieldsPersist(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	until := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	st := OpenSettings(p)
	if err := st.Update(func(s *Settings) {
		s.Paused = true
		s.PendingUpdate = "helper-v1.1.0"
		s.SkipUpdate = "helper-v1.0.5"
		s.SkipUntil = until
	}); err != nil {
		t.Fatal(err)
	}
	got := OpenSettings(p).Get()
	if !got.Paused || got.PendingUpdate != "helper-v1.1.0" || got.SkipUpdate != "helper-v1.0.5" || !got.SkipUntil.Equal(until) || !got.Toasts {
		t.Fatalf("got %+v", got)
	}
}

// ---- paused survives restarts (final review I2) ----

func TestControllerPersistsPause(t *testing.T) {
	c, _, a, _ := newCtl(&fakeDialogs{}, &fakeSite{})
	var saved []bool
	var mu sync.Mutex
	c.SavePaused = func(p bool) { mu.Lock(); saved = append(saved, p); mu.Unlock() }
	c.TogglePause()
	c.TogglePause()
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(saved, []bool{true, false}) || a.pauses.Load() != 1 {
		t.Fatal(saved, a.pauses.Load())
	}
}

func TestControllerRestorePausedThenToggleResumes(t *testing.T) {
	c, _, a, _ := newCtl(&fakeDialogs{}, &fakeSite{})
	var saved []bool
	c.SavePaused = func(p bool) { saved = append(saved, p) }
	c.RestorePaused(true)
	if a.pauses.Load() != 1 || len(saved) != 0 {
		t.Fatal("restore must pause without re-saving", a.pauses.Load(), saved)
	}
	c.TogglePause()
	if a.resumes.Load() != 1 || !reflect.DeepEqual(saved, []bool{false}) {
		t.Fatal("toggle after restore must resume", a.resumes.Load(), saved)
	}
}

func TestControllerRepairClearsSavedPause(t *testing.T) {
	site := &fakeSite{fakePairer: fakePairer{key: "newkey"}}
	c, _, _, _ := newCtl(&fakeDialogs{codes: []string{"ABC123"}}, site)
	var saved []bool
	c.SavePaused = func(p bool) { saved = append(saved, p) }
	c.RestorePaused(true)
	c.Repair(context.Background())
	if !reflect.DeepEqual(saved, []bool{false}) {
		t.Fatal(saved)
	}
}

func TestSettingsStoreForget(t *testing.T) {
	p := filepath.Join(t.TempDir(), "settings.json")
	st := OpenSettings(p)
	st.Once("k")
	st.Forget("k")
	if !OpenSettings(p).Once("k") {
		t.Fatal("forgotten key must be new again after reload")
	}
}
