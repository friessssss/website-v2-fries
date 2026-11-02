//go:build windows

package winsys

import (
	"sync"

	toast "git.sr.ht/~jackmordaunt/go-toast/v2"
)

// ToastLogf, if set, receives toast registration and delivery errors.
var ToastLogf func(format string, args ...any)

// toastGUID identifies this app's toast activation COM class (fixed, arbitrary).
const toastGUID = "{6f1d3a52-8b0e-4c47-9a7d-2e5c1b9f40d3}"

var (
	toastOnce   sync.Once
	toastRegErr error
)

func toastLog(format string, args ...any) {
	if f := ToastLogf; f != nil {
		f(format, args...)
	}
}

// Toast shows a Windows toast notification. It returns immediately; delivery
// happens on its own goroutine and errors go to ToastLogf.
func Toast(title, body string) {
	go func() {
		toastOnce.Do(func() {
			toastRegErr = toast.SetAppData(toast.AppData{AppID: dialogTitle, GUID: toastGUID})
			if toastRegErr != nil {
				toastLog("toast: register app: %v", toastRegErr)
			}
		})
		n := toast.Notification{AppID: dialogTitle, Title: title, Body: body}
		if err := n.Push(); err != nil {
			toastLog("toast: push: %v", err)
		}
	}()
}
