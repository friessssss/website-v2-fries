package update

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
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
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "RLGoalTracker.new.exe")
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL, dest); err != nil {
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
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", 404)
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "RLGoalTracker.new.exe")
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL, dest); err == nil {
		t.Fatal("want error")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("left files: %v", ents)
	}
}

func TestDownloadTruncatedBodyFails(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		w.Write([]byte("short"))
	}))
	defer srv.Close()
	dir := t.TempDir()
	dest := filepath.Join(dir, "RLGoalTracker.new.exe")
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL, dest); err == nil {
		t.Fatal("want error")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("left files: %v", ents)
	}
}

// allowLocal accepts the httptest TLS server (127.0.0.1) over https only.
func allowLocal(u *url.URL) bool { return u.Scheme == "https" && u.Hostname() == "127.0.0.1" }

func TestAllowedURL(t *testing.T) {
	cases := map[string]bool{
		"https://github.com/friessssss/website-v2-fries/releases/download/helper-v1.0.0/RLGoalTracker.exe": true,
		"https://objects.githubusercontent.com/github-production-release-asset/x":                          true,
		"https://release-assets.githubusercontent.com/x":                                                   true,
		"https://GitHub.com/x":                    true,
		"http://github.com/x":                     false,
		"https://github.com.evil.example/x":       false,
		"https://evilgithub.com/x":                false,
		"https://githubusercontent.com.evil.io/x": false,
		"https://evil.example/x":                  false,
		"https://user@evil.example/github.com":    false,
		"ftp://github.com/x":                      false,
		"":                                        false,
	}
	for raw, want := range cases {
		u, err := url.Parse(raw)
		got := err == nil && AllowedURL(u)
		if got != want {
			t.Errorf("AllowedURL(%q)=%v want %v", raw, got, want)
		}
	}
}

func TestDownloadRejectsDisallowedInitialURL(t *testing.T) {
	dir := t.TempDir()
	err := Download(context.Background(), "https://evil.example/x.exe", filepath.Join(dir, "a.exe"))
	if err == nil {
		t.Fatal("want error")
	}
	err = Download(context.Background(), "http://github.com/x.exe", filepath.Join(dir, "a.exe"))
	if err == nil {
		t.Fatal("want error for http")
	}
}

func TestDownloadFollowsAllowedRedirect(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/start" {
			http.Redirect(w, r, srv.URL+"/asset", http.StatusFound)
			return
		}
		w.Write([]byte("MZpayload"))
	}))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "n.exe")
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL+"/start", dest); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dest); string(b) != "MZpayload" {
		t.Fatalf("got %q", b)
	}
}

func TestDownloadRejectsRedirectToHTTP(t *testing.T) {
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("plain http server must not be contacted")
		w.Write([]byte("MZ"))
	}))
	defer plain.Close()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, plain.URL+"/asset", http.StatusFound)
	}))
	defer srv.Close()
	dir := t.TempDir()
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL, filepath.Join(dir, "n.exe")); err == nil {
		t.Fatal("want error")
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 0 {
		t.Fatalf("left files: %v", ents)
	}
}

func TestDownloadRejectsRedirectToOtherHost(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://evil.example/asset", http.StatusFound)
	}))
	defer srv.Close()
	if err := download(context.Background(), srv.Client(), allowLocal, srv.URL, filepath.Join(t.TempDir(), "n.exe")); err == nil {
		t.Fatal("want error")
	}
}
