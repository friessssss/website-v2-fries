//go:build windows

package winsys

import (
	"fyne.io/systray"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/winsys/icons"
)

// Tray is the notification-area icon and menu. Callbacks run on the tray's own
// goroutine, never from inside SetState.
type Tray struct {
	OnOpen, OnTogglePause, OnToggleToasts, OnRepair, OnQuit func()

	states chan stateMsg
}

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

func (t *Tray) init() {
	if t.states == nil {
		t.states = make(chan stateMsg, 1)
	}
}

// SetState never blocks and never calls back into the app: it stores the latest
// state in a one-slot channel (replacing an unread value) for the tray goroutine.
func (t *Tray) SetState(s app.State, statusText string) {
	t.init()
	m := stateMsg{s, statusText}
	for {
		select {
		case t.states <- m:
			return
		default:
		}
		select {
		case <-t.states: // drop the stale value
		default:
		}
	}
}

func call(f func()) {
	if f != nil {
		f()
	}
}

// Run blocks until the tray exits (Quit clicked or systray.Quit).
func (t *Tray) Run() {
	t.init()
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

	toastsOn := true
	go func() {
		for {
			select {
			case m := <-t.states:
				systray.SetIcon(iconFor(m.s))
				systray.SetTooltip("RL Goal Tracker: " + m.text)
				status.SetTitle(m.text)
				if m.s == app.Paused {
					pause.SetTitle("Resume tracking")
				} else {
					pause.SetTitle("Pause tracking")
				}
			case <-open.ClickedCh:
				call(t.OnOpen)
			case <-toasts.ClickedCh:
				toastsOn = !toastsOn
				if toastsOn {
					toasts.SetTitle("Toasts on")
				} else {
					toasts.SetTitle("Toasts off")
				}
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
