//go:build windows

package winsys

import (
	"sync/atomic"

	"fyne.io/systray"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/winsys/icons"
)

// Tray is the notification-area icon and menu. Callbacks run on the tray's own
// goroutine, never from inside SetState.
type Tray struct {
	OnOpen, OnTogglePause, OnToggleToasts, OnRepair, OnQuit func()

	states  mailbox[stateMsg]
	refresh mailbox[struct{}]
	// toastsOff is inverted so the zero value means toasts are on.
	toastsOff atomic.Bool
}

// SetToastsOn lets the app own the toast setting; the menu label follows it.
// Safe to call from any goroutine at any time.
func (t *Tray) SetToastsOn(on bool) {
	t.toastsOff.Store(!on)
	t.refresh.Put(struct{}{})
}

// ToastsOn reports the current toast setting.
func (t *Tray) ToastsOn() bool { return !t.toastsOff.Load() }

type stateMsg struct {
	s    app.State
	text string
}

func iconFor(s app.State) []byte {
	switch s {
	case app.Connected:
		return icons.Lime
	case app.Queued, app.Paused:
		return icons.Amber
	case app.NeedsPair:
		return icons.Red
	default:
		return icons.Grey
	}
}

// SetState never blocks and never calls back into the app: it stores the latest
// state in a one-slot mailbox for the tray goroutine.
func (t *Tray) SetState(s app.State, statusText string) {
	t.states.Put(stateMsg{s, statusText})
}

// call runs a menu callback on its own goroutine so a blocking handler (a
// dialog, say) cannot stall state updates or other menu clicks.
func call(f func()) {
	if f != nil {
		go f()
	}
}

// Run blocks until the tray exits (Quit clicked or systray.Quit).
func (t *Tray) Run() {
	systray.Run(t.onReady, func() {})
}

func (t *Tray) onReady() {
	systray.SetIcon(icons.Grey)
	systray.SetTooltip("RL Goal Tracker")

	status := systray.AddMenuItem("Starting", "")
	status.Disable()
	systray.AddSeparator()
	open := systray.AddMenuItem("Open tracker", "")
	toasts := systray.AddMenuItem("Toasts on", "Turn goal toasts on or off")
	pause := systray.AddMenuItem("Pause tracking", "")
	repair := systray.AddMenuItem("Re-pair", "")
	systray.AddSeparator()
	quit := systray.AddMenuItem("Quit", "")

	setToastTitle := func() {
		if t.ToastsOn() {
			toasts.SetTitle("Toasts on")
		} else {
			toasts.SetTitle("Toasts off")
		}
	}
	setToastTitle()
	go func() {
		for {
			select {
			case m := <-t.states.C():
				systray.SetIcon(iconFor(m.s))
				systray.SetTooltip("RL Goal Tracker: " + m.text)
				status.SetTitle(m.text)
				if m.s == app.Paused {
					pause.SetTitle("Resume tracking")
				} else {
					pause.SetTitle("Pause tracking")
				}
			case <-t.refresh.C():
				setToastTitle()
			case <-open.ClickedCh:
				call(t.OnOpen)
			case <-toasts.ClickedCh:
				t.toastsOff.Store(t.ToastsOn())
				setToastTitle()
				call(t.OnToggleToasts)
			case <-pause.ClickedCh:
				call(t.OnTogglePause)
			case <-repair.ClickedCh:
				call(t.OnRepair)
			case <-quit.ClickedCh:
				call(t.OnQuit)
				systray.Quit()
				return
			}
		}
	}()
}
