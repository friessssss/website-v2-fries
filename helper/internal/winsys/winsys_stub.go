//go:build !windows

// Non-Windows stand-ins: no-ops or errors so the module builds and vets.
package winsys

import (
	"errors"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
)

var errUnsupported = errors.New("winsys: not supported on this OS")

func LoadKey() (string, error)       { return "", errUnsupported }
func SaveKey(k string) error         { return errUnsupported }
func DeleteKey() error               { return errUnsupported }
func InstallSelf() (string, error)   { return "", errUnsupported }
func AskPairingCode() (string, bool) { return "", false }
func AskRLFolder() (string, bool)    { return "", false }
func Info(msg string)                {}
func Toast(title, body string)       {}

// ToastLogf, if set, receives toast delivery errors.
var ToastLogf func(format string, args ...any)

// Tray is a no-op on non-Windows platforms.
type Tray struct {
	OnOpen, OnTogglePause, OnToggleToasts, OnRepair, OnFindRL, OnQuit func()
	OnReady                                                           func()
}

func (t *Tray) SetToastsOn(on bool)                     {}
func (t *Tray) ToastsOn() bool                          { return true }
func (t *Tray) Run()                                    {}
func (t *Tray) SetState(s app.State, statusText string) {}

// RelaunchedFlag marks a relaunched process (see the Windows build).
const RelaunchedFlag = "--relaunched"

func SwapIfPending(args []string) (bool, error) { return false, nil }
func Relaunch(exe string, args []string) error  { return errUnsupported }
func ProcessRunning(name string) bool           { return false }
func SteamRoot() string                         { return "" }
func InstallDir() (string, error)               { return "", errUnsupported }
func OpenURL(url string) error                  { return errUnsupported }
func (t *Tray) Quit()                           {}
func SingleInstance(wait time.Duration) (func(), bool, error) {
	return func() {}, true, nil
}

func RunElevated(exe string, args []string, timeout time.Duration) (uint32, error) {
	return 0, errUnsupported
}
