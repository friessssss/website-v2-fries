// Package statsini turns on the Rocket League Stats API by patching its ini.
package statsini

import (
	"bytes"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const (
	section = "[TAGame.MatchStatsExporter_TA]"
	keyName = "PacketSendRate"
	keyLine = "PacketSendRate=20"
	bakExt  = ".rltracker.bak"
)

var bom = []byte{0xEF, 0xBB, 0xBF}

// ErrUnsupportedEncoding is returned for ini files that are not ASCII/UTF-8
// (for example UTF-16), which Patch cannot edit safely.
var ErrUnsupportedEncoding = errors.New("statsini: unsupported file encoding (UTF-16 or binary)")

// FS is the file access Apply needs.
type FS interface {
	ReadFile(path string) ([]byte, error)
	// WriteFile creates or truncates path, writes data and flushes it to disk.
	WriteFile(path string, data []byte) error
	// Exists reports absence as (false, nil); other failures are returned.
	Exists(path string) (bool, error)
	// Rename moves from over to, replacing it if present.
	Rename(from, to string) error
	Remove(path string) error
}

// OSFS is the real filesystem.
type OSFS struct{}

func (OSFS) ReadFile(p string) ([]byte, error) { return os.ReadFile(p) }

func (OSFS) WriteFile(p string, b []byte) error {
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func (OSFS) Exists(p string) (bool, error) {
	_, err := os.Stat(p)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func (OSFS) Rename(from, to string) error { return os.Rename(from, to) }
func (OSFS) Remove(p string) error        { return os.Remove(p) }

// Choose picks TAStatsAPI.ini when present, otherwise DefaultStatsAPI.ini.
func Choose(rlDir string, exists func(string) bool) string {
	cfg := filepath.Join(rlDir, "TAGame", "Config")
	ta := filepath.Join(cfg, "TAStatsAPI.ini")
	if exists(ta) {
		return ta
	}
	return filepath.Join(cfg, "DefaultStatsAPI.ini")
}

// splitLine returns a line's text and its terminator ("\r\n", "\n" or "").
func splitLine(l string) (text, eol string) {
	switch {
	case strings.HasSuffix(l, "\r\n"):
		return l[:len(l)-2], "\r\n"
	case strings.HasSuffix(l, "\n"):
		return l[:len(l)-1], "\n"
	}
	return l, ""
}

func unsupported(b []byte) bool {
	return bytes.HasPrefix(b, []byte{0xFF, 0xFE}) || bytes.HasPrefix(b, []byte{0xFE, 0xFF}) || bytes.IndexByte(b, 0) >= 0
}

// isTargetHeader reports whether t (a trimmed line starting with "[") is our
// section header, optionally followed by a ; or # comment.
func isTargetHeader(t string) bool {
	end := strings.Index(t, "]")
	if end < 0 || !strings.EqualFold(t[:end+1], section) {
		return false
	}
	rest := strings.TrimSpace(t[end+1:])
	return rest == "" || rest[0] == ';' || rest[0] == '#'
}

// Patch sets PacketSendRate=20 in [TAGame.MatchStatsExporter_TA], leaving all
// other bytes untouched. changed is false when nothing needed to change.
func Patch(content []byte) (out []byte, changed bool) {
	if unsupported(content) {
		return content, false
	}
	hasBOM := bytes.HasPrefix(content, bom)
	body := string(content)
	if hasBOM {
		body = body[len(bom):]
	}
	eol := "\r\n"
	if body != "" {
		if strings.Contains(body, "\r\n") {
			eol = "\r\n"
		} else if strings.Contains(body, "\n") {
			eol = "\n"
		}
	}

	lines := strings.SplitAfter(body, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	inSection, sawSection, sawKey := false, false, false
	headerIdx := -1
	for i, l := range lines {
		text, le := splitLine(l)
		t := strings.TrimSpace(text)
		if strings.HasPrefix(t, "[") {
			inSection = isTargetHeader(t)
			if inSection && !sawSection {
				sawSection = true
				headerIdx = i
			}
			continue
		}
		if !inSection {
			continue
		}
		if k, _, ok := strings.Cut(t, "="); ok && strings.EqualFold(strings.TrimSpace(k), keyName) {
			sawKey = true
			if text != keyLine {
				lines[i] = keyLine + le
				changed = true
			}
		}
	}

	switch {
	case sawSection && !sawKey:
		if _, le := splitLine(lines[headerIdx]); le == "" {
			lines[headerIdx] += eol
		}
		lines = append(lines[:headerIdx+1], append([]string{keyLine + eol}, lines[headerIdx+1:]...)...)
		changed = true
	case !sawSection:
		if n := len(lines); n > 0 {
			if _, le := splitLine(lines[n-1]); le == "" {
				lines[n-1] += eol
			}
			if last, _ := splitLine(lines[len(lines)-1]); strings.TrimSpace(last) != "" {
				lines = append(lines, eol)
			}
		}
		lines = append(lines, section+eol, keyLine+eol)
		changed = true
	}

	res := strings.Join(lines, "")
	if hasBOM {
		return append(append([]byte{}, bom...), res...), changed
	}
	return []byte(res), changed
}

// writeAtomic writes data to a temp file beside path, then renames it over path.
func writeAtomic(fsys FS, path string, data []byte) error {
	tmp := path + ".tmp"
	if err := fsys.WriteFile(tmp, data); err != nil {
		_ = fsys.Remove(tmp)
		return err
	}
	if err := fsys.Rename(tmp, path); err != nil {
		_ = fsys.Remove(tmp)
		return err
	}
	return nil
}

// Apply patches the ini at path. The original is saved to path+".rltracker.bak"
// only if no backup exists yet. Nothing is written when no change is needed or
// the file encoding is unsupported. Writes are atomic (temp file + rename).
func Apply(path string, fsys FS) (changed bool, err error) {
	orig, err := fsys.ReadFile(path)
	if err != nil {
		return false, err
	}
	if unsupported(orig) {
		return false, ErrUnsupportedEncoding
	}
	patched, changed := Patch(orig)
	if !changed {
		return false, nil
	}
	bak := path + bakExt
	have, err := fsys.Exists(bak)
	if err != nil {
		return false, err
	}
	if !have {
		if err := writeAtomic(fsys, bak, orig); err != nil {
			return false, err
		}
	}
	if err := writeAtomic(fsys, path, patched); err != nil {
		return false, err
	}
	return true, nil
}
