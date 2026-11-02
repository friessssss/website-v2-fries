package update

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewer(t *testing.T) {
	cases := []struct {
		cur, latest string
		want        bool
	}{
		{"1.0.0", "helper-v1.0.1", true},
		{"1.2.0", "helper-v1.10.0", true},
		{"1.0.0", "helper-v1.0.0", false},
		{"1.0.1", "helper-v1.0.0", false},
		{"v1.0.0", "v2.0.0", true},
		{"1.0.0", "2.0.0", true},
		{"0.0.0-dev", "helper-v0.0.1", true},
		{"1.0.0", "", false},
		{"1.0.0", "helper-vgarbage", false},
		{"1.0.0", "helper-v1.0", false},
	}
	for _, c := range cases {
		if got := Newer(c.cur, c.latest); got != c.want {
			t.Errorf("Newer(%q,%q)=%v want %v", c.cur, c.latest, got, c.want)
		}
	}
}

func TestDownloadWritesExactBytes(t *testing.T) {
	payload := bytes.Repeat([]byte{0, 1, 2, 0xff, 'M', 'Z'}, 10000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "RLGoalTracker.new.exe")
	if err := Download(context.Background(), srv.URL, dest); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("got %d bytes, want %d", len(got), len(payload))
	}
	if _, err := os.Stat(dest + ".part"); !os.IsNotExist(err) {
		t.Fatal("temp file left behind")
	}
}

func TestDownloadErrorLeavesNoFile(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", 404)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "RLGoalTracker.new.exe")
	if err := Download(context.Background(), srv.URL, dest); err == nil {
		t.Fatal("want error")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("left files: %v", ents)
	}
}

func TestDownloadTruncatedBodyFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.Write([]byte("short"))
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "RLGoalTracker.new.exe")
	if err := Download(context.Background(), srv.URL, dest); err == nil {
		t.Fatal("want error")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("left files: %v", ents)
	}
}
