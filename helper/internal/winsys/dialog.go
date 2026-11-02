//go:build windows

package winsys

import "github.com/ncruces/zenity"

const dialogTitle = "RL Goal Tracker"

// AskPairingCode prompts for the pairing code. ok is false if cancelled or empty.
func AskPairingCode() (string, bool) {
	s, err := zenity.Entry("Enter the code from zachrobertson.co/RLTracker/settings",
		zenity.Title(dialogTitle))
	if err != nil || s == "" {
		return "", false
	}
	return s, true
}

// AskRLFolder shows a directory picker for the Rocket League install folder.
func AskRLFolder() (string, bool) {
	s, err := zenity.SelectFile(zenity.Directory(),
		zenity.Title("Select the Rocket League folder"))
	if err != nil || s == "" {
		return "", false
	}
	return s, true
}

// Info shows a modal information dialog.
func Info(msg string) {
	_ = zenity.Info(msg, zenity.Title(dialogTitle))
}
