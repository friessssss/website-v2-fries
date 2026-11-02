// Package setup holds the helper's first-run flow and runtime orchestration
// (pairing, finding Rocket League, enabling the Stats API, tray state, liveness
// pings, self-update scheduling). It is OS-agnostic: every OS call is injected,
// so main.go only wires winsys implementations in.
package setup

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/rlpath"
	"github.com/friessssss/website-v2-fries/helper/internal/statsini"
)

// User-facing copy. Plain, no emoji.
const (
	MsgCodeExpired    = "That code expired. Get a new one in Settings."
	MsgPairOffline    = "Couldn't reach the tracker site. Check your connection and try again."
	MsgPairFailed     = "Pairing didn't work. Get a new code in Settings and try again."
	MsgNotRLFolder    = "That folder doesn't look like Rocket League. Pick the folder that contains TAGame."
	MsgRestartRL      = "Restart Rocket League once to start tracking."
	MsgUnsupportedIni = "Your Rocket League settings file uses an unusual format. Tracking can't be turned on automatically."
	MsgIniFailed      = "Your Rocket League settings file couldn't be changed. Tracking can't be turned on automatically."
)

// Dialogs are the modal prompts (winsys.AskPairingCode, AskRLFolder, Info).
type Dialogs interface {
	AskPairingCode() (string, bool)
	AskRLFolder() (string, bool)
	Info(msg string)
}

// Pairer redeems a pairing code (satisfied by *api.Client and *Site).
type Pairer interface {
	Pair(ctx context.Context, code, label string) (string, error)
}

// Logf is a printf-style logger.
type Logf func(format string, args ...any)

// Label builds the pairing label <USERNAME>@<COMPUTERNAME>.
func Label(user, host string) string {
	if user == "" {
		user = "user"
	}
	if host == "" {
		host = "pc"
	}
	return user + "@" + host
}

// Pair asks for a code until one pairs or the user cancels. Expired codes and
// errors show a message and ask again. ok is false on cancel or ctx done.
func Pair(ctx context.Context, d Dialogs, p Pairer, label string, logf Logf) (key string, ok bool) {
	for ctx.Err() == nil {
		code, ok := d.AskPairingCode()
		if !ok {
			return "", false
		}
		code = strings.TrimSpace(code)
		if code == "" {
			continue
		}
		key, err := p.Pair(ctx, code, label)
		switch {
		case err == nil:
			return key, true
		case ctx.Err() != nil:
			return "", false
		case errors.Is(err, api.ErrCodeExpired):
			d.Info(MsgCodeExpired)
		case errors.Is(err, api.ErrRetryable):
			logf("pair: %v", err)
			d.Info(MsgPairOffline)
		default:
			logf("pair: %v", err)
			d.Info(MsgPairFailed)
		}
	}
	return "", false
}

// FindRL returns the first candidate that is a Rocket League install. If none
// is and ask is true, it shows the folder picker until the user picks a valid
// folder or cancels.
func FindRL(cands []string, exists func(string) bool, d Dialogs, ask bool) (string, bool) {
	if dir, ok := rlpath.Find(cands, exists); ok {
		return dir, true
	}
	if !ask {
		return "", false
	}
	for {
		dir, ok := d.AskRLFolder()
		if !ok {
			return "", false
		}
		if found, ok := rlpath.Find([]string{dir}, exists); ok {
			return found, true
		}
		d.Info(MsgNotRLFolder)
	}
}

// EnableStatsAPI patches the Stats API ini in rlDir. If it changed and Rocket
// League is running, it asks for one restart. Failures are reported and
// startup continues. It returns whether the ini changed.
func EnableStatsAPI(rlDir string, fsys statsini.FS, rlRunning func() bool, d Dialogs, logf Logf) bool {
	exists := func(p string) bool {
		ok, err := fsys.Exists(p)
		if err != nil {
			logf("stats ini: checking %s: %v; using %s", filepath.Base(p), err, "DefaultStatsAPI.ini")
			return false
		}
		return ok
	}
	path := statsini.Choose(rlDir, exists)
	changed, err := statsini.Apply(path, fsys)
	switch {
	case errors.Is(err, statsini.ErrUnsupportedEncoding):
		logf("stats ini: %s: %v", path, err)
		d.Info(MsgUnsupportedIni)
		return false
	case err != nil:
		logf("stats ini: %s: %v", path, err)
		d.Info(MsgIniFailed)
		return false
	}
	logf("stats ini: %s changed=%v", path, changed)
	if changed && rlRunning() {
		d.Info(MsgRestartRL)
	}
	return changed
}
