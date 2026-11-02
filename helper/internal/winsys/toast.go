//go:build windows

package winsys

import toast "git.sr.ht/~jackmordaunt/go-toast/v2"

// Toast shows a Windows toast notification. Failures are ignored: a missed toast is harmless.
func Toast(title, body string) {
	n := toast.Notification{AppID: dialogTitle, Title: title, Body: body}
	_ = n.Push()
}
