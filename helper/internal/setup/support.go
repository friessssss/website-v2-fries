package setup

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// Settings persist in settings.json in the install dir.
type Settings struct {
	Toasts bool   `json:"toasts"`
	RLDir  string `json:"rlDir,omitempty"` // a folder the user picked, tried first next time
}

// LoadSettings reads path. A missing or unreadable file gives the defaults
// (toasts on).
func LoadSettings(path string) Settings {
	var raw struct {
		Toasts *bool  `json:"toasts"`
		RLDir  string `json:"rlDir"`
	}
	s := Settings{Toasts: true}
	b, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(b, &raw) != nil {
		return s
	}
	if raw.Toasts != nil {
		s.Toasts = *raw.Toasts
	}
	s.RLDir = raw.RLDir
	return s
}

// SaveSettings writes path atomically, creating its directory.
func SaveSettings(path string, s Settings) error {
	b, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Log is a simple file logger. It never sees the API key: callers must not
// pass it.
type Log struct {
	mu sync.Mutex
	f  *os.File
}

// OpenLog opens path for appending, truncating it first if it is larger than
// maxBytes.
func OpenLog(path string, maxBytes int64) (*Log, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if fi, err := os.Stat(path); err == nil && fi.Size() > maxBytes {
		flags |= os.O_TRUNC
	}
	f, err := os.OpenFile(path, flags, 0o644)
	if err != nil {
		return nil, err
	}
	return &Log{f: f}, nil
}

// Logf writes one timestamped line. Safe for concurrent use; nil-safe.
func (l *Log) Logf(format string, args ...any) {
	if l == nil {
		return
	}
	line := time.Now().Format("2006-01-02 15:04:05.000 ") + fmt.Sprintf(format, args...) + "\n"
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f != nil {
		l.f.WriteString(line)
	}
}

// Close closes the file.
func (l *Log) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return nil
	}
	err := l.f.Close()
	l.f = nil
	return err
}

// Site is a goroutine-safe api.Client whose key can change (after re-pair).
type Site struct {
	mu sync.Mutex
	c  api.Client
}

// NewSite wraps a client configuration.
func NewSite(c api.Client) *Site { return &Site{c: c} }

// SetKey replaces the API key used by later calls.
func (s *Site) SetKey(k string) { s.mu.Lock(); s.c.Key = k; s.mu.Unlock() }

func (s *Site) client() *api.Client {
	s.mu.Lock()
	c := s.c
	s.mu.Unlock()
	return &c
}

func (s *Site) Pair(ctx context.Context, code, label string) (string, error) {
	return s.client().Pair(ctx, code, label)
}

func (s *Site) PostEvents(ctx context.Context, evs []model.Event, sentAt time.Time) ([]api.Result, error) {
	return s.client().PostEvents(ctx, evs, sentAt)
}

func (s *Site) Ping(ctx context.Context) error { return s.client().Ping(ctx) }

func (s *Site) Latest(ctx context.Context) (string, string, error) {
	return s.client().Latest(ctx)
}
