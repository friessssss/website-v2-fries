package winsys

import "sync"

// mailbox is a one-slot, latest-wins, never-blocking hand-off. The zero value
// is ready to use and safe for concurrent Put before or after the reader starts.
type mailbox[T any] struct {
	once sync.Once
	ch   chan T
}

func (m *mailbox[T]) init() { m.once.Do(func() { m.ch = make(chan T, 1) }) }

// C returns the receive side.
func (m *mailbox[T]) C() <-chan T { m.init(); return m.ch }

// Put stores v, replacing any unread value. It never blocks.
func (m *mailbox[T]) Put(v T) {
	m.init()
	for {
		select {
		case m.ch <- v:
			return
		default:
		}
		select {
		case <-m.ch:
		default:
		}
	}
}
