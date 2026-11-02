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
	"github.com/friessssss/website-v2-fries/helper/internal/queue"
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

// Poster uploads a batch (satisfied by *api.Client).
type Poster interface {
	PostEvents(ctx context.Context, events []model.Event, sentAt time.Time) ([]api.Result, error)
}

// Deps are the injected collaborators. Now, Sleep, Logf, OnState and OnGoal
// are optional.
type Deps struct {
	Dial      func(ctx context.Context) (Stream, error)
	NewSource func() Source
	Poster    Poster
	Queue     *queue.Queue
	Now       func() time.Time
	Sleep     func(ctx context.Context, d time.Duration) error
	OnState   func(State)
	OnGoal    func(display, song string)
	Logf      func(format string, args ...any)
}

// App is the orchestrator.
type App struct {
	d Deps

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
	for _, f := range []func(context.Context){a.reader, a.heartbeat, a.flusher} {
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
		a.actCtx, a.actCancel = context.WithCancel(a.root)
	}
	close(a.resumeCh)
	a.resumeCh = make(chan struct{})
	a.mu.Unlock()
	a.update()
}

// update recomputes the state and calls OnState if it changed.
func (a *App) update() {
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

func (a *App) readLoop(ctx context.Context, stream Stream) error {
	for {
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
		if err := a.d.Queue.Push(evs...); err != nil {
			a.d.Logf("queue push failed: %v", err)
			continue
		}
		a.update()
	}
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
		if !in {
			continue
		}
		hb := model.Event{Kind: "heartbeat", MatchGUID: guid, At: a.d.Now()}
		if err := a.d.Queue.Push(hb); err != nil {
			a.d.Logf("queue push failed: %v", err)
		}
	}
}

// flusher uploads the queue in batches with backoff on retryable errors.
func (a *App) flusher(ctx context.Context) {
	backoff := FlushEvery
	for {
		act, ok := a.waitFlushable(ctx)
		if !ok {
			return
		}
		batch := a.d.Queue.Peek(BatchSize)
		if len(batch) == 0 {
			a.update()
			if a.d.Sleep(ctx, FlushEvery) != nil {
				return
			}
			continue
		}
		results, err := a.d.Poster.PostEvents(act, batch, a.d.Now())
		switch {
		case err == nil:
			backoff = FlushEvery
			a.mu.Lock()
			a.lastFailed = false
			a.mu.Unlock()
			if derr := a.d.Queue.Drop(len(batch)); derr != nil {
				a.d.Logf("queue drop failed: %v", derr)
			}
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
		default:
			var rej api.ErrRejected
			if errors.As(err, &rej) {
				a.d.Logf("dropping %d events rejected by the site: %v", len(batch), err)
				if derr := a.d.Queue.Drop(len(batch)); derr != nil {
					a.d.Logf("queue drop failed: %v", derr)
				}
				a.update()
				continue
			}
			// ErrRetryable or anything unclassified.
			a.mu.Lock()
			a.lastFailed = true
			a.mu.Unlock()
			a.update()
			wait := backoff
			if backoff *= 2; backoff > BackoffMax {
				backoff = BackoffMax
			}
			if a.d.Sleep(ctx, wait) != nil {
				return
			}
		}
	}
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
