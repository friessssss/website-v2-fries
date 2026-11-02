// Package statsapi connects to the Rocket League Stats API and parses its
// messages.
//
// PROVISIONAL: this file is a placeholder so the helper builds and runs end to
// end before the real protocol is known. Task 3 (built from Zach's recorded
// capture) REPLACES THIS FILE with the real dialer (TCP/WebSocket sniffing on
// 49123, WebSocket on 49124) and parser. Keep the Dial and NewParser
// signatures so main.go does not change.
package statsapi

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// ErrNotImplemented is returned by the provisional Dial. The app treats it
// like a refused connection and retries every 5 s.
var ErrNotImplemented = errors.New("statsapi: not implemented yet (provisional build)")

// Dial would connect to the Stats API on host at the first answering port.
func Dial(ctx context.Context, host string, ports []int) (app.Stream, error) {
	return nil, ErrNotImplemented
}

type parser struct{}

func (parser) Feed(json.RawMessage) []model.Event { return nil }
func (parser) InMatch() bool                      { return false }

// NewParser returns a Source that yields no events.
func NewParser() app.Source { return parser{} }
