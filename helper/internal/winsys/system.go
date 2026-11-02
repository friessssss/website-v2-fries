//go:build windows

package winsys

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"fyne.io/systray"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const mutexName = `Global\RLGoalTracker`

// SingleInstance takes the named mutex Global\RLGoalTracker. ok is false if
// another instance holds it after waiting up to wait. release closes it.
// Only the mutex's existence is used (not ownership), so release may run on
// any goroutine/thread.
func SingleInstance(wait time.Duration) (release func(), ok bool, err error) {
	name, err := windows.UTF16PtrFromString(mutexName)
	if err != nil {
		return nil, false, err
	}
	deadline := time.Now().Add(wait)
	for {
		h, err := windows.CreateMutex(nil, false, name)
		if err == nil {
			return func() { windows.CloseHandle(h) }, true, nil
		}
		if h != 0 {
			windows.CloseHandle(h)
		}
		if !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
			return nil, false, err
		}
		if time.Now().After(deadline) {
			return nil, false, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ProcessRunning reports whether a process with this exe name (case
// insensitive, e.g. "RocketLeague.exe") is running.
func ProcessRunning(name string) bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), name) {
			return true
		}
	}
	return false
}

// SteamRoot returns the Steam install folder from the registry, or "".
func SteamRoot() string {
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE); err == nil {
		defer k.Close()
		if p, _, err := k.GetStringValue("SteamPath"); err == nil && p != "" {
			return filepath.FromSlash(p)
		}
	}
	for _, path := range []string{`SOFTWARE\WOW6432Node\Valve\Steam`, `SOFTWARE\Valve\Steam`} {
		k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		p, _, err := k.GetStringValue("InstallPath")
		k.Close()
		if err == nil && p != "" {
			return p
		}
	}
	return ""
}

// InstallDir is %LOCALAPPDATA%\RLGoalTracker.
func InstallDir() (string, error) {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		return "", errors.New("LOCALAPPDATA is not set")
	}
	return filepath.Join(base, installDirName), nil
}

// OpenURL opens url in the default browser.
func OpenURL(url string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	u, err := windows.UTF16PtrFromString(url)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, u, nil, nil, windows.SW_SHOWNORMAL)
}

// Quit closes the tray, making Run return. Safe from any goroutine.
func (t *Tray) Quit() { systray.Quit() }
