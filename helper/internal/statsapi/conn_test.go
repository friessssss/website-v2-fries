package statsapi

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func init() { sniffTimeout = 200 * time.Millisecond }

func collect(t *testing.T, ctx context.Context, next func(context.Context) (string, error)) []string {
	t.Helper()
	var got []string
	for {
		m, err := next(ctx)
		if errors.Is(err, io.EOF) {
			return got
		}
		if err != nil {
			t.Fatalf("after %v: %v", got, err)
		}
		got = append(got, m)
	}
}

func portOf(t *testing.T, addr string) int {
	t.Helper()
	_, p, _ := net.SplitHostPort(addr)
	n, err := strconv.Atoi(p)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestSplitJSON(t *testing.T) {
	next := splitJSON(strings.NewReader("{\"a\":1}{\"b\":2}\n {\"c\":{\"d\":3}}\n"))
	var got []string
	for {
		raw, err := next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, string(raw))
	}
	if strings.Join(got, "|") != `{"a":1}|{"b":2}|{"c":{"d":3}}` {
		t.Fatalf("got %q", got)
	}
}

func TestDialTCPConcatenatedAndSplit(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		// Two objects in one write, then a third split across writes.
		c.Write([]byte(`{"Event":"A","Data":"{}"}{"Event":"B","Data":"{}"}{"Event":"C",`))
		time.Sleep(50 * time.Millisecond)
		c.Write([]byte(`"Data":"{}"}`))
		c.Close()
	}()
	ctx := context.Background()
	s, err := Dial(ctx, "127.0.0.1", []int{portOf(t, ln.Addr().String())})
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	got := collect(t, ctx, func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
	if len(got) != 3 || !strings.Contains(got[0], `"A"`) || !strings.Contains(got[2], `"C"`) {
		t.Fatalf("got %q", got)
	}
}

func TestDialWebSocket(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		ctx := r.Context()
		c.Write(ctx, websocket.MessageText, []byte(`{"Event":"A","Data":"{}"}`))
		c.Write(ctx, websocket.MessageText, []byte(`{"Event":"B","Data":"{}"}`))
		c.Close(websocket.StatusNormalClosure, "")
	}))
	defer srv.Close()
	// The first (raw TCP) port refuses connections, so the second port is
	// dialled as a WebSocket.
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	deadPort := portOf(t, dead.Addr().String())
	dead.Close()
	ctx := context.Background()
	s, err := Dial(ctx, "127.0.0.1", []int{deadPort, portOf(t, srv.Listener.Addr().String())})
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	got := collect(t, ctx, func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
	if len(got) != 2 || !strings.Contains(got[0], `"A"`) || !strings.Contains(got[1], `"B"`) {
		t.Fatalf("got %q", got)
	}
}

func TestDialNothingListening(t *testing.T) {
	dead, _ := net.Listen("tcp", "127.0.0.1:0")
	port := portOf(t, dead.Addr().String())
	dead.Close()
	if _, err := Dial(context.Background(), "127.0.0.1", []int{port}); err == nil {
		t.Fatal("expected an error")
	}
}

func TestNextHonoursContext(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		defer c.Close()
		c.Write([]byte(`{"a":1}`))
		time.Sleep(2 * time.Second)
	}()
	s, err := Dial(context.Background(), "127.0.0.1", []int{portOf(t, ln.Addr().String())})
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	if _, err := s.Next(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := s.Next(ctx); !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second {
		t.Fatalf("err %v after %v", err, time.Since(start))
	}
}

func TestOpenFile(t *testing.T) {
	dir := t.TempDir()
	// TCP-style concatenation plus rlcapture's WebSocket frame separator.
	path := filepath.Join(dir, "cap.bin")
	os.WriteFile(path, []byte("{\"Event\":\"A\"}{\"Event\":\"B\"}\n\x1e\n{\"Event\":\"C\"}\n\x1e\n"), 0o644)
	s, err := OpenFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	got := collect(t, context.Background(), func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
	if strings.Join(got, "|") != `{"Event":"A"}|{"Event":"B"}|{"Event":"C"}` {
		t.Fatalf("got %q", got)
	}
	if _, err := OpenFile(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing file: expected an error")
	}
}

func TestFixtureThroughOpenFile(t *testing.T) {
	s, err := OpenFile("../../testdata/match-tcp.bin")
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	p := NewParser()
	n := 0
	for {
		raw, err := s.Next(context.Background())
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		n += len(p.Feed(raw))
	}
	if n != 7 {
		t.Fatalf("%d events, want 7", n)
	}
}

func TestDialSilentTCPKeptAsRawJSON(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		time.Sleep(2 * sniffTimeout) // RL idle in menus: nothing at first
		c.Write([]byte(`{"Event":"A"}{"Event":"B"}`))
		c.Close()
	}()
	// A second port that would fail loudly if it were tried.
	ws, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ws.Close()
	tried := make(chan struct{}, 1)
	go func() {
		if c, err := ws.Accept(); err == nil {
			tried <- struct{}{}
			c.Close()
		}
	}()
	ctx := context.Background()
	s, err := Dial(ctx, "127.0.0.1", []int{portOf(t, ln.Addr().String()), portOf(t, ws.Addr().String())})
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	got := collect(t, ctx, func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
	if strings.Join(got, "|") != `{"Event":"A"}|{"Event":"B"}` {
		t.Fatalf("got %q", got)
	}
	select {
	case <-tried:
		t.Fatal("second port dialled although the first accepted")
	default:
	}
}

// chanListener hands accepted connections to an http.Server.
type chanListener struct {
	addr net.Addr
	ch   chan net.Conn
	done chan struct{}
	once sync.Once
}

func (l *chanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ch:
		return c, nil
	case <-l.done:
		return nil, net.ErrClosed
	}
}
func (l *chanListener) Close() error   { l.once.Do(func() { close(l.done) }); return nil }
func (l *chanListener) Addr() net.Addr { return l.addr }

func TestDialNonJSONFirstByteSwitchesToWebSocket(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	defer ln.Close()
	cl := &chanListener{addr: ln.Addr(), ch: make(chan net.Conn), done: make(chan struct{})}
	go func() {
		first := true
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			if first { // the raw TCP sniff sees a non-JSON byte
				first = false
				c.Write([]byte("HELLO"))
				c.Close()
				continue
			}
			select {
			case cl.ch <- c:
			case <-cl.done:
				c.Close()
				return
			}
		}
	}()
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		c.Write(r.Context(), websocket.MessageText, []byte(`{"Event":"W"}`))
		c.Close(websocket.StatusNormalClosure, "")
	})}
	go srv.Serve(cl)
	defer srv.Close()
	ctx := context.Background()
	s, err := Dial(ctx, "127.0.0.1", []int{portOf(t, ln.Addr().String())})
	if err != nil {
		t.Fatal(err)
	}
	defer s.(io.Closer).Close()
	got := collect(t, ctx, func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
	if strings.Join(got, "|") != `{"Event":"W"}` {
		t.Fatalf("got %q", got)
	}
}

// Leading whitespace or a UTF-8 BOM before the first object is still raw
// JSON, not a reason to give up on the port (final review minor).
func TestDialTCPSkipsLeadingWhitespaceAndBOM(t *testing.T) {
	for _, prefix := range []string{" \r\n\t", "\xEF\xBB\xBF", "\xEF\xBB\xBF\n "} {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		go func() {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Write([]byte(prefix))
			time.Sleep(20 * time.Millisecond) // the prefix may arrive alone
			c.Write([]byte(`{"Event":"A","Data":"{}"}`))
			c.Close()
		}()
		ctx := context.Background()
		s, err := Dial(ctx, "127.0.0.1", []int{portOf(t, ln.Addr().String())})
		if err != nil {
			ln.Close()
			t.Fatalf("prefix %q: %v", prefix, err)
		}
		got := collect(t, ctx, func(ctx context.Context) (string, error) { r, err := s.Next(ctx); return string(r), err })
		s.(io.Closer).Close()
		ln.Close()
		if len(got) != 1 || !strings.Contains(got[0], `"A"`) {
			t.Fatalf("prefix %q: got %q", prefix, got)
		}
	}
}
