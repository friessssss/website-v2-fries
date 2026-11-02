package main

import (
	"bytes"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestTeeCopiesBytesUnchangedOverTCP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	payload := []byte("{\"Event\":\"x\"}\x00\r\n\xff{\"b\":2}")
	go func() {
		c, _ := ln.Accept()
		c.Write(payload)
		c.Close()
	}()
	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	var file, out bytes.Buffer
	n, err := tee(conn, &file, &out)
	if err != nil {
		t.Fatalf("tee: %v", err)
	}
	if n != int64(len(payload)) || !bytes.Equal(file.Bytes(), payload) || !bytes.Equal(out.Bytes(), payload) {
		t.Fatalf("mismatch n=%d file=%q out=%q", n, file.Bytes(), out.Bytes())
	}
}

func TestWriteFramedAppendsSeparator(t *testing.T) {
	var b bytes.Buffer
	if err := writeFramed(&b, []byte(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if b.String() != "{\"a\":1}\n\x1e\n" {
		t.Fatalf("got %q", b.String())
	}
}

func TestReadWSFramesEachMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		ctx := context.Background()
		c.Write(ctx, websocket.MessageText, []byte(`{"n":1}`))
		c.Write(ctx, websocket.MessageText, []byte(`{"n":2}`))
		c.Close(websocket.StatusNormalClosure, "")
	}))
	defer srv.Close()
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	var file, out bytes.Buffer
	if err := readWS(ctx, conn, &file, &out); err != nil {
		t.Fatalf("readWS: %v", err)
	}
	want := "{\"n\":1}\n\x1e\n{\"n\":2}\n\x1e\n"
	if file.String() != want || out.String() != want {
		t.Fatalf("file=%q out=%q", file.String(), out.String())
	}
}
