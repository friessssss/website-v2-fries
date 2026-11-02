package winsys

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

// Fixed names next to the installed exe (see update.NewExeName).
const (
	newExeName = "RLGoalTracker.new.exe"
	oldExeName = "RLGoalTracker.old.exe"
)

// minExeSize is the smallest file accepted as an update (real builds are ~12 MB).
var minExeSize int64 = 1 << 20

// verifyPayload checks that path looks like a Windows executable: it starts
// with "MZ" and is larger than minExeSize.
func verifyPayload(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if fi.Size() <= minExeSize {
		return fmt.Errorf("winsys: %s is too small (%d bytes)", filepath.Base(path), fi.Size())
	}
	head := make([]byte, 2)
	if _, err := io.ReadFull(f, head); err != nil {
		return err
	}
	if !bytes.Equal(head, []byte("MZ")) {
		return fmt.Errorf("winsys: %s is not an executable", filepath.Base(path))
	}
	return nil
}

// swapFiles deletes a leftover .old.exe, then, if RLGoalTracker.new.exe sits
// next to exe and passes verifyPayload, renames exe to .old.exe and the new
// one into exe's place. Windows allows renaming a running exe, just not
// deleting or overwriting it. A payload that fails verification is deleted.
func swapFiles(exe string) (bool, error) {
	dir := filepath.Dir(exe)
	old := filepath.Join(dir, oldExeName)
	nw := filepath.Join(dir, newExeName)
	// May fail while the previous process is still exiting; retried next start.
	_ = os.Remove(old)
	if _, err := os.Stat(nw); errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if err := verifyPayload(nw); err != nil {
		os.Remove(nw)
		return false, err
	}
	if err := os.Rename(exe, old); err != nil {
		return false, err
	}
	if err := os.Rename(nw, exe); err != nil {
		if rerr := os.Rename(old, exe); rerr != nil {
			return false, fmt.Errorf("%v; rollback also failed: %v", err, rerr)
		}
		return false, err
	}
	return true, nil
}

// rollbackSwap puts .old.exe back over exe (the new build, which never ran).
func rollbackSwap(exe string) error {
	return os.Rename(filepath.Join(filepath.Dir(exe), oldExeName), exe)
}

// swapAndRelaunch swaps in a pending update and starts it. If the start
// fails, the swap is rolled back so the previous build stays installed.
func swapAndRelaunch(exe string, relaunch func() error) (bool, error) {
	swapped, err := swapFiles(exe)
	if err != nil || !swapped {
		return false, err
	}
	if err := relaunch(); err != nil {
		if rerr := rollbackSwap(exe); rerr != nil {
			return false, fmt.Errorf("relaunch: %v; rollback failed: %v", err, rerr)
		}
		return false, fmt.Errorf("relaunch: %v (rolled back)", err)
	}
	return true, nil
}
