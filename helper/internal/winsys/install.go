//go:build windows

package winsys

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const (
	installDirName = "RLGoalTracker"
	installExeName = "RLGoalTracker.exe"
	runKeyPath     = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValueName   = "RLGoalTracker"
)

// InstallSelf copies the running exe to %LOCALAPPDATA%\RLGoalTracker\ unless it
// already runs from there, registers it under HKCU Run, and returns the
// installed exe path. No admin rights are needed.
func InstallSelf() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", fmt.Errorf("LOCALAPPDATA is not set")
	}
	dir := filepath.Join(base, installDirName)
	dst := filepath.Join(dir, installExeName)

	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	if !samePath(self, dst) {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		if err := copyFile(self, dst); err != nil {
			return "", err
		}
	}

	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	if err := k.SetStringValue(runValueName, quoteRunValue(dst)); err != nil {
		return "", err
	}
	return dst, nil
}

// copyFile copies via a temp file and rename so a half-written exe is never left in place.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	// An older copy that is still running cannot be overwritten, but it can be renamed away.
	old := dst + ".old"
	_ = os.Remove(old)
	if _, err := os.Stat(dst); err == nil {
		if err := os.Rename(dst, old); err != nil {
			os.Remove(tmp)
			return err
		}
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Rename(old, dst)
		os.Remove(tmp)
		return err
	}
	_ = os.Remove(old)
	return nil
}
