// Package queue is a persistent FIFO of events backed by a JSONL file.
package queue

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// Queue holds events in memory and mirrors them to one JSON object per line.
type Queue struct {
	mu   sync.Mutex
	path string
	evs  []model.Event
	// write is the append primitive; tests replace it to inject failures.
	write func(f *os.File, b []byte) (int, error)
}

// Open loads the queue file, creating it lazily on first Push. Lines that do
// not parse (for example a line truncated by a crash) are skipped, and the
// file is rewritten clean so later appends cannot merge with the garbage.
func Open(path string) (*Queue, error) {
	q := &Queue{path: path, write: func(f *os.File, b []byte) (int, error) { return f.Write(b) }}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return q, nil
		}
		return nil, err
	}
	dirty := len(data) > 0 && data[len(data)-1] != '\n'
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 64*1024), 16*1024*1024)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var e model.Event
		if err := json.Unmarshal(line, &e); err != nil {
			dirty = true
			continue
		}
		q.evs = append(q.evs, e)
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if dirty {
		if err := q.rewriteLocked(); err != nil {
			return nil, err
		}
	}
	return q, nil
}

// Push appends events and fsyncs before returning.
func (q *Queue) Push(evs ...model.Event) error {
	if len(evs) == 0 {
		return nil
	}
	var buf bytes.Buffer
	for _, e := range evs {
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	f, err := os.OpenFile(q.path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		f.Close()
		return err
	}
	// On any failure cut the file back so a partial line cannot corrupt the next append.
	rollback := func(err error) error {
		if terr := f.Truncate(size); terr != nil {
			err = fmt.Errorf("%w (rollback failed: %v)", err, terr)
		}
		f.Close()
		return err
	}
	if _, err := q.write(f, buf.Bytes()); err != nil {
		return rollback(err)
	}
	if err := f.Sync(); err != nil {
		return rollback(err)
	}
	if err := f.Close(); err != nil {
		return err
	}
	q.evs = append(q.evs, evs...)
	return nil
}

// Peek returns a copy of up to n events from the front.
func (q *Queue) Peek(n int) []model.Event {
	q.mu.Lock()
	defer q.mu.Unlock()
	if n > len(q.evs) {
		n = len(q.evs)
	}
	if n <= 0 {
		return nil
	}
	return append([]model.Event(nil), q.evs[:n]...)
}

// Len is the number of queued events.
func (q *Queue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.evs)
}

// Drop removes the first n events and rewrites the file atomically.
func (q *Queue) Drop(n int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if n <= 0 {
		return nil
	}
	if n > len(q.evs) {
		n = len(q.evs)
	}
	old := q.evs
	q.evs = old[n:]
	if err := q.rewriteLocked(); err != nil {
		q.evs = old
		return err
	}
	return nil
}

// rewriteLocked writes q.evs to a temp file in the same dir, fsyncs, renames.
func (q *Queue) rewriteLocked() error {
	dir := filepath.Dir(q.path)
	tmp, err := os.CreateTemp(dir, filepath.Base(q.path)+".tmp*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	fail := func(err error) error {
		tmp.Close()
		os.Remove(name)
		return err
	}
	w := bufio.NewWriter(tmp)
	for _, e := range q.evs {
		b, err := json.Marshal(e)
		if err != nil {
			return fail(err)
		}
		w.Write(b)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		return fail(err)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, q.path); err != nil {
		os.Remove(name)
		return fmt.Errorf("queue: rename: %w", err)
	}
	return nil
}
