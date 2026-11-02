package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
	"github.com/friessssss/website-v2-fries/helper/internal/queue"
)

// ---- fakes ----

type item struct {
	raw json.RawMessage
	err error
}

type fakeStream struct{ ch chan item }

func (s *fakeStream) Next(ctx context.Context) (json.RawMessage, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case it := <-s.ch:
		return it.raw, it.err
	}
}

type fakeSource struct {
	inMatch atomic.Bool
	events  map[string][]model.Event
}

func (s *fakeSource) Feed(raw json.RawMessage) []model.Event { return s.events[string(raw)] }
func (s *fakeSource) InMatch() bool                          { return s.inMatch.Load() }

type fakePoster struct {
	mu      sync.Mutex
	batches [][]model.Event
	calls   int
	fn      func(call int, evs []model.Event) ([]api.Result, error)
}

func (p *fakePoster) PostEvents(ctx context.Context, evs []model.Event, at time.Time) ([]api.Result, error) {
	p.mu.Lock()
	p.calls++
	call := p.calls
	p.mu.Unlock()
	res, err := p.fn(call, evs)
	if err == nil {
		p.mu.Lock()
		p.batches = append(p.batches, evs)
		p.mu.Unlock()
	}
	return res, err
}
func (p *fakePoster) Calls() int { p.mu.Lock(); defer p.mu.Unlock(); return p.calls }
func (p *fakePoster) Delivered() []model.Event {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []model.Event
	for _, b := range p.batches {
		out = append(out, b...)
	}
	return out
}

func okAll(_ int, evs []model.Event) ([]api.Result, error) {
	out := make([]api.Result, len(evs))
	for i := range evs {
		out[i] = api.Result{Status: "recorded", ActorDisplay: "Zach", Song: "Song A"}
	}
	return out, nil
}

type harness struct {
	t       *testing.T
	q       *queue.Queue
	poster  *fakePoster
	src     *fakeSource
	stream  *fakeStream
	dials   atomic.Int32
	dialErr atomic.Bool
	hbTick  chan struct{}

	mu     sync.Mutex
	sleeps []time.Duration
	states []State
	goals  [][2]string
	deps   Deps
}

func goalEv(sec int) model.Event {
	return model.Event{Kind: "goal", MatchGUID: "m1", At: time.Date(2026, 1, 1, 0, 0, sec, 0, time.UTC)}
}

func newHarness(t *testing.T, fn func(int, []model.Event) ([]api.Result, error)) *harness {
	t.Helper()
	q, err := queue.Open(filepath.Join(t.TempDir(), "queue.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{t: t, q: q, poster: &fakePoster{fn: fn}, hbTick: make(chan struct{}),
		src: &fakeSource{events: map[string][]model.Event{}}, stream: &fakeStream{ch: make(chan item, 16)}}
	h.deps = Deps{
		Dial: func(ctx context.Context) (Stream, error) {
			h.dials.Add(1)
			if h.dialErr.Load() {
				return nil, errors.New("refused")
			}
			return h.stream, nil
		},
		NewSource: func() Source { return h.src },
		Poster:    h.poster,
		Queue:     q,
		Now:       func() time.Time { return time.Date(2026, 1, 1, 0, 1, 0, 0, time.UTC) },
		Sleep: func(ctx context.Context, d time.Duration) error {
			h.mu.Lock()
			h.sleeps = append(h.sleeps, d)
			h.mu.Unlock()
			if d == HeartbeatEvery {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-h.hbTick:
					return nil
				}
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Millisecond):
				return nil
			}
		},
		OnState: func(s State) { h.mu.Lock(); h.states = append(h.states, s); h.mu.Unlock() },
		OnGoal:  func(d, s string) { h.mu.Lock(); h.goals = append(h.goals, [2]string{d, s}); h.mu.Unlock() },
		Logf:    func(f string, a ...any) { t.Logf(f, a...) },
	}
	return h
}

func (h *harness) start() (*App, context.CancelFunc, <-chan struct{}) {
	a := New(h.deps)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { a.Run(ctx); close(done) }()
	h.t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			h.t.Error("Run did not return after cancel (goroutine leak)")
		}
	})
	return a, cancel, done
}

func (h *harness) sleepsOf(skip ...time.Duration) []time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []time.Duration
outer:
	for _, d := range h.sleeps {
		for _, s := range skip {
			if d == s {
				continue outer
			}
		}
		out = append(out, d)
	}
	return out
}

func (h *harness) stateList() []State {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]State(nil), h.states...)
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func hasState(h *harness, s State) bool {
	for _, x := range h.stateList() {
		if x == s {
			return true
		}
	}
	return false
}

// ---- tests ----

func TestGoalFlowsFromStreamToPosterAndToast(t *testing.T) {
	h := newHarness(t, okAll)
	h.src.events["g1"] = []model.Event{goalEv(1)}
	h.stream.ch <- item{raw: json.RawMessage("g1")}
	h.start()
	waitFor(t, "delivery", func() bool { return len(h.poster.Delivered()) == 1 })
	waitFor(t, "queue drained", func() bool { return h.q.Len() == 0 })
	waitFor(t, "toast", func() bool { h.mu.Lock(); defer h.mu.Unlock(); return len(h.goals) == 1 })
	if h.goals[0] != [2]string{"Zach", "Song A"} {
		t.Fatalf("goal callback %v", h.goals[0])
	}
	if !hasState(h, Connected) {
		t.Fatalf("states %v", h.stateList())
	}
}

func TestOnGoalFiltering(t *testing.T) {
	disp := []string{"Opponent", "Teammate", "Zach"}
	h := newHarness(t, func(_ int, evs []model.Event) ([]api.Result, error) {
		out := make([]api.Result, len(evs))
		for i := range evs {
			out[i] = api.Result{Status: "recorded", ActorDisplay: disp[i%3], Song: "S"}
		}
		return out, nil
	})
	// goal x3 (Opponent, Teammate, Zach), then a goal that is a duplicate, then a non-goal.
	evs := []model.Event{goalEv(1), goalEv(2), goalEv(3), goalEv(4), {Kind: "heartbeat", MatchGUID: "m1", At: goalEv(5).At}}
	h.q.Push(evs...)
	h.dialErr.Store(true)
	// Third in disp cycle for index 3 is "Opponent"; make index 3 a duplicate result instead.
	h.poster.fn = func(_ int, evs []model.Event) ([]api.Result, error) {
		return []api.Result{
			{Status: "recorded", ActorDisplay: "Opponent"},
			{Status: "recorded", ActorDisplay: "Teammate"},
			{Status: "recorded", ActorDisplay: "Zach", Song: "S"},
			{Status: "duplicate", ActorDisplay: "Zach", Song: "S"},
			{Status: "recorded", ActorDisplay: "Zach", Song: "S"}, // heartbeat: not a goal
		}, nil
	}
	h.start()
	waitFor(t, "drain", func() bool { return h.q.Len() == 0 })
	time.Sleep(20 * time.Millisecond)
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.goals) != 1 || h.goals[0] != [2]string{"Zach", "S"} {
		t.Fatalf("goals %v", h.goals)
	}
}

func TestRetryableBackoffThenDelivery(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if call <= 3 || call == 5 {
			return nil, api.ErrRetryable
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true) // isolate the flusher
	h.q.Push(goalEv(1))
	h.start()
	waitFor(t, "delivery", func() bool { return len(h.poster.Delivered()) == 1 })

	// Skip 5s dial retries; flusher sequence starts with the three backoffs.
	got := h.sleepsOf(DialRetry, HeartbeatEvery)
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second}
	if len(got) < 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("sleeps %v want prefix %v", got, want)
	}
	// Queued appeared before the delivery, and Idle is where it ended up.
	waitFor(t, "state recovers", func() bool { return len(h.stateList()) >= 2 })
	st := h.stateList()
	if st[0] != Queued {
		t.Fatalf("states %v", st)
	}
	if st[len(st)-1] != Idle {
		t.Fatalf("states %v", st)
	}

	// Backoff resets after success: next failure sleeps 2s again.
	h.q.Push(goalEv(2)) // call 4 delivers? call 4 already used; this is call 5 -> fail, 6 -> ok
	waitFor(t, "second delivery", func() bool { return len(h.poster.Delivered()) == 2 })
	got = h.sleepsOf(DialRetry, HeartbeatEvery)
	after := got[3:]
	found := false
	for i, d := range after {
		if d == 2*time.Second && i+1 < len(after) {
			found = true
		}
		if d == 4*time.Second || d == 8*time.Second {
			t.Fatalf("backoff not reset: %v", got)
		}
	}
	if !found {
		t.Fatalf("sleeps %v", got)
	}
}

func TestBackoffCapsAt60s(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if call <= 8 {
			return nil, api.ErrRetryable
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	h.q.Push(goalEv(1))
	h.start()
	waitFor(t, "delivery", func() bool { return len(h.poster.Delivered()) == 1 })
	got := h.sleepsOf(DialRetry, HeartbeatEvery)
	want := []time.Duration{2, 4, 8, 16, 32, 60, 60, 60}
	for i, w := range want {
		if got[i] != w*time.Second {
			t.Fatalf("sleeps %v", got)
		}
	}
}

func TestUnauthorizedStopsUntilResume(t *testing.T) {
	var unauth atomic.Bool
	unauth.Store(true)
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if unauth.Load() {
			return nil, api.ErrUnauthorized
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	h.q.Push(goalEv(1))
	a, _, _ := h.start()
	waitFor(t, "NeedsPair", func() bool { return hasState(h, NeedsPair) })
	time.Sleep(50 * time.Millisecond)
	if c := h.poster.Calls(); c != 1 {
		t.Fatalf("posts after 401: %d", c)
	}
	if h.q.Len() != 1 {
		t.Fatal("event must stay queued")
	}
	unauth.Store(false)
	a.Resume()
	waitFor(t, "delivery after resume", func() bool { return len(h.poster.Delivered()) == 1 })
}

func TestSingleRejectionIsRetriedNotDropped(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if call == 1 {
			return nil, api.ErrRejected{Status: 400, Body: "bad"}
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	h.q.Push(goalEv(1))
	h.start()
	// One 400 is not enough to drop: the event is held and delivered on retry.
	waitFor(t, "first delivered on retry", func() bool { return len(h.poster.Delivered()) == 1 })
	h.q.Push(goalEv(2))
	waitFor(t, "second delivered", func() bool { return len(h.poster.Delivered()) == 2 })
	if hasState(h, NeedsPair) {
		t.Fatal("rejection must not need pairing")
	}
}

func TestBatchesCappedAt50(t *testing.T) {
	h := newHarness(t, okAll)
	h.dialErr.Store(true)
	for i := 0; i < 120; i++ {
		h.q.Push(goalEv(i % 60))
	}
	h.start()
	waitFor(t, "drain", func() bool { return h.q.Len() == 0 })
	h.poster.mu.Lock()
	defer h.poster.mu.Unlock()
	for _, b := range h.poster.batches {
		if len(b) > 50 {
			t.Fatalf("batch of %d", len(b))
		}
	}
	if len(h.poster.batches) != 3 {
		t.Fatalf("batches %d", len(h.poster.batches))
	}
}

func TestStreamEOFRedialsAfter5s(t *testing.T) {
	h := newHarness(t, okAll)
	h.stream.ch <- item{err: io.EOF}
	h.start()
	waitFor(t, "second dial", func() bool { return h.dials.Load() >= 2 })
	found := false
	for _, d := range h.sleepsOf() {
		if d == 5*time.Second {
			found = true
		}
	}
	if !found {
		t.Fatalf("sleeps %v", h.sleepsOf())
	}
	waitFor(t, "connected then idle then connected", func() bool {
		st := h.stateList()
		return len(st) >= 3 && st[0] == Connected && st[1] == Idle && st[2] == Connected
	})
}

func TestHeartbeatOnlyInMatch(t *testing.T) {
	h := newHarness(t, func(int, []model.Event) ([]api.Result, error) { return nil, api.ErrRetryable })
	h.src.events["g"] = []model.Event{goalEv(1)}
	h.stream.ch <- item{raw: json.RawMessage("g")}
	h.start()
	waitFor(t, "goal queued", func() bool { return h.q.Len() >= 1 })

	count := func() int {
		n := 0
		for _, e := range h.q.Peek(1000) {
			if e.Kind == "heartbeat" {
				n++
			}
		}
		return n
	}
	h.hbTick <- struct{}{}
	h.hbTick <- struct{}{} // second send proves the first tick was fully processed
	if count() != 0 {
		t.Fatal("heartbeat pushed while not in match")
	}
	h.src.inMatch.Store(true)
	h.hbTick <- struct{}{}
	h.hbTick <- struct{}{}
	if n := count(); n < 1 {
		t.Fatalf("no heartbeat in match (%d)", n)
	}
	for _, e := range h.q.Peek(1000) {
		if e.Kind == "heartbeat" && e.MatchGUID != "m1" {
			t.Fatalf("heartbeat guid %q", e.MatchGUID)
		}
	}
}

func TestOfflineEventsSurviveRestartWithOriginalAt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "queue.jsonl")
	q1, _ := queue.Open(path)
	orig := goalEv(7)
	orig.At = time.Date(2026, 1, 1, 0, 0, 7, 123e6, time.UTC)
	q1.Push(orig)

	// "Restart": a new queue from disk, new app, network now works.
	q2, err := queue.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, okAll)
	h.q, h.deps.Queue = q2, q2
	h.dialErr.Store(true)
	h.start()
	waitFor(t, "late upload", func() bool { return len(h.poster.Delivered()) == 1 })
	if got := h.poster.Delivered()[0]; !got.At.Equal(orig.At) {
		t.Fatalf("at changed: %v vs %v", got.At, orig.At)
	}
}

func TestPauseStopsReadingAndFlushing(t *testing.T) {
	h := newHarness(t, okAll)
	h.dialErr.Store(true)
	a, _, _ := h.start()
	a.Pause()
	waitFor(t, "Paused", func() bool { return hasState(h, Paused) })
	h.q.Push(goalEv(1))
	time.Sleep(50 * time.Millisecond)
	if h.poster.Calls() != 0 {
		t.Fatal("flushed while paused")
	}
	d := h.dials.Load()
	time.Sleep(30 * time.Millisecond)
	if h.dials.Load() != d {
		t.Fatal("dialing while paused")
	}
	a.Resume()
	waitFor(t, "delivery after resume", func() bool { return len(h.poster.Delivered()) == 1 })
}

func TestStateCallbackOnlyOnChange(t *testing.T) {
	h := newHarness(t, okAll)
	h.start()
	waitFor(t, "connected", func() bool { return hasState(h, Connected) })
	time.Sleep(30 * time.Millisecond)
	st := h.stateList()
	for i := 1; i < len(st); i++ {
		if st[i] == st[i-1] {
			t.Fatalf("repeated state %v", st)
		}
	}
}

func TestRunReturnsOnCancel(t *testing.T) {
	h := newHarness(t, okAll)
	_, cancel, done := h.start()
	waitFor(t, "connected", func() bool { return hasState(h, Connected) })
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return")
	}
}

// ---- fix round 1 ----

func TestPauseAfterRepairResumeStopsReader(t *testing.T) {
	h := newHarness(t, func(int, []model.Event) ([]api.Result, error) { return nil, api.ErrUnauthorized })
	h.q.Push(goalEv(1))
	a, _, _ := h.start()
	waitFor(t, "NeedsPair", func() bool { return hasState(h, NeedsPair) })
	a.Resume()
	waitFor(t, "redial", func() bool { return h.dials.Load() >= 2 })
	waitFor(t, "NeedsPair again", func() bool { return a.currentState() == NeedsPair })
	a.Pause()
	waitFor(t, "Paused", func() bool { return a.currentState() == Paused })
	h.src.events["late"] = []model.Event{goalEv(9)}
	before := h.q.Len()
	h.stream.ch <- item{raw: json.RawMessage("late")}
	time.Sleep(60 * time.Millisecond)
	if h.q.Len() != before || len(h.stream.ch) != 1 {
		t.Fatalf("reader still active after Pause: queue %d->%d, pending items %d", before, h.q.Len(), len(h.stream.ch))
	}
}

func TestOnStateSerialisedAndOrdered(t *testing.T) {
	q, _ := queue.Open(filepath.Join(t.TempDir(), "q"))
	var inflight, overlap atomic.Int32
	var last atomic.Int32
	last.Store(-1)
	a := New(Deps{Queue: q, OnState: func(s State) {
		if inflight.Add(1) > 1 {
			overlap.Add(1)
		}
		time.Sleep(50 * time.Microsecond)
		last.Store(int32(s))
		inflight.Add(-1)
	}})
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				a.setConnected((i+g)%2 == 0)
			}
		}(g)
	}
	wg.Wait()
	a.setConnected(true)
	if overlap.Load() != 0 {
		t.Fatalf("%d overlapping callbacks", overlap.Load())
	}
	if State(last.Load()) != Connected || a.currentState() != Connected {
		t.Fatalf("stale final state %v vs %v", State(last.Load()), a.currentState())
	}
}

func TestHeartbeatSkippedWithoutGUIDAndGUIDResetOnNewSource(t *testing.T) {
	h := newHarness(t, func(int, []model.Event) ([]api.Result, error) { return nil, api.ErrRetryable })
	h.src.inMatch.Store(true)
	a, _, _ := h.start()
	waitFor(t, "connected", func() bool { return hasState(h, Connected) })
	for i := 0; i < 3; i++ {
		h.hbTick <- struct{}{}
	}
	if h.q.Len() != 0 {
		t.Fatalf("heartbeat with empty guid pushed: %+v", h.q.Peek(5))
	}
	h.src.events["g"] = []model.Event{goalEv(1)}
	h.stream.ch <- item{raw: json.RawMessage("g")}
	waitFor(t, "guid learned", func() bool {
		a.srcMu.Lock()
		defer a.srcMu.Unlock()
		return a.guid == "m1"
	})
	h.stream.ch <- item{err: io.EOF}
	waitFor(t, "redial", func() bool { return h.dials.Load() >= 2 })
	waitFor(t, "guid reset", func() bool {
		a.srcMu.Lock()
		defer a.srcMu.Unlock()
		return a.src != nil && a.guid == ""
	})
}

func TestRejectedBatchResentIndividually(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		for _, e := range evs {
			if e.At.Second() == 2 { // the bad one
				return nil, api.ErrRejected{Status: 400, Body: "bad_event"}
			}
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	h.q.Push(goalEv(1), goalEv(2), goalEv(3))
	h.start()
	waitFor(t, "drain", func() bool { return h.q.Len() == 0 })
	got := h.poster.Delivered()
	if len(got) != 2 || got[0].At.Second() != 1 || got[1].At.Second() != 3 {
		t.Fatalf("delivered %+v", got)
	}
}

// failQueue fails Push while fail is set.
type failQueue struct {
	*queue.Queue
	fail atomic.Bool
}

func (f *failQueue) Push(evs ...model.Event) error {
	if f.fail.Load() {
		return errors.New("disk full")
	}
	return f.Queue.Push(evs...)
}

func TestFailedQueuePushIsRetriedNotLost(t *testing.T) {
	h := newHarness(t, okAll)
	fq := &failQueue{Queue: h.q}
	fq.fail.Store(true)
	h.deps.Queue = fq
	h.src.events["g"] = []model.Event{goalEv(1)}
	h.stream.ch <- item{raw: json.RawMessage("g")}
	h.start()
	waitFor(t, "read attempted", func() bool { return len(h.stream.ch) == 0 })
	time.Sleep(20 * time.Millisecond)
	if h.poster.Calls() != 0 || h.q.Len() != 0 {
		t.Fatal("nothing should be persisted while push fails")
	}
	fq.fail.Store(false)
	waitFor(t, "delivered after recovery", func() bool { return len(h.poster.Delivered()) == 1 })
}

func TestSetNeedsPairShowsStateAndBlocksFlushUntilResume(t *testing.T) {
	h := newHarness(t, okAll)
	h.dialErr.Store(true)
	a, _, _ := h.start()
	a.SetNeedsPair()
	waitFor(t, "NeedsPair", func() bool { return hasState(h, NeedsPair) })
	h.q.Push(goalEv(1))
	time.Sleep(50 * time.Millisecond)
	if c := h.poster.Calls(); c != 0 {
		t.Fatalf("posted while NeedsPair: %d", c)
	}
	a.Resume()
	waitFor(t, "delivery after resume", func() bool { return len(h.poster.Delivered()) == 1 })
}

// flushSource holds an event back until Flush, like a buffered goal.
type flushSource struct {
	fakeSource
	mu      sync.Mutex
	held    []model.Event
	flushes int
}

func (s *flushSource) Feed(raw json.RawMessage) []model.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	if string(raw) == "goal" {
		s.held = append(s.held, goalEv(7))
	}
	return nil
}

func (s *flushSource) Flush() []model.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.flushes++
	out := s.held
	s.held = nil
	return out
}

func TestBufferedEventFlushedWhenStreamEnds(t *testing.T) {
	h := newHarness(t, func(int, []model.Event) ([]api.Result, error) { return nil, api.ErrRetryable })
	src := &flushSource{}
	h.deps.NewSource = func() Source { return src }
	h.stream.ch <- item{raw: json.RawMessage("goal")}
	h.stream.ch <- item{err: io.EOF}
	h.start()
	waitFor(t, "buffered goal queued", func() bool { return h.q.Len() == 1 })
	if got := h.q.Peek(1)[0]; got.Kind != "goal" || got.At != goalEv(7).At {
		t.Fatalf("queued %+v", got)
	}
}

func TestInMatchFollowsCurrentSource(t *testing.T) {
	h := newHarness(t, okAll)
	a, cancel, done := h.start()
	defer func() { cancel(); <-done }()
	if a.InMatch() {
		t.Fatal("no match yet")
	}
	waitFor(t, "connected", func() bool { return hasState(h, Connected) })
	h.src.inMatch.Store(true)
	if !a.InMatch() {
		t.Fatal("in match")
	}
	h.src.inMatch.Store(false)
	if a.InMatch() {
		t.Fatal("match over")
	}
}

// A rejected event is held and retried (a site fault can answer 400 to
// everything), but a permanently bad head event is dropped after
// MaxRejectAttempts so it cannot block the events behind it.
func TestPermanentlyRejectedHeadIsDroppedAfterAttempts(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		for _, e := range evs {
			if e.At.Second() == 1 { // event 1 is bad forever
				return nil, api.ErrRejected{Status: 400, Body: "bad"}
			}
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	h.q.Push(goalEv(1), goalEv(2)) // the bad event sits at the head
	h.start()
	waitFor(t, "valid event delivered", func() bool {
		for _, e := range h.poster.Delivered() {
			if e.At.Second() == 2 {
				return true
			}
		}
		return false
	})
	waitFor(t, "queue empty", func() bool { return h.q.Len() == 0 })
	for _, e := range h.poster.Delivered() {
		if e.At.Second() == 1 {
			t.Fatal("bad event delivered")
		}
	}
	if c := h.poster.Calls(); c < 1+MaxRejectAttempts {
		t.Fatalf("dropped after %d calls, want >= %d attempts", c, MaxRejectAttempts)
	}
}

func TestTransientRejectionsDropNothing(t *testing.T) {
	var reject atomic.Int32
	reject.Store(4) // four 400s, then the site recovers
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if reject.Add(-1) >= 0 {
			return nil, api.ErrRejected{Status: 400, Body: "bad"}
		}
		return okAll(call, evs)
	})
	h.dialErr.Store(true)
	for i := 1; i <= 3; i++ {
		h.q.Push(goalEv(i))
	}
	h.start()
	waitFor(t, "all delivered", func() bool { return len(h.poster.Delivered()) == 3 })
	if !hasState(h, Queued) {
		t.Fatal("want Queued while holding a rejected event")
	}
	got := h.sleepsOf(DialRetry, HeartbeatEvery, FlushEvery)
	if len(got) < 2 || got[0] != 4*time.Second {
		t.Fatalf("sleeps %v: rejected singles must back off", got)
	}
}

// The hold is also bounded in time: a head event rejected continuously for
// MaxRejectHold is dropped even before MaxRejectAttempts.
func TestRejectedHeadDroppedAfterHoldTime(t *testing.T) {
	var now atomic.Int64
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	now.Store(base.UnixNano())
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		if evs[0].At.Second() == 1 {
			if call >= 2 {
				now.Store(base.Add(MaxRejectHold).UnixNano()) // 6 h pass between attempts
			}
			return nil, api.ErrRejected{Status: 400, Body: "bad"}
		}
		return okAll(call, evs)
	})
	h.deps.Now = func() time.Time { return time.Unix(0, now.Load()).UTC() }
	h.dialErr.Store(true)
	h.q.Push(goalEv(1))
	h.start()
	waitFor(t, "dropped", func() bool { return h.q.Len() == 0 })
	if c := h.poster.Calls(); c >= MaxRejectAttempts {
		t.Fatalf("dropped by attempts (%d), not by time", c)
	}
}

// dropFailQueue fails Drop while fail is set.
type dropFailQueue struct {
	*queue.Queue
	fail  atomic.Bool
	drops atomic.Int32
}

func (f *dropFailQueue) Drop(n int) error {
	f.drops.Add(1)
	if f.fail.Load() {
		return errors.New("disk full")
	}
	return f.Queue.Drop(n)
}

func TestDropFailureAfterRejectionBacksOff(t *testing.T) {
	h := newHarness(t, func(call int, evs []model.Event) ([]api.Result, error) {
		return nil, api.ErrRejected{Status: 400, Body: "bad"}
	})
	dq := &dropFailQueue{Queue: h.q}
	dq.fail.Store(true)
	h.deps.Queue = dq
	h.dialErr.Store(true)
	h.q.Push(goalEv(1))
	h.start()
	waitFor(t, "two drop attempts", func() bool { return dq.drops.Load() >= 2 })
	got := h.sleepsOf(DialRetry, HeartbeatEvery)
	if len(got) == 0 || got[0] != FlushEvery {
		t.Fatalf("no backoff between failed drops: sleeps %v", got)
	}
}

func TestHeartbeatCarriesSong(t *testing.T) {
	h := newHarness(t, func(int, []model.Event) ([]api.Result, error) { return nil, api.ErrRetryable })
	var mu sync.Mutex
	cur := model.LocalSong("Uprising", "Muse")
	h.deps.Song = func() *model.Song { mu.Lock(); defer mu.Unlock(); return cur }
	h.src.events["g"] = []model.Event{goalEv(1)}
	h.src.inMatch.Store(true)
	h.stream.ch <- item{raw: json.RawMessage("g")}
	h.start()
	waitFor(t, "goal queued", func() bool { return h.q.Len() >= 1 })

	beats := func() []model.Event {
		var hb []model.Event
		for _, e := range h.q.Peek(1000) {
			if e.Kind == "heartbeat" {
				hb = append(hb, e)
			}
		}
		return hb
	}
	h.hbTick <- struct{}{}
	h.hbTick <- struct{}{}
	hb := beats()
	if len(hb) < 1 || hb[0].Song == nil || *hb[0].Song != *model.LocalSong("Uprising", "Muse") {
		t.Fatalf("heartbeat song: %+v", hb)
	}
	mu.Lock()
	cur = nil
	mu.Unlock()
	n := len(hb)
	h.hbTick <- struct{}{}
	h.hbTick <- struct{}{}
	hb = beats()
	if len(hb) <= n || hb[len(hb)-1].Song != nil {
		t.Fatalf("heartbeat with nothing playing: %+v", hb)
	}
}
