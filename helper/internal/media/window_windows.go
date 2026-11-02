//go:build windows

package media

import (
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const spotifyExe = "Spotify.exe"

var (
	user32                   = windows.NewLazySystemDLL("user32.dll")
	procGetWindowTextW       = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
)

// EnumWindows state. The callback is created once (Go limits how many
// syscall callbacks a process may create) and enumMu serialises its use.
var (
	enumMu     sync.Mutex
	enumPIDs   map[uint32]bool
	enumTitles []string
	enumCB     = syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var pid uint32
		if _, err := windows.GetWindowThreadProcessId(windows.HWND(hwnd), &pid); err == nil && enumPIDs[pid] {
			if t := windowText(hwnd); t != "" {
				enumTitles = append(enumTitles, t)
			}
		}
		return 1 // continue
	})
)

// spotifyWindowNowPlaying reads "Artist - Title" from the titles of
// Spotify.exe's top-level windows.
func spotifyWindowNowPlaying() (string, string, bool) {
	pids := processIDs(spotifyExe)
	if len(pids) == 0 {
		return "", "", false
	}
	enumMu.Lock()
	enumPIDs, enumTitles = pids, nil
	_ = windows.EnumWindows(enumCB, nil)
	titles := enumTitles
	enumPIDs, enumTitles = nil, nil
	enumMu.Unlock()
	return FromWindowTitles(titles)
}

// windowText reads a window's title (GetWindowText reads another process's
// title without sending it a message, so a hung Spotify cannot block it).
func windowText(hwnd uintptr) string {
	n, _, _ := procGetWindowTextLengthW.Call(hwnd)
	if n == 0 || n > 1024 {
		return ""
	}
	buf := make([]uint16, n+1)
	got, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if got == 0 {
		return ""
	}
	return windows.UTF16ToString(buf[:got])
}

// processIDs returns the IDs of running processes with this exe name.
func processIDs(name string) map[uint32]bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	pids := map[uint32]bool{}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), name) {
			pids[e.ProcessID] = true
		}
	}
	return pids
}
