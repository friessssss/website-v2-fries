package rlpath

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func read(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSteamLibraries(t *testing.T) {
	got := SteamLibraries(read(t, "libraryfolders.vdf"))
	want := []string{`C:\Program Files (x86)\Steam`, `D:\Spiele Bibliothek\Steam`}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestSteamLibrariesEdge(t *testing.T) {
	if got := SteamLibraries(nil); len(got) != 0 {
		t.Fatalf("nil: %q", got)
	}
	got := SteamLibraries([]byte(`"libraryfolders" { "0" { "path" "D:/Games/Ünï" } "1" { "path" "unterminated`))
	if len(got) != 1 || got[0] != `D:/Games/Ünï` {
		t.Fatalf("got %q", got)
	}
}

func TestEpicInstall(t *testing.T) {
	got, ok := EpicInstall(read(t, "LauncherInstalled.dat"))
	if !ok || got != `E:\Épîc Spiele\rocketleague` {
		t.Fatalf("got %q %v", got, ok)
	}
	if _, ok := EpicInstall([]byte(`{"InstallationList":[{"AppName":"Fortnite","InstallLocation":"x"}]}`)); ok {
		t.Fatal("expected no match")
	}
	if _, ok := EpicInstall([]byte(`not json`)); ok {
		t.Fatal("expected no match on bad json")
	}
	if got, ok := EpicInstall([]byte(`{"InstallationList":[{"AppName":"sUgAr","InstallLocation":"Z:\\rl"}]}`)); !ok || got != `Z:\rl` {
		t.Fatalf("case-insensitive: %q %v", got, ok)
	}
}

func slash(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = filepath.ToSlash(s)
	}
	return out
}

func TestCandidatesOrder(t *testing.T) {
	files := map[string][]byte{
		filepath.Join(`C:\Program Files (x86)\Steam`, "steamapps", "libraryfolders.vdf"): read(t, "libraryfolders.vdf"),
		epicDatPath: read(t, "LauncherInstalled.dat"),
	}
	rf := func(p string) ([]byte, error) {
		if b, ok := files[p]; ok {
			return b, nil
		}
		return nil, errors.New("missing")
	}
	got := slash(Candidates(`C:\Program Files (x86)\Steam`, rf))
	want := slash([]string{
		filepath.Join(`C:\Program Files (x86)\Steam`, "steamapps", "common", "rocketleague"),
		filepath.Join(`D:\Spiele Bibliothek\Steam`, "steamapps", "common", "rocketleague"),
		`E:\Épîc Spiele\rocketleague`,
		filepath.Join("C:/Program Files/Epic Games", "rocketleague"),
	})
	// the final default (Steam x86) duplicates the first candidate and is de-duplicated
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q\nwant %q", got, want)
	}
}

func TestCandidatesNoFiles(t *testing.T) {
	rf := func(string) ([]byte, error) { return nil, errors.New("x") }
	got := slash(Candidates("", rf))
	want := []string{"C:/Program Files/Epic Games/rocketleague", "C:/Program Files (x86)/Steam/steamapps/common/rocketleague"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	// unreadable vdf falls back to the steam root itself
	got = slash(Candidates("F:/Steam", rf))
	if got[0] != "F:/Steam/steamapps/common/rocketleague" {
		t.Fatalf("got %q", got)
	}
}

func TestFind(t *testing.T) {
	cands := []string{"/a", "/b", "/c"}
	have := map[string]bool{
		filepath.Join("/b", "TAGame", "Config"): true,
		filepath.Join("/c", "TAGame", "Config"): true,
	}
	got, ok := Find(cands, func(p string) bool { return have[p] })
	if !ok || got != "/b" {
		t.Fatalf("got %q %v", got, ok)
	}
	if _, ok := Find(cands, func(string) bool { return false }); ok {
		t.Fatal("expected not found")
	}
}
