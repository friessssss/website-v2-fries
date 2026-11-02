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
	return io.Copy(io.MultiWriter(file, out), r)
}

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
				return err
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

	for ctx.Err() == nil {
		err := capture(ctx, addr, *ws, f)
		_ = f.Sync()
		if ctx.Err() != nil {
			break
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "rlcapture: disconnected:", err)
		} else {
			fmt.Fprintln(os.Stderr, "rlcapture: disconnected")
		}
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
	}
	_ = f.Sync()
	fmt.Fprintln(os.Stderr, "rlcapture: stopped, file flushed:", name)
}

// capture makes one connection attempt and streams until it ends.
func capture(ctx context.Context, addr string, ws bool, f *os.File) error {
	if ws {
		dctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		conn, _, err := websocket.Dial(dctx, "ws://"+addr, nil)
		cancel()
		if err != nil {
			return err
		}
		fmt.Fprintln(os.Stderr, "rlcapture: connected (websocket)")
		return readWS(ctx, conn, f, os.Stdout)
	}
	d := net.Dialer{Timeout: 5 * time.Second}
	c, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
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
	_, err = tee(c, f, os.Stdout)
	if ctx.Err() != nil || errors.Is(err, net.ErrClosed) {
		return nil
	}
	return err
}
