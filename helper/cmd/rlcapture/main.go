// rlcapture records the raw Rocket League Stats API stream to a file (and
// stdout) so the real wire format can be inspected.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/signal"
	"strconv"
	"time"

	"github.com/coder/websocket"
)

const frameSep = "\n\x1e\n"

// tee copies r to both writers unchanged until EOF or error.
func tee(r io.Reader, file, out io.Writer) (int64, error) {
	return io.Copy(io.MultiWriter(&failWriter{file}, out), r)
}

// writeError marks a failure writing to an output (as opposed to a network
// failure), so the caller can abort instead of retrying.
type writeError struct{ err error }

func (e *writeError) Error() string { return "write failed: " + e.err.Error() }
func (e *writeError) Unwrap() error { return e.err }

type failWriter struct{ w io.Writer }

func (f *failWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if err != nil {
		err = &writeError{err}
	}
	return n, err
}

// quietWriter drops errors (e.g. a closed console) so stdout never aborts a capture.
type quietWriter struct{ w io.Writer }

func (q quietWriter) Write(p []byte) (int, error) { q.w.Write(p); return len(p), nil }

// writeFramed writes one WebSocket message followed by the separator.
func writeFramed(w io.Writer, msg []byte) error {
	buf := make([]byte, 0, len(msg)+len(frameSep))
	buf = append(buf, msg...)
	buf = append(buf, frameSep...)
	_, err := w.Write(buf)
	return err
}

// readWS reads messages until the connection closes, writing each framed to
// every writer. A normal close returns nil.
func readWS(ctx context.Context, conn *websocket.Conn, outs ...io.Writer) error {
	defer conn.CloseNow()
	conn.SetReadLimit(16 << 20)
	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			switch websocket.CloseStatus(err) {
			case websocket.StatusNormalClosure, websocket.StatusGoingAway:
				return nil
			}
			return err
		}
		for _, w := range outs {
			if err := writeFramed(w, msg); err != nil {
				return &writeError{err}
			}
		}
	}
}

func main() {
	port := flag.Int("port", 49123, "Stats API port")
	out := flag.String("out", "", "output file (default capture-<timestamp>.bin)")
	ws := flag.Bool("ws", false, "dial a WebSocket instead of raw TCP")
	flag.Parse()

	name := *out
	if name == "" {
		name = "capture-" + time.Now().Format("20060102-150405") + ".bin"
	}
	f, err := os.Create(name)
	if err != nil {
		fmt.Fprintln(os.Stderr, "rlcapture: cannot create output:", err)
		os.Exit(1)
	}
	defer f.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(*port))
	fmt.Fprintf(os.Stderr, "rlcapture: writing to %s, target %s (ws=%v). Ctrl+C to stop.\n", name, addr, *ws)

	waitingShown := false
	for ctx.Err() == nil {
		connected, err := capture(ctx, addr, *ws, f)
		_ = f.Sync()
		if ctx.Err() != nil {
			break
		}
		var we *writeError
		if errors.As(err, &we) {
			fmt.Fprintf(os.Stderr, "rlcapture: ABORTING, cannot write %s: %v\n", name, we.err)
			f.Close()
			os.Exit(1)
		}
		if connected {
			waitingShown = false
			if err != nil {
				fmt.Fprintln(os.Stderr, "rlcapture: disconnected:", err)
			} else {
				fmt.Fprintln(os.Stderr, "rlcapture: disconnected")
			}
		} else if !waitingShown {
			waitingShown = true
			fmt.Fprintln(os.Stderr, "rlcapture: waiting for Rocket League (not connected) - retrying every 5s")
		}
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
	_ = f.Sync()
	fmt.Fprintln(os.Stderr, "rlcapture: stopped, file flushed:", name)
}

// capture makes one connection attempt and streams until it ends. connected
// reports whether the connection was established.
func capture(ctx context.Context, addr string, ws bool, f *os.File) (connected bool, err error) {
	out := quietWriter{os.Stdout}
	if ws {
		dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		conn, _, err := websocket.Dial(dctx, "ws://"+addr, nil)
		cancel()
		if err != nil {
			return false, err
		}
		fmt.Fprintln(os.Stderr, "rlcapture: connected (websocket)")
		return true, readWS(ctx, conn, f, out)
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return false, err
	}
	defer c.Close()
	fmt.Fprintln(os.Stderr, "rlcapture: connected (tcp)")
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			c.Close()
		case <-done:
		}
	}()
	_, err = tee(c, f, out)
	if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
		return true, nil
	}
	return true, err
}
