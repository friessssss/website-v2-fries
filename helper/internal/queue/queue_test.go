package queue

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

func ev(kind string, sec int) model.Event {
	return model.Event{Kind: kind, MatchGUID: "g", At: time.Date(2026, 1, 2, 3, 4, sec, 5e6, time.UTC)}
}

func TestPersistAcrossReopen(t *testing.T) {
	p := filepath.Join(t.TempDir(), "queue.jsonl")
	q, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if err := q.Push(ev("goal", 1), ev("goal", 2)); err != nil {
		t.Fatal(err)
	}
	if err := q.Push(ev("goal", 3)); err != nil {
		t.Fatal(err)
	}
	q2, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if q2.Len() != 3 {
		t.Fatalf("len %d", q2.Len())
	}
	got := q2.Peek(10)
	if !got[0].At.Equal(ev("goal", 1).At) {
		t.Fatalf("original at lost: %v", got[0].At)
	}
}

func TestDropRewritesAtomically(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "queue.jsonl")
	q, _ := Open(p)
	q.Push(ev("goal", 1), ev("goal", 2), ev("goal", 3))
	if err := q.Drop(2); err != nil {
		t.Fatal(err)
	}
	if q.Len() != 1 {
		t.Fatalf("len %d", q.Len())
	}
	q2, _ := Open(p)
	got := q2.Peek(5)
	if len(got) != 1 || !got[0].At.Equal(ev("goal", 3).At) {
		t.Fatalf("got %+v", got)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("stray temp files: %v", entries)
	}
	// Drop more than present empties it; Drop(0) is a no-op.
	if err := q.Drop(0); err != nil || q.Len() != 1 {
		t.Fatal("drop 0")
	}
	if err := q.Drop(99); err != nil || q.Len() != 0 {
		t.Fatal("drop all")
	}
}

func TestTruncatedLastLineSkipped(t *testing.T) {
	p := filepath.Join(t.TempDir(), "queue.jsonl")
	q, _ := Open(p)
	q.Push(ev("goal", 1), ev("goal", 2))
	f, _ := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(`{"kind":"goal","matchGuid":"g","at":"2026-01-0`)
	f.Close()

	q2, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	if q2.Len() != 2 {
		t.Fatalf("len %d", q2.Len())
	}
	// A later push must not merge with the garbage.
	if err := q2.Push(ev("goal", 3)); err != nil {
		t.Fatal(err)
	}
	q3, err := Open(p)
	if err != nil || q3.Len() != 3 {
		t.Fatalf("reopen: %v len %d", err, q3.Len())
	}
}

func TestPeekCopiesAndLimits(t *testing.T) {
	q, _ := Open(filepath.Join(t.TempDir(), "q"))
	q.Push(ev("a", 1), ev("b", 2), ev("c", 3))
	got := q.Peek(2)
	if len(got) != 2 || got[1].Kind != "b" {
		t.Fatalf("%+v", got)
	}
	got[0].Kind = "mutated"
	if q.Peek(1)[0].Kind != "a" {
		t.Fatal("peek aliases internal state")
	}
}

func TestConcurrent(t *testing.T) {
	q, _ := Open(filepath.Join(t.TempDir(), "q"))
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				q.Push(ev("x", j))
				q.Peek(3)
				q.Len()
			}
		}()
	}
	wg.Wait()
	if q.Len() != 80 {
		t.Fatalf("len %d", q.Len())
	}
}

func TestFailedAppendIsRolledBack(t *testing.T) {
	p := filepath.Join(t.TempDir(), "queue.jsonl")
	q, _ := Open(p)
	q.Push(ev("goal", 1))
	q.write = func(f *os.File, b []byte) (int, error) {
		n, _ := f.Write(b[:len(b)/2])
		return n, errors.New("disk full")
	}
	if err := q.Push(ev("goal", 2)); err == nil {
		t.Fatal("expected error")
	}
	if q.Len() != 1 {
		t.Fatalf("len %d", q.Len())
	}
	q.write = func(f *os.File, b []byte) (int, error) { return f.Write(b) }
	if err := q.Push(ev("goal", 3)); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(p)
	if bytes.Count(data, []byte("\n")) != 2 {
		t.Fatalf("file corrupt: %q", data)
	}
	q2, _ := Open(p)
	if q2.Len() != 2 {
		t.Fatalf("reopen len %d", q2.Len())
	}
}
