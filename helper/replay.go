package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/queue"
	"github.com/friessssss/website-v2-fries/helper/internal/setup"
	"github.com/friessssss/website-v2-fries/helper/internal/statsapi"
	"github.com/friessssss/website-v2-fries/helper/internal/winsys"
)

// replayDrainWait bounds how long --replay waits for the uploads to finish.
// Variables so the test can replace them.
var (
	replayDrainWait = 60 * time.Second
	loadKey         = winsys.LoadKey
)

// eofStream reports when the wrapped Stream reaches its end.
type eofStream struct {
	app.Stream
	once sync.Once
	done chan struct{}
}

func (s *eofStream) Next(ctx context.Context) (json.RawMessage, error) {
	raw, err := s.Stream.Next(ctx)
	if errors.Is(err, io.EOF) {
		s.once.Do(func() { close(s.done) })
	}
	return raw, err
}

func (s *eofStream) Close() error { return s.Stream.(io.Closer).Close() }

// runReplay feeds a capture file through the normal parser, queue and
// uploader (with the stored API key) against base, then exits once the queue
// has drained. It uses its own temporary queue, not the live one.
func runReplay(base, path string) int {
	logf := func(format string, args ...any) { fmt.Fprintf(os.Stderr, "replay: "+format+"\n", args...) }
	key, err := loadKey()
	if err != nil || key == "" {
		logf("no stored API key (pair the helper first): %v", err)
		return 1
	}
	fs, err := statsapi.OpenFile(path)
	if err != nil {
		logf("open %s: %v", path, err)
		return 1
	}
	dir, err := os.MkdirTemp("", "rltracker-replay-")
	if err != nil {
		logf("temp dir: %v", err)
		return 1
	}
	defer os.RemoveAll(dir)
	q, err := queue.Open(filepath.Join(dir, "queue.jsonl"))
	if err != nil {
		logf("open queue: %v", err)
		return 1
	}
	site := setup.NewSite(api.Client{BaseURL: base, Version: version})
	site.SetKey(key)

	src := &eofStream{Stream: fs, done: make(chan struct{})}
	var dialed sync.Once
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := app.New(app.Deps{
		Dial: func(ctx context.Context) (app.Stream, error) {
			var s app.Stream
			dialed.Do(func() { s = src })
			if s != nil {
				return s, nil
			}
			<-ctx.Done() // the file is read once only
			return nil, ctx.Err()
		},
		NewSource: statsapi.NewParser,
		Poster:    site,
		Queue:     q,
		OnState:   func(s app.State) { logf("state %s", s) },
		Logf:      logf,
	})
	appDone := make(chan struct{})
	go func() { a.Run(ctx); close(appDone) }()

	<-src.done // Feed results are queued before the EOF is returned
	deadline := time.Now().Add(replayDrainWait)
	for q.Len() > 0 && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	left := q.Len()
	cancel()
	<-appDone
	if left > 0 {
		logf("%d events not uploaded after %v", left, replayDrainWait)
		return 1
	}
	logf("done: %s uploaded to %s", path, base)
	return 0
}
