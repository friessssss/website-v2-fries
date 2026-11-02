// Package setup holds the helper's first-run flow and runtime orchestration
// (pairing, finding Rocket League, enabling the Stats API, tray state, liveness
// pings, self-update scheduling). It is OS-agnostic: every OS call is injected,
// so main.go only wires winsys implementations in.
package setup

import (
	"context"
	"errors"
	"io/fs"
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

// Notice is a message shown after the tray starts. A non-empty Key makes it
// show at most once ever (remembered in settings.json); later boots only log.
type Notice struct {
	Key string
	Msg string
}

// IniDeps are the collaborators of EnableStatsAPI.
type IniDeps struct {
	FS        statsini.FS
	RLRunning func() bool
	// Elevate patches iniPath from an elevated copy of the helper and
	// returns nil on success. Optional.
	Elevate func(iniPath string) error
	// Once returns true the first time it sees key (and remembers it).
	Once func(key string) bool
	Logf Logf
}

func diyStep(path string) string {
	return " Set PacketSendRate=20 under [TAGame.MatchStatsExporter_TA] in " + path + " yourself, then restart Rocket League."
}

// NeedsAdminMsg is shown when the ini is not writable and elevation failed.
func NeedsAdminMsg(path string) string {
	return "Rocket League's settings file needs permission to change. Right-click RLGoalTracker and choose Run as administrator once, or set PacketSendRate=20 in " + path + " yourself."
}

// EnableStatsAPI patches the Stats API ini in rlDir. If the file is not
// writable it tries Elevate once (ever, per path). It never shows UI itself:
// the returned notices are shown later by ShowNotices.
func EnableStatsAPI(rlDir string, d IniDeps) (changed bool, notices []Notice) {
	logf := d.Logf
	exists := func(p string) bool {
		ok, err := d.FS.Exists(p)
		if err != nil {
			logf("stats ini: checking %s: %v; using %s", filepath.Base(p), err, "DefaultStatsAPI.ini")
			return false
		}
		return ok
	}
	path := statsini.Choose(rlDir, exists)
	changed, err := statsini.Apply(path, d.FS)
	if errors.Is(err, fs.ErrPermission) {
		logf("stats ini: %s: %v", path, err)
		changed, err = elevate(path, d)
	}
	switch {
	case errors.Is(err, statsini.ErrUnsupportedEncoding):
		logf("stats ini: %s: %v", path, err)
		return false, []Notice{{Key: "ini-unsupported:" + path, Msg: MsgUnsupportedIni + diyStep(path)}}
	case errors.Is(err, errNeedsAdmin):
		return false, []Notice{{Key: "ini-admin:" + path, Msg: NeedsAdminMsg(path)}}
	case err != nil:
		logf("stats ini: %s: %v", path, err)
		return false, []Notice{{Key: "ini-failed:" + path, Msg: MsgIniFailed + diyStep(path)}}
	}
	logf("stats ini: %s changed=%v", path, changed)
	if changed && d.RLRunning() {
		notices = append(notices, Notice{Msg: MsgRestartRL})
	}
	return changed, notices
}

var errNeedsAdmin = errors.New("stats ini needs admin rights")

// elevate runs the elevated patch at most once per path, then verifies the
// file no longer needs a change.
func elevate(path string, d IniDeps) (bool, error) {
	if d.Elevate == nil || !d.Once("ini-elevate:"+path) {
		return false, errNeedsAdmin
	}
	if err := d.Elevate(path); err != nil {
		d.Logf("stats ini: elevated patch: %v", err)
		return false, errNeedsAdmin
	}
	again, err := statsini.Apply(path, d.FS)
	if err != nil || again {
		d.Logf("stats ini: still needs a change after elevated patch: %v", err)
		return false, errNeedsAdmin
	}
	return true, nil
}

// ShowNotices shows each notice, skipping once-keyed ones already shown.
func ShowNotices(ns []Notice, once func(string) bool, show func(string), logf Logf) {
	for _, n := range ns {
		if n.Key != "" && !once(n.Key) {
			logf("notice %q already shown; not repeating", n.Key)
			continue
		}
		show(n.Msg)
	}
}

// First-run confirmation copy.
const (
	MsgWelcome    = "RL Goal Tracker is running in your tray. Goals will log automatically while you play."
	MsgRLNotFound = "Couldn't find Rocket League. Choose Find Rocket League from the tray menu to try again."
	MsgRLFound    = "Found Rocket League. Goals will log automatically while you play."
)

// FirstRunNotice is the one-time message after the first setup.
func FirstRunNotice(rlFound bool) Notice {
	if rlFound {
		return Notice{Key: "welcome", Msg: MsgWelcome}
	}
	return Notice{Key: "rl-not-found", Msg: MsgRLNotFound}
}

// Mode is how startup proceeds given the stored key.
type Mode int

const (
	ModePaired   Mode = iota // a key is stored
	ModeFirstRun             // no key: pair, find RL
	ModeKeyError             // the key store failed: start in NeedsPair, no first-run prompts
)

// StartMode decides the startup mode. A LoadKey error is not "unpaired".
func StartMode(key string, loadErr error) Mode {
	switch {
	case loadErr != nil:
		return ModeKeyError
	case key == "":
		return ModeFirstRun
	}
	return ModePaired
}

// Exit codes of the elevated --patch-ini mode.
const (
	PatchOK      = 0
	PatchBadPath = 2
	PatchFailed  = 3
)

// PatchIni is the elevated --patch-ini mode: it only patches an absolute
// path named TAStatsAPI.ini or DefaultStatsAPI.ini inside a TAGame/Config
// folder, and returns the process exit code.
func PatchIni(path string, fsys statsini.FS) int {
	base := filepath.Base(path)
	cfg := filepath.Base(filepath.Dir(path))
	tagame := filepath.Base(filepath.Dir(filepath.Dir(path)))
	if !filepath.IsAbs(path) || !strings.EqualFold(cfg, "Config") || !strings.EqualFold(tagame, "TAGame") ||
		!(strings.EqualFold(base, "TAStatsAPI.ini") || strings.EqualFold(base, "DefaultStatsAPI.ini")) {
		return PatchBadPath
	}
	if _, err := statsini.Apply(path, fsys); err != nil {
		return PatchFailed
	}
	return PatchOK
}
