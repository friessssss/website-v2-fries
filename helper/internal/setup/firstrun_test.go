package setup

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"reflect"
	"strings"
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
	dirs, ok := FindRL([]string{"/a/rl", "/b/rl"}, exists, d, true)
	if !ok || !reflect.DeepEqual(dirs, []string{"/b/rl"}) {
		t.Fatal(dirs, ok)
	}
	if len(d.folders) != 1 {
		t.Fatal("asked for a folder")
	}
}

func TestFindRLFallsBackToPicker(t *testing.T) {
	d := &fakeDialogs{folders: []string{"/wrong", "/games/Rocket League"}}
	exists := existsSet(filepath.Join("/games/Rocket League", "TAGame", "Config"))
	dirs, ok := FindRL([]string{"/a/rl"}, exists, d, true)
	if !ok || !reflect.DeepEqual(dirs, []string{"/games/Rocket League"}) {
		t.Fatal(dirs, ok)
	}
	if got := d.Infos(); len(got) != 1 || got[0] != MsgNotRLFolder {
		t.Fatalf("infos %q", got)
	}
}

// Steam and Epic both installed: both are returned so both get patched.
func TestFindRLReturnsEveryInstall(t *testing.T) {
	d := &fakeDialogs{folders: []string{"/should/not/ask"}}
	exists := existsSet(filepath.Join("/steam/rl", "TAGame", "Config"), filepath.Join("/epic/rl", "TAGame", "Config"))
	dirs, ok := FindRL([]string{"/steam/rl", "/missing", "/epic/rl", "/steam/rl/"}, exists, d, true)
	if !ok || !reflect.DeepEqual(dirs, []string{"/steam/rl", "/epic/rl"}) {
		t.Fatal(dirs, ok)
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

// onceSet is an in-memory Once.
type onceSet struct {
	mu   sync.Mutex
	seen map[string]bool
}

func (o *onceSet) Once(k string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.seen == nil {
		o.seen = map[string]bool{}
	}
	if o.seen[k] {
		return false
	}
	o.seen[k] = true
	return true
}

func (o *onceSet) Forget(k string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	delete(o.seen, k)
}

func iniDeps(m *memFS, running bool) IniDeps {
	return IniDeps{FS: m, RLRunning: func() bool { return running }, Once: (&onceSet{}).Once, Logf: nolog}
}

func msgs(ns []Notice) []string {
	var out []string
	for _, n := range ns {
		out = append(out, n.Msg)
	}
	return out
}

func TestEnableChangedWhileRunningAsksForRestart(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=0\r\n")}}
	changed, ns, _ := EnableStatsAPI("/rl", iniDeps(m, true))
	if !changed || string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=20\r\n" {
		t.Fatalf("ini %q", m.files[defaultIni])
	}
	if len(ns) != 1 || ns[0].Msg != MsgRestartRL || ns[0].Key != "" {
		t.Fatalf("notices %+v", ns)
	}
}

func TestEnableChangedNotRunningNoNotice(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")}}
	if _, ns, _ := EnableStatsAPI("/rl", iniDeps(m, false)); len(ns) != 0 {
		t.Fatal(ns)
	}
}

func TestEnableUnchangedWhileRunningNoNotice(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n")}}
	if changed, ns, _ := EnableStatsAPI("/rl", iniDeps(m, true)); changed || len(ns) != 0 {
		t.Fatal(changed, ns)
	}
}

func TestEnablePrefersTAStatsAPI(t *testing.T) {
	m := &memFS{files: map[string][]byte{
		defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n"),
		taIni:      []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n"),
	}}
	EnableStatsAPI("/rl", iniDeps(m, false))
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
	d := iniDeps(m, false)
	d.Logf = func(f string, a ...any) { logged = append(logged, f) }
	EnableStatsAPI("/rl", d)
	if string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n" {
		t.Fatal("default ini not patched")
	}
	if len(logged) == 0 {
		t.Fatal("exists error not logged")
	}
}

func TestEnableUnsupportedEncodingGivesOnceNoticeWithNextStep(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: {0xFF, 0xFE, '[', 0}}}
	changed, ns, _ := EnableStatsAPI("/rl", iniDeps(m, true))
	if changed || len(ns) != 1 || ns[0].Key == "" {
		t.Fatalf("notices %+v", ns)
	}
	if !strings.HasPrefix(ns[0].Msg, MsgUnsupportedIni) || !strings.Contains(ns[0].Msg, "PacketSendRate=20") || !strings.Contains(ns[0].Msg, defaultIni) {
		t.Fatalf("msg %q", ns[0].Msg)
	}
	if m.files[defaultIni][0] != 0xFF || len(m.files) != 1 {
		t.Fatal("file must be untouched, no backup")
	}
}

func TestEnableReadErrorGivesOnceNoticeWithNextStep(t *testing.T) {
	m := &memFS{files: map[string][]byte{}}
	_, ns, _ := EnableStatsAPI("/rl", iniDeps(m, true))
	if len(ns) != 1 || ns[0].Key == "" || !strings.Contains(ns[0].Msg, "PacketSendRate=20") || !strings.Contains(ns[0].Msg, defaultIni) {
		t.Fatalf("notices %+v", ns)
	}
}

// deniedFS fails writes with a permission error until unlocked (as if an
// elevated helper patched the file).
type deniedFS struct {
	memFS
	locked bool
}

func (d *deniedFS) WriteFile(p string, b []byte) error {
	if d.locked {
		return &fs.PathError{Op: "open", Path: p, Err: fs.ErrPermission}
	}
	return d.memFS.WriteFile(p, b)
}

func newDenied() *deniedFS {
	return &deniedFS{memFS: memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")}}, locked: true}
}

// elevDeps patches through a fake elevated child, counting calls.
func elevDeps(d *deniedFS, once *onceSet, running bool, fail bool, calls *int) IniDeps {
	return IniDeps{FS: d, RLRunning: func() bool { return running }, Once: once.Once, Forget: once.Forget, Logf: nolog,
		Elevate: func(path string) error {
			*calls++
			if fail {
				return errors.New("cancelled by user")
			}
			d.locked = false
			_, err := statsini.Apply(path, d) // what the elevated --patch-ini child does
			d.locked = true
			return err
		}}
}

// The UAC prompt never runs inside EnableStatsAPI (startup must not block on
// it): it comes back as a deferred step whose notices follow it (final
// review I4).
func TestEnableAccessDeniedDefersElevationThenSucceeds(t *testing.T) {
	d := newDenied()
	calls := 0
	changed, ns, elev := EnableStatsAPI("/rl", elevDeps(d, &onceSet{}, true, false, &calls))
	if changed || len(ns) != 0 || calls != 0 || elev == nil {
		t.Fatalf("changed=%v notices %+v calls %d elev=%v", changed, ns, calls, elev != nil)
	}
	changed, ns = elev()
	if calls != 1 || !changed || len(ns) != 1 || ns[0].Msg != MsgRestartRL {
		t.Fatalf("calls %d changed=%v notices %+v", calls, changed, ns)
	}
	if string(d.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n" {
		t.Fatal("not patched")
	}
}

func TestEnableAccessDeniedElevationDeclinedGivesAdminNotice(t *testing.T) {
	d := newDenied()
	once := &onceSet{}
	calls := 0
	deps := elevDeps(d, once, false, true, &calls)
	_, _, elev := EnableStatsAPI("/rl", deps)
	changed, ns := elev()
	if changed || len(ns) != 1 || ns[0].Msg != NeedsAdminMsg(defaultIni) || ns[0].Key == "" {
		t.Fatalf("changed=%v notices %+v", changed, ns)
	}
	want := "Rocket League's settings file needs permission to change. Right-click RLGoalTracker and choose Run as administrator once, or set PacketSendRate=20 in " + defaultIni + " yourself."
	if NeedsAdminMsg(defaultIni) != want {
		t.Fatal(NeedsAdminMsg(defaultIni))
	}
	// Next boot, same file: no second UAC prompt, same (once-keyed) notice.
	_, ns2, elev2 := EnableStatsAPI("/rl", deps)
	if elev2 != nil || calls != 1 {
		t.Fatalf("second prompt offered (calls %d)", calls)
	}
	if len(ns2) != 1 || ns2[0].Key != ns[0].Key {
		t.Fatalf("notices %+v", ns2)
	}
}

// A Rocket League update or file verify that resets a patched ini must not
// silently stop tracking: one more elevation is allowed (final review I5).
func TestEnableRevertedAfterElevatedPatchElevatesAgain(t *testing.T) {
	d := newDenied()
	orig := append([]byte(nil), d.files[defaultIni]...)
	once := &onceSet{}
	calls := 0
	deps := elevDeps(d, once, true, false, &calls)
	_, _, elev := EnableStatsAPI("/rl", deps)
	elev()
	d.files[defaultIni] = append([]byte(nil), orig...) // RL update put the old file back
	_, ns, elev := EnableStatsAPI("/rl", deps)
	if elev == nil || len(ns) != 0 {
		t.Fatalf("no new elevation after revert: notices %+v", ns)
	}
	if _, ns = elev(); calls != 2 || len(ns) != 1 || ns[0].Msg != MsgRestartRL {
		t.Fatalf("calls %d notices %+v", calls, ns)
	}
}

// A declined prompt is not repeated for the same file, but a file whose
// contents changed since (an RL update) gets a fresh attempt and notice.
func TestEnableDeclinedThenFileChangedElevatesAgain(t *testing.T) {
	d := newDenied()
	once := &onceSet{}
	calls := 0
	deps := elevDeps(d, once, false, true, &calls)
	_, _, elev := EnableStatsAPI("/rl", deps)
	_, first := elev()
	d.files[defaultIni] = []byte("; updated by Rocket League\n[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")
	_, _, elev = EnableStatsAPI("/rl", deps)
	if elev == nil {
		t.Fatal("changed file must allow another elevation")
	}
	_, second := elev()
	if calls != 2 || len(second) != 1 || second[0].Key == first[0].Key {
		t.Fatalf("calls %d: want a fresh notice key, got %q then %q", calls, first[0].Key, second[0].Key)
	}
}

func TestEnableAccessDeniedWithoutElevator(t *testing.T) {
	d := newDenied()
	deps := IniDeps{FS: d, RLRunning: func() bool { return false }, Once: (&onceSet{}).Once, Logf: nolog}
	_, ns, elev := EnableStatsAPI("/rl", deps)
	if elev != nil || len(ns) != 1 || ns[0].Msg != NeedsAdminMsg(defaultIni) {
		t.Fatalf("notices %+v", ns)
	}
}

// RunElevations runs each deferred elevation and shows its notices right
// after it, in order (the tray is already up when this runs).
func TestRunElevationsShowsNoticesAfterEach(t *testing.T) {
	var log []string
	elevs := []Elevation{
		func() (bool, []Notice) { log = append(log, "elevate a"); return true, []Notice{{Msg: "A"}} },
		func() (bool, []Notice) { log = append(log, "elevate b"); return false, []Notice{{Key: "k", Msg: "B"}} },
	}
	once := &onceSet{}
	show := func(m string) { log = append(log, "show "+m) }
	RunElevations(elevs, once.Once, show, nolog)
	if strings.Join(log, ",") != "elevate a,show A,elevate b,show B" {
		t.Fatal(log)
	}
}

func TestShowNoticesOnceKeyed(t *testing.T) {
	once := &onceSet{}
	var shown []string
	show := func(m string) { shown = append(shown, m) }
	ns := []Notice{{Key: "a", Msg: "A"}, {Msg: "always"}}
	ShowNotices(ns, once.Once, show, nolog)
	ShowNotices(ns, once.Once, show, nolog)
	if strings.Join(shown, ",") != "A,always,always" {
		t.Fatal(shown)
	}
}

func TestFirstRunNotice(t *testing.T) {
	if n := FirstRunNotice(true); n.Msg != "RL Goal Tracker is running in your tray. Goals will log automatically while you play." || n.Key == "" {
		t.Fatal(n)
	}
	n := FirstRunNotice(false)
	if !strings.HasPrefix(n.Msg, "Couldn't find Rocket League.") || !strings.Contains(n.Msg, "Find Rocket League") || n.Key == "" {
		t.Fatal(n)
	}
}

func TestStartMode(t *testing.T) {
	if StartMode("k", nil) != ModePaired {
		t.Fatal("paired")
	}
	if StartMode("", nil) != ModeFirstRun {
		t.Fatal("first run")
	}
	if StartMode("", errors.New("cred manager broken")) != ModeKeyError {
		t.Fatal("key error must not be treated as unpaired")
	}
}

var _ statsini.FS = (*memFS)(nil)

func TestPatchIniExitCodes(t *testing.T) {
	m := &memFS{files: map[string][]byte{defaultIni: []byte("[TAGame.MatchStatsExporter_TA]\nPacketSendRate=0\n")}}
	if c := PatchIni(defaultIni, m); c != 0 {
		t.Fatal(c)
	}
	if string(m.files[defaultIni]) != "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n" {
		t.Fatal("not patched")
	}
	if c := PatchIni(filepath.Join(cfgDir, "Engine.ini"), m); c != PatchBadPath {
		t.Fatal("non-StatsAPI ini must be refused", c)
	}
	if c := PatchIni("relative/DefaultStatsAPI.ini", m); c != PatchBadPath {
		t.Fatal("relative path must be refused", c)
	}
	if c := PatchIni(taIni, m); c != PatchFailed {
		t.Fatal("missing file must fail", c)
	}
}

func TestMsgAlreadyRunningCopy(t *testing.T) {
	if MsgAlreadyRunning != "RL Goal Tracker is already running in your tray." {
		t.Fatal(MsgAlreadyRunning)
	}
}
