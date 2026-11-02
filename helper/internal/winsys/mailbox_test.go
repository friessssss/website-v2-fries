package winsys

import (
	"sync"
	"testing"
)

func TestMailboxConcurrentPutKeepsLatest(t *testing.T) {
	var m mailbox[int]
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); m.Put(i) }(i)
	}
	wg.Wait()
	m.Put(999)
	select {
	case v := <-m.C():
		if v != 999 {
			t.Fatalf("got %d want 999", v)
		}
	default:
		t.Fatal("value lost")
	}
}

func TestMailboxPutBeforeReader(t *testing.T) {
	var m mailbox[string]
	m.Put("a")
	m.Put("b")
	if v := <-m.C(); v != "b" {
		t.Fatal(v)
	}
}
