//go:build !windows

// Non-Windows stand-ins: no-ops or errors so the module builds and vets.
package winsys

import (
	"errors"

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
	OnOpen, OnTogglePause, OnToggleToasts, OnRepair, OnQuit func()
}

func (t *Tray) SetToastsOn(on bool)                     {}
func (t *Tray) ToastsOn() bool                          { return true }
func (t *Tray) Run()                                    {}
func (t *Tray) SetState(s app.State, statusText string) {}
