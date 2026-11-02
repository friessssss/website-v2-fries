package setup

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/update"
)

// Timing for the runtime loops.
const (
	PingEvery   = 60 * time.Second
	UpdateEvery = 12 * time.Hour
	RestartPoll = time.Minute // how often a downloaded update waits for a quiet moment
)

// StateText is the tray status line for s.
func StateText(s app.State, queued int) string {
	switch s {
	case app.Connected:
		return "Tracking"
	case app.Queued:
		if queued == 1 {
			return "Offline — 1 event waiting"
		}
		return fmt.Sprintf("Offline — %d events waiting", queued)
	case app.NeedsPair:
		return "Re-pair needed"
	case app.Paused:
		return "Paused"
	default:
		return "Waiting for Rocket League"
	}
}

// GoalToast is the toast text for a goal.
func GoalToast(display, song string) string {
	if song == "" {
		return display + " scored"
	}
	return display + " scored · " + song
}

// StateSink shows the state (winsys.Tray). SetState must not block.
type StateSink interface {
	SetState(s app.State, text string)
}

// AppControl is the part of *app.App the controller drives.
type AppControl interface {
	Pause()
	Resume()
	SetNeedsPair()
}

// SiteAPI is the part of *Site the controller uses.
type SiteAPI interface {
	Pairer
	SetKey(k string)
	Ping(ctx context.Context) error
}

// KeyStore persists the API key (winsys.SaveKey / DeleteKey).
type KeyStore interface {
	Save(k string) error
	Delete() error
}

// Controller connects the app, tray menu and site at runtime. Its methods are
// safe to call from any goroutine (tray menu handlers run concurrently).
type Controller struct {
	Dialogs  Dialogs
	Site     SiteAPI
	Keys     KeyStore
	Label    string
	Tray     StateSink
	QueueLen func() int
	Logf     Logf

	mu       sync.Mutex
	app      AppControl
	state    app.State
	paused   bool
	repairMu sync.Mutex
}

// SetApp attaches the app (it is built after the controller because its
// OnState callback is the controller's).
func (c *Controller) SetApp(a AppControl) { c.mu.Lock(); c.app = a; c.mu.Unlock() }

func (c *Controller) getApp() AppControl { c.mu.Lock(); defer c.mu.Unlock(); return c.app }

// OnState is the app's OnState callback. It runs under the app's state lock,
// so it only records the state and hands it to the non-blocking tray.
func (c *Controller) OnState(s app.State) {
	c.mu.Lock()
	c.state = s
	c.mu.Unlock()
	c.render(s)
}

func (c *Controller) render(s app.State) {
	n := 0
	if c.QueueLen != nil {
		n = c.QueueLen()
	}
	c.Tray.SetState(s, StateText(s, n))
}

// State is the last state the app reported.
func (c *Controller) State() app.State { c.mu.Lock(); defer c.mu.Unlock(); return c.state }

// TogglePause pauses or resumes tracking.
func (c *Controller) TogglePause() {
	c.mu.Lock()
	c.paused = !c.paused
	p := c.paused
	a := c.app
	c.mu.Unlock()
	if p {
		a.Pause()
	} else {
		a.Resume()
	}
}

// Repair asks for a new code and, once paired, stores the new key and resumes.
// A cancelled dialog changes nothing. Clicks while a pairing dialog is already
// open are ignored.
func (c *Controller) Repair(ctx context.Context) {
	if !c.repairMu.TryLock() {
		return
	}
	defer c.repairMu.Unlock()
	key, ok := Pair(ctx, c.Dialogs, c.Site, c.Label, c.Logf)
	if !ok {
		return
	}
	if err := c.Keys.Delete(); err != nil {
		c.Logf("re-pair: delete old key: %v", err)
	}
	if err := c.Keys.Save(key); err != nil {
		c.Logf("re-pair: save key: %v", err)
	}
	c.Site.SetKey(key)
	c.mu.Lock()
	c.paused = false // Resume also unpauses
	a := c.app
	c.mu.Unlock()
	a.Resume()
	c.Logf("re-paired")
}

// PingLoop pings the site now and every PingEvery until ctx ends, except while
// paused or waiting for a re-pair. A 401 switches the app to NeedsPair. Each
// tick also refreshes the tray text (the queued count can change without a
// state change).
func (c *Controller) PingLoop(ctx context.Context, sleep func(context.Context, time.Duration) error) {
	failing := false
	for {
		s := c.State()
		c.render(s)
		if s != app.Paused && s != app.NeedsPair {
			err := c.Site.Ping(ctx)
			switch {
			case err == nil:
				if failing {
					c.Logf("ping: ok again")
				}
				failing = false
			case ctx.Err() != nil:
				return
			case errors.Is(err, api.ErrUnauthorized):
				c.Logf("ping: unauthorized: pairing required")
				c.getApp().SetNeedsPair()
			default:
				if !failing {
					c.Logf("ping: %v", err)
				}
				failing = true
			}
		}
		if sleep(ctx, PingEvery) != nil {
			return
		}
	}
}

// Updater checks for a newer helper on start and every UpdateEvery. When one
// is downloaded it waits until Idle reports a quiet moment, then calls
// Restart (which relaunches into the swap) and returns.
type Updater struct {
	Current  string
	Latest   func(ctx context.Context) (version, url string, err error)
	Download func(ctx context.Context, url, dest string) error
	Dest     string
	Idle     func() bool
	Restart  func()
	Logf     Logf
	Sleep    func(context.Context, time.Duration) error
}

// Loop runs until ctx ends or a restart was requested.
func (u *Updater) Loop(ctx context.Context) {
	for {
		if u.check(ctx) {
			for !u.Idle() {
				if u.Sleep(ctx, RestartPoll) != nil {
					return
				}
			}
			u.Logf("update: restarting into the new version")
			u.Restart()
			return
		}
		if u.Sleep(ctx, UpdateEvery) != nil {
			return
		}
	}
}

// check returns true once a newer build has been downloaded to Dest.
func (u *Updater) check(ctx context.Context) bool {
	v, url, err := u.Latest(ctx)
	if err != nil {
		u.Logf("update: check: %v", err)
		return false
	}
	if !update.Newer(u.Current, v) {
		return false
	}
	if url == "" || !strings.HasPrefix(url, "https://") {
		u.Logf("update: %s has no https download url", v)
		return false
	}
	u.Logf("update: downloading %s", v)
	if err := u.Download(ctx, url, u.Dest); err != nil {
		u.Logf("update: download: %v", err)
		return false
	}
	return true
}
