// Package statsapi connects to the Rocket League Stats API and parses its
// messages into helper events. See testdata/README.md for the wire format.
package statsapi

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/coder/websocket"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
)

// Variables so tests can shorten them.
var (
	sniffTimeout   = time.Second     // wait for the first byte of a raw TCP stream
	connectTimeout = 2 * time.Second // TCP connect / WebSocket handshake
)

const wsReadLimit = 16 << 20

// splitJSON returns a function yielding each JSON value from r, whether they
// are concatenated ("}{"), newline-separated or split across reads. It
// returns io.EOF at a clean end of stream.
func splitJSON(r io.Reader) func() (json.RawMessage, error) {
	dec := json.NewDecoder(r)
	return func() (json.RawMessage, error) {
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		return raw, nil
	}
}

// stream is a Stats API connection (raw TCP, WebSocket or a capture file).
type stream struct {
	c    io.Closer
	dl   interface{ SetReadDeadline(time.Time) error } // nil for files
	next func() (json.RawMessage, error)
}

// Next returns the next message, io.EOF when the peer closes, or ctx's error
// if ctx ends first (the stream is unusable afterwards).
func (s *stream) Next(ctx context.Context) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.dl != nil {
		stop := context.AfterFunc(ctx, func() { s.dl.SetReadDeadline(time.Unix(1, 0)) })
		defer stop()
	}
	raw, err := s.next()
	if err != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return raw, err
}

func (s *stream) Close() error { return s.c.Close() }

func connStream(c net.Conn, r io.Reader) *stream {
	return &stream{c: c, dl: c, next: splitJSON(r)}
}

var errNotJSON = errors.New("not a raw JSON stream")

// Dial connects to the Stats API on host at the first answering port. On each
// port it first tries raw TCP and sniffs the first byte (1 s): `{` means a raw
// JSON stream; anything else (or silence) and it retries the port as a
// WebSocket.
func Dial(ctx context.Context, host string, ports []int) (app.Stream, error) {
	var errs []error
	for _, port := range ports {
		addr := net.JoinHostPort(host, strconv.Itoa(port))
		s, err := dialTCP(ctx, addr)
		if err == nil {
			return s, nil
		}
		errs = append(errs, err)
		if ctx.Err() != nil {
			break
		}
		if !errors.Is(err, errNotJSON) {
			continue // nothing listening: a WebSocket would fail too
		}
		if s, err = dialWS(ctx, addr); err == nil {
			return s, nil
		}
		errs = append(errs, err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, errors.Join(errs...)
}

func dialTCP(ctx context.Context, addr string) (*stream, error) {
	d := net.Dialer{Timeout: connectTimeout}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c.SetReadDeadline(time.Now().Add(sniffTimeout))
	br := bufio.NewReader(c)
	first, err := br.Peek(1)
	if err != nil || first[0] != '{' {
		c.Close()
		return nil, fmt.Errorf("tcp %s: %w", addr, errNotJSON)
	}
	c.SetReadDeadline(time.Time{})
	return connStream(c, br), nil
}

// localClient never uses a proxy: the Stats API is on this machine.
var localClient = &http.Client{Transport: &http.Transport{Proxy: nil}}

func dialWS(ctx context.Context, addr string) (*stream, error) {
	hctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	wc, _, err := websocket.Dial(hctx, "ws://"+addr, &websocket.DialOptions{HTTPClient: localClient})
	if err != nil {
		return nil, fmt.Errorf("websocket %s: %w", addr, err)
	}
	wc.SetReadLimit(wsReadLimit)
	// Messages are read as one byte stream so a frame holding several
	// objects (or one object split over frames) still parses.
	nc := websocket.NetConn(context.Background(), wc, websocket.MessageText)
	return connStream(nc, nc), nil
}

// OpenFile replays a capture file (as written by rlcapture) as a Stream.
// rlcapture's WebSocket frame separator (\n\x1e\n) is treated as whitespace.
func OpenFile(path string) (app.Stream, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	return &stream{c: f, next: splitJSON(rsStripper{bufio.NewReader(f)})}, nil
}

// rsStripper turns ASCII record separators into newlines. Inside JSON
// strings control characters are always escaped, so this never alters data.
type rsStripper struct{ r io.Reader }

func (s rsStripper) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	for i := range p[:n] {
		if p[i] == 0x1e {
			p[i] = '\n'
		}
	}
	return n, err
}
