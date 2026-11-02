//go:build windows

package winsys

import (
	"os"
	"os/exec"
)

// RelaunchedFlag marks a process started by SwapIfPending or Relaunch; it
// waits for the previous instance to release the single-instance lock.
const RelaunchedFlag = "--relaunched"

// SwapIfPending finishes a downloaded update: if RLGoalTracker.new.exe exists
// next to the running exe, it swaps it in, starts it with args plus
// RelaunchedFlag and returns true; the caller must then exit. A payload
// that is not an executable is deleted, and a failed start is rolled back. The .old.exe
// left behind is deleted on the next start.
func SwapIfPending(args []string) (bool, error) {
	exe, err := os.Executable()
	if err != nil {
		return false, err
	}
	return swapAndRelaunch(exe, func() error { return Relaunch(exe, args) })
}

// Relaunch starts exe with args plus RelaunchedFlag, detached.
func Relaunch(exe string, args []string) error {
	cmd := exec.Command(exe, append(withoutFlag(args, RelaunchedFlag), RelaunchedFlag)...)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
