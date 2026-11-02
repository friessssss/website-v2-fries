package winsys

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Fixed names next to the installed exe (see update.NewExeName).
const (
	newExeName = "RLGoalTracker.new.exe"
	oldExeName = "RLGoalTracker.old.exe"
)

// swapFiles deletes a leftover .old.exe, then, if RLGoalTracker.new.exe sits
// next to exe, renames exe to .old.exe and the new one into exe's place.
// Windows allows renaming a running exe, just not deleting or overwriting it.
// An empty .new.exe is discarded rather than swapped in.
func swapFiles(exe string) (bool, error) {
	dir := filepath.Dir(exe)
	old := filepath.Join(dir, oldExeName)
	nw := filepath.Join(dir, newExeName)
	// May fail while the previous process is still exiting; retried next start.
	_ = os.Remove(old)
	fi, err := os.Stat(nw)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if fi.Size() == 0 {
		os.Remove(nw)
		return false, fmt.Errorf("winsys: %s is empty", newExeName)
	}
	if err := os.Rename(exe, old); err != nil {
		return false, err
	}
	if err := os.Rename(nw, exe); err != nil {
		_ = os.Rename(old, exe)
		return false, err
	}
	return true, nil
}
