// Package update checks for and downloads newer helper builds. The swap itself
// happens on the next launch (winsys.SwapIfPending).
package update

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

// NewExeName is the file a downloaded update is saved as, next to the exe.
const NewExeName = "RLGoalTracker.new.exe"

const downloadTimeout = 10 * time.Minute

// parse reads "helper-vX.Y.Z", "vX.Y.Z" or "X.Y.Z"; any "-pre" or "+build"
// suffix is ignored.
func parse(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "helper-")
	v = strings.TrimPrefix(v, "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

// Newer reports whether latest is a strictly higher version than current.
// Unparseable versions are never newer.
func Newer(current, latest string) bool {
	c, ok1 := parse(current)
	l, ok2 := parse(latest)
	if !ok1 || !ok2 {
		return false
	}
	for i := range c {
		if l[i] != c[i] {
			return l[i] > c[i]
		}
	}
	return false
}

// ReleasePathPrefix is the only github.com path an update may come from.
const ReleasePathPrefix = "/friessssss/website-v2-fries/releases/download/"

// AllowedURL reports whether u may serve an update: https on github.com under
// ReleasePathPrefix, or a *.githubusercontent.com host (where release assets
// redirect to).
func AllowedURL(u *url.URL) bool {
	if u == nil || u.Scheme != "https" || u.User != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if strings.HasSuffix(h, ".githubusercontent.com") {
		return true
	}
	if h != "github.com" {
		return false
	}
	p := u.Path // decoded, so %2e%2e is caught as ..
	return strings.HasPrefix(p, ReleasePathPrefix) && path.Clean(p) == p
}

// Download fetches url into dest. The URL and every redirect must pass
// AllowedURL. It writes dest+".part" first and renames it into place only
// after a complete, successful transfer, so a partial file is never left at
// dest.
func Download(ctx context.Context, rawURL, dest string) error {
	return download(ctx, &http.Client{}, AllowedURL, rawURL, dest)
}

const maxRedirects = 10

func download(ctx context.Context, base *http.Client, allow func(*url.URL) bool, rawURL, dest string) (err error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	if !allow(u) {
		return fmt.Errorf("update: download url %q not allowed", u.Redacted())
	}
	hc := *base
	hc.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= maxRedirects {
			return fmt.Errorf("update: too many redirects")
		}
		if !allow(req.URL) {
			return fmt.Errorf("update: redirect to %q not allowed", req.URL.Redacted())
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, downloadTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("update: download status %d", resp.StatusCode)
	}
	tmp := dest + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			f.Close()
			os.Remove(tmp)
		}
	}()
	n, err := io.Copy(f, resp.Body)
	if err != nil {
		return err
	}
	if resp.ContentLength >= 0 && n != resp.ContentLength {
		return fmt.Errorf("update: got %d of %d bytes", n, resp.ContentLength)
	}
	if n == 0 {
		return fmt.Errorf("update: empty download")
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, dest); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
