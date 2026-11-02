//go:build windows

package winsys

import (
	"errors"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var procShellExecuteExW = windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteExW")

const (
	seeMaskNoCloseProcess = 0x00000040
	seeMaskNoAsync        = 0x00000100
)

// shellExecuteInfo mirrors SHELLEXECUTEINFOW.
type shellExecuteInfo struct {
	cbSize         uint32
	fMask          uint32
	hwnd           uintptr
	lpVerb         *uint16
	lpFile         *uint16
	lpParameters   *uint16
	lpDirectory    *uint16
	nShow          int32
	hInstApp       uintptr
	lpIDList       uintptr
	lpClass        *uint16
	hkeyClass      uintptr
	dwHotKey       uint32
	hIconOrMonitor uintptr
	hProcess       windows.Handle
}

// ErrElevationTimeout means the elevated process did not finish in time.
var ErrElevationTimeout = errors.New("winsys: elevated process timed out")

// RunElevated starts exe with args through the UAC "runas" verb, waits up to
// timeout and returns its exit code. A declined UAC prompt returns
// windows.ERROR_CANCELLED.
func RunElevated(exe string, args []string, timeout time.Duration) (uint32, error) {
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return 0, err
	}
	file, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return 0, err
	}
	params, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(args))
	if err != nil {
		return 0, err
	}
	info := shellExecuteInfo{
		fMask:        seeMaskNoCloseProcess | seeMaskNoAsync,
		lpVerb:       verb,
		lpFile:       file,
		lpParameters: params,
		nShow:        windows.SW_HIDE,
	}
	info.cbSize = uint32(unsafe.Sizeof(info))
	r, _, callErr := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&info)))
	if r == 0 {
		return 0, callErr
	}
	if info.hProcess == 0 {
		return 0, errors.New("winsys: no process handle from ShellExecuteEx")
	}
	defer windows.CloseHandle(info.hProcess)
	ev, err := windows.WaitForSingleObject(info.hProcess, uint32(timeout.Milliseconds()))
	if err != nil {
		return 0, err
	}
	if ev != windows.WAIT_OBJECT_0 {
		return 0, ErrElevationTimeout
	}
	var code uint32
	if err := windows.GetExitCodeProcess(info.hProcess, &code); err != nil {
		return 0, err
	}
	return code, nil
}
