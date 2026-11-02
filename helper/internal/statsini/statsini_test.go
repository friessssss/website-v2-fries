package statsini

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "testdata", "ini", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type memFS map[string][]byte

func (m memFS) ReadFile(p string) ([]byte, error) {
	if b, ok := m[p]; ok {
		return b, nil
	}
	return nil, errors.New("not found")
}
func (m memFS) WriteFile(p string, b []byte) error { m[p] = append([]byte(nil), b...); return nil }
func (m memFS) Exists(p string) (bool, error)      { _, ok := m[p]; return ok, nil }
func (m memFS) Remove(p string) error              { delete(m, p); return nil }
func (m memFS) Rename(from, to string) error {
	b, ok := m[from]
	if !ok {
		return errors.New("rename: missing source")
	}
	m[to] = b
	delete(m, from)
	return nil
}

func TestPatchCRLFZero(t *testing.T) {
	in := fixture(t, "crlf_zero.ini")
	out, changed := Patch(in)
	want := "; keep me\r\n[Other.Section]\r\nFoo=1\r\n\r\n[TAGame.MatchStatsExporter_TA]\r\n; comment\r\nPacketSendRate=20\r\nBar=2\r\n"
	if !changed || string(out) != want {
		t.Fatalf("changed=%v out=%q", changed, out)
	}
	out2, changed2 := Patch(out)
	if changed2 || string(out2) != want {
		t.Fatalf("second patch changed=%v out=%q", changed2, out2)
	}
}

func TestPatchAlready(t *testing.T) {
	in := fixture(t, "already.ini")
	out, changed := Patch(in)
	if changed || string(out) != string(in) {
		t.Fatalf("changed=%v %q", changed, out)
	}
}

func TestPatchNoSection(t *testing.T) {
	out, changed := Patch(fixture(t, "no_section.ini"))
	want := "[Other]\nA=1\n\n[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n"
	if !changed || string(out) != want {
		t.Fatalf("changed=%v %q", changed, out)
	}
	// CRLF, no trailing newline
	out, _ = Patch([]byte("[Other]\r\nA=1"))
	want = "[Other]\r\nA=1\r\n\r\n[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=20\r\n"
	if string(out) != want {
		t.Fatalf("got %q", out)
	}
}

func TestPatchEmpty(t *testing.T) {
	out, changed := Patch(nil)
	if !changed || string(out) != "[TAGame.MatchStatsExporter_TA]\r\nPacketSendRate=20\r\n" {
		t.Fatalf("got %q", out)
	}
}

func TestPatchMissingKey(t *testing.T) {
	out, changed := Patch([]byte("[TAGame.MatchStatsExporter_TA]\nOther=1\n[Next]\nX=2\n"))
	want := "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\nOther=1\n[Next]\nX=2\n"
	if !changed || string(out) != want {
		t.Fatalf("got %q", out)
	}
	// key in another section must not count
	out, _ = Patch([]byte("[TAGame.MatchStatsExporter_TA]\nA=1\n[Next]\nPacketSendRate=0\n"))
	want = "[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\nA=1\n[Next]\nPacketSendRate=0\n"
	if string(out) != want {
		t.Fatalf("got %q", out)
	}
}

func TestPatchTolerance(t *testing.T) {
	in := "\xef\xbb\xbf  [tagame.matchstatsexporter_ta]  \r\n packetsendrate = 0 \r\nZ=1"
	out, changed := Patch([]byte(in))
	want := "\xef\xbb\xbf  [tagame.matchstatsexporter_ta]  \r\nPacketSendRate=20\r\nZ=1"
	if !changed || string(out) != want {
		t.Fatalf("changed=%v %q", changed, out)
	}
	// BOM kept when appending a section
	out, _ = Patch([]byte("\xef\xbb\xbf[A]\nx=1\n"))
	want = "\xef\xbb\xbf[A]\nx=1\n\n[TAGame.MatchStatsExporter_TA]\nPacketSendRate=20\n"
	if string(out) != want {
		t.Fatalf("got %q", out)
	}
}

func TestChoose(t *testing.T) {
	dir := filepath.Join("rl")
	cfg := filepath.Join(dir, "TAGame", "Config")
	ta := filepath.Join(cfg, "TAStatsAPI.ini")
	def := filepath.Join(cfg, "DefaultStatsAPI.ini")
	if got := Choose(dir, func(p string) bool { return p == ta || p == def }); got != ta {
		t.Fatal(got)
	}
	if got := Choose(dir, func(p string) bool { return p == def }); got != def {
		t.Fatal(got)
	}
	if got := Choose(dir, func(string) bool { return false }); got != def {
		t.Fatal(got)
	}
}

func TestApplyTwice(t *testing.T) {
	orig := fixture(t, "crlf_zero.ini")
	fs := memFS{"x.ini": orig}
	changed, err := Apply("x.ini", fs)
	if err != nil || !changed {
		t.Fatalf("%v %v", changed, err)
	}
	patched := append([]byte(nil), fs["x.ini"]...)
	if string(fs["x.ini.rltracker.bak"]) != string(orig) {
		t.Fatal("backup differs from original")
	}
	changed, err = Apply("x.ini", fs)
	if err != nil || changed {
		t.Fatalf("second: %v %v", changed, err)
	}
	if string(fs["x.ini"]) != string(patched) || string(fs["x.ini.rltracker.bak"]) != string(orig) {
		t.Fatal("second apply altered files")
	}
}

func TestApplyNeverOverwritesBackup(t *testing.T) {
	fs := memFS{"x.ini": []byte("[A]\n"), "x.ini.rltracker.bak": []byte("OLD")}
	if _, err := Apply("x.ini", fs); err != nil {
		t.Fatal(err)
	}
	if string(fs["x.ini.rltracker.bak"]) != "OLD" {
		t.Fatal("backup overwritten")
	}
}

func TestApplyMissingFile(t *testing.T) {
	if _, err := Apply("nope.ini", memFS{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestPatchHeaderInlineComment(t *testing.T) {
	out, changed := Patch([]byte("[TAGame.MatchStatsExporter_TA] ; stats\nPacketSendRate=0\n"))
	want := "[TAGame.MatchStatsExporter_TA] ; stats\nPacketSendRate=20\n"
	if !changed || string(out) != want {
		t.Fatalf("got %q", out)
	}
}

func TestPatchUnsupportedEncoding(t *testing.T) {
	for _, in := range [][]byte{
		{0xFF, 0xFE, '[', 0, 'A', 0, ']', 0},
		{0xFE, 0xFF, 0, '[', 0, 'A', 0, ']'},
		[]byte("[A]\nx=\x00\n"),
	} {
		out, changed := Patch(in)
		if changed || string(out) != string(in) {
			t.Fatalf("Patch touched %q", in)
		}
		fs := memFS{"x.ini": in}
		changed, err := Apply("x.ini", fs)
		if !errors.Is(err, ErrUnsupportedEncoding) || changed {
			t.Fatalf("Apply: %v %v", changed, err)
		}
		if len(fs) != 1 || string(fs["x.ini"]) != string(in) {
			t.Fatal("Apply wrote something")
		}
	}
}

type errFS struct {
	memFS
	err error
}

func (e errFS) Exists(string) (bool, error) { return false, e.err }

func TestApplyExistsErrorPropagates(t *testing.T) {
	boom := errors.New("access denied")
	fs := errFS{memFS{"x.ini": []byte("[A]\n")}, boom}
	changed, err := Apply("x.ini", fs)
	if !errors.Is(err, boom) || changed {
		t.Fatalf("%v %v", changed, err)
	}
	if string(fs.memFS["x.ini"]) != "[A]\n" || len(fs.memFS) != 1 {
		t.Fatal("wrote despite error")
	}
}

func TestOSFSAtomicApply(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "TAStatsAPI.ini")
	orig := fixture(t, "crlf_zero.ini")
	if err := os.WriteFile(path, orig, 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := Apply(path, OSFS{})
	if err != nil || !changed {
		t.Fatalf("%v %v", changed, err)
	}
	got, _ := os.ReadFile(path)
	if !strings.Contains(string(got), "PacketSendRate=20\r\n") {
		t.Fatalf("not patched: %q", got)
	}
	bak, err := os.ReadFile(path + ".rltracker.bak")
	if err != nil || string(bak) != string(orig) {
		t.Fatalf("backup: %v %q", err, bak)
	}
	if changed, err = Apply(path, OSFS{}); err != nil || changed {
		t.Fatalf("second: %v %v", changed, err)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("leftover %s", e.Name())
		}
	}
	if len(entries) != 2 {
		t.Fatalf("unexpected files: %v", entries)
	}
	// OSFS.Exists distinguishes absence from success
	if ok, err := (OSFS{}).Exists(filepath.Join(dir, "nope")); ok || err != nil {
		t.Fatalf("exists: %v %v", ok, err)
	}
}
