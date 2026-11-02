// Package app wires the Stats API reader, the persistent queue and the
// uploader together. It does no I/O of its own beyond what Deps injects.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// State is what the tray shows.
type State int

const (
	Idle      State = iota // Rocket League not connected, nothing waiting
	Connected              // reading the Stats API, uploads fine
	Queued                 // backlog exists and the last upload failed retryably
	NeedsPair              // the site rejected the key: pair again
	Paused                 // user paused reading and uploading
)

func (s State) String() string {
	switch s {
	case Idle:
		return "idle"
	case Connected:
		return "connected"
	case Queued:
		return "queued"
	case NeedsPair:
		return "needs-pair"
	case Paused:
		return "paused"
	}
	return "unknown"
}

// Timing constants from the spec.
const (
	DialRetry      = 5 * time.Second
	FlushEvery     = 2 * time.Second
	HeartbeatEvery = 30 * time.Second
	BackoffMax     = 60 * time.Second
	BatchSize      = 50
	// SongWarmEvery is how often Deps.Song is read in the background during
	// a match, so a goal's reading is at most a second or two old.
	SongWarmEvery = time.Second
	// A rejected event is held at the queue head and retried with backoff
	// (a site fault can answer 400 to everything). A held head event is dropped once it has been rejected on its own
	// MaxRejectAttempts times, or continuously for MaxRejectHold.
	MaxRejectAttempts = 10
	MaxRejectHold     = 6 * time.Hour
)

// Stream is one live connection to the Stats API.
type Stream interface {
	Next(ctx context.Context) (json.RawMessage, error)
}

// Source turns raw Stats API messages into events. One is created per
// connection, so match state never leaks across a Rocket League restart.
type Source interface {
	Feed(raw json.RawMessage) []model.Event
	InMatch() bool
}

// Flusher is an optional Source extension: Flush returns events the Source
// is still holding back (a goal waiting for its clock). The reader calls it
// whenever a connection ends, so nothing buffered is lost.
type Flusher interface {
	Flush() []model.Event
}

// Poster uploads a batch (satisfied by *api.Client).
type Poster interface {
	PostEvents(ctx context.Context, events []model.Event, sentAt time.Time) ([]api.Result, error)
}

// Queue is the persistent event queue (satisfied by *queue.Queue).
type Queue interface {
	Push(evs ...model.Event) error
	Peek(n int) []model.Event
	Drop(n int) error
	Len() int
}

// Deps are the injected collaborators. Now, Sleep, Logf, OnState, OnGoal
// and Song are optional.
type Deps struct {
	Dial      func(ctx context.Context) (Stream, error)
	NewSource func() Source
	Poster    Poster
	Queue     Queue
	Now       func() time.Time
	Sleep     func(ctx context.Context, d time.Duration) error
	OnState   func(State)
	OnGoal    func(display, song string)
	Logf      func(format string, args ...any)
	// Song returns the track playing on this PC (nil when none); it is
	// stamped on heartbeats and read every SongWarmEvery during a match to
	// keep its cache warm.
	Song func() *model.Song
}

// App is the orchestrator.
type App struct {
	d Deps

	pendMu  sync.Mutex // events whose queue push failed, retried later
	pending []model.Event

	stateMu sync.Mutex // serialises compute-and-callback in update

	srcMu sync.Mutex // serialises Feed and InMatch on the current Source
	src   Source
	guid  string

	mu         sync.Mutex
	paused     bool
	needsPair  bool
	lastFailed bool // last upload failed retryably
	connected  bool
	state      State
	actCtx     context.Context // cancelled by Pause
	actCancel  context.CancelFunc
	resumeCh   chan struct{} // closed on Resume
	root       context.Context
}

// New builds an App, filling defaults for optional Deps.
func New(d Deps) *App {
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.Sleep == nil {
		d.Sleep = func(ctx context.Context, dur time.Duration) error {
			t := time.NewTimer(dur)
			defer t.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-t.C:
				return nil
			}
		}
	}
	if d.Logf == nil {
		d.Logf = func(string, ...any) {}
	}
	return &App{d: d, resumeCh: make(chan struct{})}
}

// Run blocks until ctx is cancelled and every goroutine has stopped.
func (a *App) Run(ctx context.Context) error {
	a.mu.Lock()
	a.root = ctx
	a.actCtx, a.actCancel = context.WithCancel(ctx)
	if a.paused {
		a.actCancel()
	}
	a.mu.Unlock()

	var wg sync.WaitGroup
	for _, f := range []func(context.Context){a.reader, a.heartbeat, a.flusher, a.songWarmer} {
		wg.Add(1)
		go func(f func(context.Context)) { defer wg.Done(); f(ctx) }(f)
	}
	wg.Wait()
	return nil
}

// Pause stops reading and flushing until Resume.
func (a *App) Pause() {
	a.mu.Lock()
	a.paused = true
	if a.actCancel != nil {
		a.actCancel()
	}
	a.mu.Unlock()
	a.update()
}

// Resume restarts reading and flushing and clears NeedsPair (call it after
// the user pairs again).
func (a *App) Resume() {
	a.mu.Lock()
	a.paused = false
	a.needsPair = false
	if a.root != nil {
		if a.actCancel != nil {
			a.actCancel() // otherwise the old context would outlive a later Pause
		}
		a.actCtx, a.actCancel = context.WithCancel(a.root)
	}
	close(a.resumeCh)
	a.resumeCh = make(chan struct{})
	a.mu.Unlock()
	a.update()
}

// SetNeedsPair switches to NeedsPair (for example when a liveness ping is
// rejected) and stops flushing until Resume.
func (a *App) SetNeedsPair() {
	a.mu.Lock()
	a.needsPair = true
	a.mu.Unlock()
	a.update()
}

// update recomputes the state and calls OnState if it changed.
func (a *App) update() {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	backlog := a.d.Queue.Len() > 0
	a.mu.Lock()
	var s State
	switch {
	case a.paused:
		s = Paused
	case a.needsPair:
		s = NeedsPair
	case a.lastFailed && backlog:
		s = Queued
	case a.connected:
		s = Connected
	default:
		s = Idle
	}
	changed := s != a.state
	a.state = s
	a.mu.Unlock()
	// stateMu is still held, so callbacks are ordered and never concurrent.
	if changed && a.d.OnState != nil {
		a.d.OnState(s)
	}
}

// waitActive blocks while paused and returns the context to use for I/O.
func (a *App) waitActive(ctx context.Context) (context.Context, bool) {
	for {
		a.mu.Lock()
		if !a.paused {
			act := a.actCtx
			a.mu.Unlock()
			return act, ctx.Err() == nil
		}
		ch := a.resumeCh
		a.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, false
		case <-ch:
		}
	}
}

// waitFlushable blocks while paused or waiting for a new pairing.
func (a *App) waitFlushable(ctx context.Context) (context.Context, bool) {
	for {
		a.mu.Lock()
		if !a.paused && !a.needsPair {
			act := a.actCtx
			a.mu.Unlock()
			return act, ctx.Err() == nil
		}
		ch := a.resumeCh
		a.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, false
		case <-ch:
		}
	}
}

func (a *App) setConnected(v bool) {
	a.mu.Lock()
	a.connected = v
	a.mu.Unlock()
	a.update()
}

func (a *App) setSource(s Source) {
	a.srcMu.Lock()
	a.src = s
	a.guid = "" // a new connection starts a fresh match identity
	a.srcMu.Unlock()
}

// reader dials, feeds the Source and pushes its events to the queue.
func (a *App) reader(ctx context.Context) {
	for {
		act, ok := a.waitActive(ctx)
		if !ok {
			return
		}
		stream, err := a.d.Dial(act)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if act.Err() == nil && a.d.Sleep(ctx, DialRetry) != nil {
				return
			}
			continue
		}
		a.setSource(a.d.NewSource())
		a.setConnected(true)
		err = a.readLoop(act, stream)
		a.flushSource()
		if c, ok := stream.(io.Closer); ok {
			c.Close()
		}
		a.setSource(nil)
		a.setConnected(false)
		if ctx.Err() != nil {
			return
		}
		if act.Err() != nil { // paused: go back and wait
			continue
		}
		a.d.Logf("stats api disconnected: %v", err)
		if a.d.Sleep(ctx, DialRetry) != nil {
			return
		}
	}
}

// flushSource queues whatever the current Source still buffers.
func (a *App) flushSource() {
	a.srcMu.Lock()
	var evs []model.Event
	if f, ok := a.src.(Flusher); ok {
		evs = f.Flush()
	}
	a.srcMu.Unlock()
	if len(evs) > 0 {
		a.pushPending(evs...)
		a.update()
	}
}

func (a *App) readLoop(ctx context.Context, stream Stream) error {
	for {
		a.pushPending()
		raw, err := stream.Next(ctx)
		if err != nil {
			return err
		}
		a.srcMu.Lock()
		evs := a.src.Feed(raw)
		for _, e := range evs {
			if e.MatchGUID != "" {
				a.guid = e.MatchGUID
			}
		}
		a.srcMu.Unlock()
		if len(evs) == 0 {
			continue
		}
		a.pushPending(evs...)
		a.update()
	}
}

// pushPending appends evs to any events whose earlier push failed and tries
// to persist them all; on failure they stay in memory for the next attempt.
func (a *App) pushPending(evs ...model.Event) {
	a.pendMu.Lock()
	defer a.pendMu.Unlock()
	a.pending = append(a.pending, evs...)
	if len(a.pending) == 0 {
		return
	}
	if err := a.d.Queue.Push(a.pending...); err != nil {
		a.d.Logf("queue push failed, keeping %d events in memory: %v", len(a.pending), err)
		return
	}
	a.pending = nil
}

// heartbeat pushes a heartbeat every 30 s while the Source reports a match.
func (a *App) heartbeat(ctx context.Context) {
	for {
		if a.d.Sleep(ctx, HeartbeatEvery) != nil {
			return
		}
		a.srcMu.Lock()
		in := a.src != nil && a.src.InMatch()
		guid := a.guid
		a.srcMu.Unlock()
		if !in || guid == "" { // the server rejects an empty matchGuid for the whole batch
			continue
		}
		hb := model.Event{Kind: "heartbeat", MatchGUID: guid, At: a.d.Now()}
		if a.d.Song != nil {
			hb.Song = a.d.Song()
		}
		a.pushPending(hb)
	}
}

// songWarmer reads Deps.Song every SongWarmEvery while in a match, so the
// parser's reads hit a fresh cache instead of waiting on the OS.
func (a *App) songWarmer(ctx context.Context) {
	if a.d.Song == nil {
		return
	}
	for {
		if a.d.Sleep(ctx, SongWarmEvery) != nil {
			return
		}
		if a.InMatch() {
			a.d.Song()
		}
	}
}

// flusher uploads the queue in batches with backoff on retryable errors.
func (a *App) flusher(ctx context.Context) {
	backoff := FlushEvery
	singles := 0 // events at the queue front still to be sent one at a time
	// The head event currently held after a 400/422, how often it was
	// rejected on its own, and since when.
	var holdKey string
	var holdAttempts int
	var holdSince time.Time
	resetHold := func() { holdKey, holdAttempts, holdSince = "", 0, time.Time{} }
	// retryLater marks the upload as failing and sleeps the current backoff.
	retryLater := func() bool {
		a.mu.Lock()
		a.lastFailed = true
		a.mu.Unlock()
		a.update()
		wait := backoff
		if backoff *= 2; backoff > BackoffMax {
			backoff = BackoffMax
		}
		return a.d.Sleep(ctx, wait) == nil
	}
	for {
		act, ok := a.waitFlushable(ctx)
		if !ok {
			return
		}
		a.pushPending()
		n := BatchSize
		if singles > 0 {
			n = 1
		}
		batch := a.d.Queue.Peek(n)
		if len(batch) == 0 {
			a.update()
			if a.d.Sleep(ctx, FlushEvery) != nil {
				return
			}
			continue
		}
		results, err := a.d.Poster.PostEvents(act, batch, a.d.Now())
		var rej api.ErrRejected
		switch {
		case err == nil:
			resetHold()
			if derr := a.d.Queue.Drop(len(batch)); derr != nil {
				// The batch would be re-sent (the site dedupes); don't spin.
				a.d.Logf("queue drop failed: %v", derr)
				if !retryLater() {
					return
				}
				continue
			}
			backoff = FlushEvery
			a.mu.Lock()
			a.lastFailed = false
			a.mu.Unlock()
			singles = max(singles-len(batch), 0)
			a.notifyGoals(batch, results)
			a.update()
			if len(batch) == BatchSize {
				continue // more waiting: don't idle between full batches
			}
			if a.d.Sleep(ctx, FlushEvery) != nil {
				return
			}
		case ctx.Err() != nil:
			return
		case act.Err() != nil:
			continue // paused mid-request: keep the batch, wait for Resume
		case errors.Is(err, api.ErrUnauthorized):
			a.mu.Lock()
			a.needsPair = true
			a.mu.Unlock()
			a.d.Logf("upload unauthorized: pairing required")
			a.update()
		case errors.As(err, &rej) && len(batch) > 1:
			// One bad event must not discard the good ones: resend individually.
			a.d.Logf("batch of %d rejected (%v); resending one at a time", len(batch), err)
			singles = len(batch)
		case errors.As(err, &rej):
			now := a.d.Now()
			if k := eventKey(batch[0]); k != holdKey {
				holdKey, holdAttempts, holdSince = k, 0, now
			}
			holdAttempts++
			if holdAttempts < MaxRejectAttempts && now.Sub(holdSince) < MaxRejectHold {
				a.d.Logf("event rejected by the site (attempt %d): %v; keeping it and backing off", holdAttempts, err)
				if !retryLater() {
					return
				}
				continue
			}
			a.d.Logf("dropping event rejected by the site %d times over %v: %v", holdAttempts, now.Sub(holdSince).Round(time.Second), err)
			if derr := a.d.Queue.Drop(len(batch)); derr != nil {
				a.d.Logf("queue drop failed: %v", derr)
				if !retryLater() {
					return
				}
				continue
			}
			resetHold()
			singles = max(singles-1, 0)
			a.update()
		default:
			// ErrRetryable or anything unclassified.
			if !retryLater() {
				return
			}
		}
	}
}

// eventKey identifies a queued event (its JSON form).
func eventKey(e model.Event) string {
	b, err := json.Marshal(e)
	if err != nil {
		return ""
	}
	return string(b)
}

func (a *App) notifyGoals(batch []model.Event, results []api.Result) {
	if a.d.OnGoal == nil {
		return
	}
	for i, r := range results {
		if i >= len(batch) {
			break
		}
		if batch[i].Kind != "goal" || r.Status != "recorded" {
			continue
		}
		if r.ActorDisplay == "" || r.ActorDisplay == "Opponent" || r.ActorDisplay == "Teammate" {
			continue
		}
		a.d.OnGoal(r.ActorDisplay, r.Song)
	}
}

// InMatch reports whether the current Stats API connection is inside a
// match (from match_start until the match ends or the connection drops).
// Safe to call from any goroutine.
func (a *App) InMatch() bool {
	a.srcMu.Lock()
	defer a.srcMu.Unlock()
	return a.src != nil && a.src.InMatch()
}

// currentState returns the last computed state.
func (a *App) currentState() State {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.state
}
