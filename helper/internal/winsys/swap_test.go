package winsys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func exeBytes(tag string) []byte {
	return append([]byte("MZ"+tag), bytes.Repeat([]byte{0}, int(minExeSize))...)
}

func setupSwap(t *testing.T, cur, nw []byte) (dir, exe string) {
	t.Helper()
	dir = t.TempDir()
	exe = filepath.Join(dir, "RLGoalTracker.exe")
	os.WriteFile(exe, cur, 0o755)
	if nw != nil {
		os.WriteFile(filepath.Join(dir, "RLGoalTracker.new.exe"), nw, 0o755)
	}
	return dir, exe
}

func gone(t *testing.T, p string) {
	t.Helper()
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("%s still exists", filepath.Base(p))
	}
}

func TestSwapFilesReplacesExeAndKeepsOld(t *testing.T) {
	dir, exe := setupSwap(t, exeBytes("old"), exeBytes("new"))
	swapped, err := swapFiles(exe)
	if err != nil || !swapped {
		t.Fatal(swapped, err)
	}
	if b, _ := os.ReadFile(exe); !bytes.HasPrefix(b, []byte("MZnew")) {
		t.Fatal("exe not replaced")
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "RLGoalTracker.old.exe")); !bytes.HasPrefix(b, []byte("MZold")) {
		t.Fatal("old not kept")
	}
	gone(t, filepath.Join(dir, "RLGoalTracker.new.exe"))
}

func TestSwapFilesNoPendingDeletesOld(t *testing.T) {
	dir, exe := setupSwap(t, []byte("cur"), nil)
	os.WriteFile(filepath.Join(dir, "RLGoalTracker.old.exe"), []byte("stale"), 0o755)
	swapped, err := swapFiles(exe)
	if err != nil || swapped {
		t.Fatal(swapped, err)
	}
	gone(t, filepath.Join(dir, "RLGoalTracker.old.exe"))
	if b, _ := os.ReadFile(exe); string(b) != "cur" {
		t.Fatal("exe changed")
	}
}

func TestSwapFilesRejectsBadPayload(t *testing.T) {
	cases := map[string][]byte{
		"empty":     {},
		"small MZ":  []byte("MZ tiny"),
		"not MZ":    append([]byte("PK"), bytes.Repeat([]byte{0}, int(minExeSize)+10)...),
		"html page": append([]byte("<html>"), bytes.Repeat([]byte{' '}, int(minExeSize)+10)...),
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			dir, exe := setupSwap(t, []byte("cur"), payload)
			swapped, err := swapFiles(exe)
			if swapped || err == nil {
				t.Fatal(swapped, err)
			}
			if b, _ := os.ReadFile(exe); string(b) != "cur" {
				t.Fatal("exe changed")
			}
			gone(t, filepath.Join(dir, "RLGoalTracker.new.exe"))
		})
	}
}

func TestSwapAndRelaunchRollsBackWhenStartFails(t *testing.T) {
	dir, exe := setupSwap(t, exeBytes("old"), exeBytes("new"))
	swapped, err := swapAndRelaunch(exe, func() error { return errors.New("boom") })
	if swapped || err == nil || !strings.Contains(err.Error(), "rolled back") {
		t.Fatal(swapped, err)
	}
	if b, _ := os.ReadFile(exe); !bytes.HasPrefix(b, []byte("MZold")) {
		t.Fatal("previous build not restored")
	}
	gone(t, filepath.Join(dir, "RLGoalTracker.old.exe"))
}

func TestSwapAndRelaunchReportsRollbackFailure(t *testing.T) {
	dir, exe := setupSwap(t, exeBytes("old"), exeBytes("new"))
	swapped, err := swapAndRelaunch(exe, func() error {
		os.Remove(filepath.Join(dir, "RLGoalTracker.old.exe")) // simulate a vanished backup
		return errors.New("boom")
	})
	if swapped || err == nil || !strings.Contains(err.Error(), "boom") || !strings.Contains(err.Error(), "rollback failed") {
		t.Fatal(swapped, err)
	}
}

func TestSwapAndRelaunchSuccess(t *testing.T) {
	_, exe := setupSwap(t, exeBytes("old"), exeBytes("new"))
	called := false
	swapped, err := swapAndRelaunch(exe, func() error { called = true; return nil })
	if !swapped || err != nil || !called {
		t.Fatal(swapped, err, called)
	}
}

func TestSwapAndRelaunchNothingPending(t *testing.T) {
	_, exe := setupSwap(t, []byte("cur"), nil)
	swapped, err := swapAndRelaunch(exe, func() error { t.Fatal("must not relaunch"); return nil })
	if swapped || err != nil {
		t.Fatal(swapped, err)
	}
}
