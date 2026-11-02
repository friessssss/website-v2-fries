package winsys

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSwapFilesReplacesExeAndKeepsOld(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "RLGoalTracker.exe")
	os.WriteFile(exe, []byte("old"), 0o755)
	os.WriteFile(filepath.Join(dir, "RLGoalTracker.new.exe"), []byte("new"), 0o755)
	swapped, err := swapFiles(exe)
	if err != nil || !swapped {
		t.Fatal(swapped, err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "new" {
		t.Fatalf("exe %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "RLGoalTracker.old.exe")); string(b) != "old" {
		t.Fatalf("old %q", b)
	}
	if _, err := os.Stat(filepath.Join(dir, "RLGoalTracker.new.exe")); !os.IsNotExist(err) {
		t.Fatal("new.exe still there")
	}
}

func TestSwapFilesNoPendingDeletesOld(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "RLGoalTracker.exe")
	os.WriteFile(exe, []byte("cur"), 0o755)
	os.WriteFile(filepath.Join(dir, "RLGoalTracker.old.exe"), []byte("stale"), 0o755)
	swapped, err := swapFiles(exe)
	if err != nil || swapped {
		t.Fatal(swapped, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "RLGoalTracker.old.exe")); !os.IsNotExist(err) {
		t.Fatal("old.exe not deleted")
	}
	if b, _ := os.ReadFile(exe); string(b) != "cur" {
		t.Fatal("exe changed")
	}
}

func TestSwapFilesEmptyNewIsDiscarded(t *testing.T) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "RLGoalTracker.exe")
	os.WriteFile(exe, []byte("cur"), 0o755)
	os.WriteFile(filepath.Join(dir, "RLGoalTracker.new.exe"), nil, 0o755)
	swapped, err := swapFiles(exe)
	if swapped || err == nil {
		t.Fatal(swapped, err)
	}
	if b, _ := os.ReadFile(exe); string(b) != "cur" {
		t.Fatal("exe changed")
	}
	if _, err := os.Stat(filepath.Join(dir, "RLGoalTracker.new.exe")); !os.IsNotExist(err) {
		t.Fatal("empty new.exe kept")
	}
}
