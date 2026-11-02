package setup

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"sync"
	"testing"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/statsini"
)

type fakeDialogs struct {
	mu      sync.Mutex
	codes   []string // "" entry means cancel
	folders []string // "" entry means cancel
	infos   []string
}

func (d *fakeDialogs) AskPairingCode() (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.codes) == 0 {
		return "", false
	}
	c := d.codes[0]
	d.codes = d.codes[1:]
	return c, c != ""
}

func (d *fakeDialogs) AskRLFolder() (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.folders) == 0 {
		return "", false
	}
	f := d.folders[0]
	d.folders = d.folders[1:]
	return f, f != ""
}

func (d *fakeDialogs) Info(msg string) {
	d.mu.Lock()
	d.infos = append(d.infos, msg)
	d.mu.Unlock()
}

func (d *fakeDialogs) Infos() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.infos...)
}

type fakePairer struct {
	mu     sync.Mutex
	calls  []string
	labels []string
	errs   map[string]error
	key    string
}

func (p *fakePairer) Pair(ctx context.Context, code, label string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, code)
	p.labels = append(p.labels, label)
	if err := p.errs[code]; err != nil {
		return "", err
	}
	return p.key, nil
}

func nolog(string, ...any) {}

func TestPairExpiredCodeShowsMessageAndRetries(t *testing.T) {
	d := &fakeDialogs{codes: []string{"OLD123", " NEW456 "}}
	p := &fakePairer{errs: map[string]error{"OLD123": api.ErrCodeExpired}, key: "secret"}
	key, ok := Pair(context.Background(), d, p, "zach@PC", nolog)
	if !ok || key != "secret" {
		t.Fatalf("key=%q ok=%v", key, ok)
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgCodeExpired {
		t.Fatalf("infos %q", got)
	}
	if len(p.calls) != 2 || p.calls[1] != "NEW456" || p.labels[1] != "zach@PC" {
		t.Fatalf("calls %q labels %q", p.calls, p.labels)
	}
}

func TestPairCancelReturnsNotOK(t *testing.T) {
	d := &fakeDialogs{codes: []string{""}}
	p := &fakePairer{key: "secret"}
	if _, ok := Pair(context.Background(), d, p, "l", nolog); ok {
		t.Fatal("cancel must return ok=false")
	}
	if len(p.calls) != 0 {
		t.Fatal("must not call Pair after cancel")
	}
}

func TestPairNetworkErrorShowsMessageAndRetries(t *testing.T) {
	d := &fakeDialogs{codes: []string{"A", "B"}}
	p := &fakePairer{errs: map[string]error{"A": api.ErrRetryable}, key: "k"}
	key, ok := Pair(context.Background(), d, p, "l", nolog)
	if !ok || key != "k" {
		t.Fatal(key, ok)
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgPairOffline {
		t.Fatalf("infos %q", got)
	}
}

func TestPairOtherErrorShowsMessage(t *testing.T) {
	d := &fakeDialogs{codes: []string{"A", ""}}
	p := &fakePairer{errs: map[string]error{"A": api.ErrRejected{Status: 403}}}
	if _, ok := Pair(context.Background(), d, p, "l", nolog); ok {
		t.Fatal("want cancel")
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgPairFailed {
		t.Fatalf("infos %q", got)
	}
}

func TestPairStopsWhenContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d := &fakeDialogs{codes: []string{"A"}}
	p := &fakePairer{key: "k"}
	if _, ok := Pair(ctx, d, p, "l", nolog); ok {
		t.Fatal("want not ok")
	}
}

func TestLabel(t *testing.T) {
	if got := Label("zach", "GAMING-PC"); got != "zach@GAMING-PC" {
		t.Fatal(got)
	}
	if got := Label("", ""); got != "user@pc" {
		t.Fatal(got)
	}
}

func existsSet(paths ...string) func(string) bool {
	m := map[string]bool{}
	for _, p := range paths {
		m[filepath.Clean(p)] = true
	}
	return func(p string) bool { return m[filepath.Clean(p)] }
}

func TestFindRLUsesCandidateWithoutAsking(t *testing.T) {
	d := &fakeDialogs{folders: []string{"/should/not/ask"}}
	exists := existsSet(filepath.Join("/b/rl", "TAGame", "Config"))
	dir, ok := FindRL([]string{"/a/rl", "/b/rl"}, exists, d, true)
	if !ok || dir != "/b/rl" {
		t.Fatal(dir, ok)
	}
	if len(d.folders) != 1 {
		t.Fatal("asked for a folder")
	}
}

func TestFindRLFallsBackToPicker(t *testing.T) {
	d := &fakeDialogs{folders: []string{"/wrong", "/games/Rocket League"}}
	exists := existsSet(filepath.Join("/games/Rocket League", "TAGame", "Config"))
	dir, ok := FindRL([]string{"/a/rl"}, exists, d, true)
	if !ok || dir != "/games/Rocket League" {
		t.Fatal(dir, ok)
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgNotRLFolder {
		t.Fatalf("infos %q", got)
	}
}

func TestFindRLPickerCancelled(t *testing.T) {
	d := &fakeDialogs{folders: []string{""}}
	if _, ok := FindRL([]string{"/a"}, existsSet(), d, true); ok {
		t.Fatal("want not found")
	}
}

func TestFindRLNoAskWhenNotFirstRun(t *testing.T) {
	d := &fakeDialogs{folders: []string{"/x"}}
	if _, ok := FindRL([]string{"/a"}, existsSet(), d, false); ok {
		t.Fatal("want not found")
	}
	if len(d.folders) != 1 {
		t.Fatal("must not ask")
	}
}

// memFS is an in-memory statsini.FS.
type memFS struct {
	files     map[string][]byte
	existsErr map[string]error
}

func (m *memFS) ReadFile(p string) ([]byte, error) {
	b, ok := m.files[p]
	if !ok {
		return nil, fs.ErrNotExist
	}
	return b, nil
}
func (m *memFS) WriteFile(p string, b []byte) error {
	m.files[p] = append([]byte(nil), b...)
	return nil
}
func (m *memFS) Exists(p string) (bool, error) {
	if err := m.existsErr[p]; err != nil {
		return false, err
	}
	_, ok := m.files[p]
	return ok, nil
}
func (m *memFS) Rename(a, b string) error { m.files[b] = m.files[a]; delete(m.files, a); return nil }
func (m *memFS) Remove(p string) error    { delete(m.files, p); return nil }

var (
	cfgDir     = filepath.Join("/rl", "TAGame", "Config")
	defaultIni = filepath.Join(cfgDir, "DefaultStatsAPI.ini")
	taIni      = filepath.Join(cfgDir, "TAStatsAPI.ini")
)

func TestEnableChangedWhileRunningAsksForRestart(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\n")}}
	d := &fakeDialogs{}
	EnableStatsAPI("/rl", m, func() bool { return true }, d, nolog)
	if string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=20\r\n" {
		t.Fatalf("ini %q", m.files[defaultIni])
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgRestartRL {
		t.Fatalf("infos %q", got)
	}
}

func TestEnableChangedNotRunningNoMessage(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")}}
	d := &fakeDialogs{}
	EnableStatsAPI("/rl", m, func() bool { return false }, d, nolog)
	if len(d.Infos()) != 0 {
		t.Fatal(d.Infos())
	}
}

func TestEnableUnchangedWhileRunningNoMessage(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n")}}
	d := &fakeDialogs{}
	EnableStatsAPI("/rl", m, func() bool { return true }, d, nolog)
	if len(d.Infos()) != 0 {
		t.Fatal(d.Infos())
	}
}

func TestEnablePrefersTAStatsAPI(t *testing.T) {
	m := &memFS{files: map[string][]byte{
		defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n"),
		taIni:      []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n"),
	}}
	EnableStatsAPI("/rl", m, func() bool { return false }, &fakeDialogs{}, nolog)
	if string(m.files[taIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n" {
		t.Fatal("TAStatsAPI.ini not patched")
	}
	if string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n" {
		t.Fatal("DefaultStatsAPI.ini must be untouched")
	}
}

func TestEnableExistsErrorFallsBackToDefault(t *testing.T) {
	m := &memFS{
		files:     map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")},
		existsErr: map[string]error{taIni: errors.New("access denied")},
	}
	var logged []string
	logf := func(f string, a ...any) { logged = append(logged, f) }
	EnableStatsAPI("/rl", m, func() bool { return false }, &fakeDialogs{}, logf)
	if string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n" {
		t.Fatal("default ini not patched")
	}
	if len(logged) == 0 {
		t.Fatal("exists error not logged")
	}
}

func TestEnableUnsupportedEncodingShowsInfoAndContinues(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: {0xFF, 0xFE, '[', 0}}}
	d := &fakeDialogs{}
	EnableStatsAPI("/rl", m, func() bool { return true }, d, nolog)
	if got := d.Infos(); len(got) != 1 || got[0] != MsgUnsupportedIni {
		t.Fatalf("infos %q", got)
	}
	if m.files[defaultIni][0] != 0xFF || len(m.files) != 1 {
		t.Fatal("file must be untouched, no backup")
	}
}

func TestEnableReadErrorShowsInfo(t *testing.T) {
	m := &memFS{files: map[string][]byte{}}
	d := &fakeDialogs{}
	EnableStatsAPI("/rl", m, func() bool { return true }, d, nolog)
	if got := d.Infos(); len(got) != 1 || got[0] != MsgIniFailed {
		t.Fatalf("infos %q", got)
	}
}

var _ statsini.FS = (*memFS)(nil)
