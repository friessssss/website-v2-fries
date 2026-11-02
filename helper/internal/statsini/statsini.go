// Package statsini turns on the Rocket League Stats API by patching its ini.
package statsini

import (
	"bytes"
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

// FS is the file access Apply needs.
type FS interface {
	ReadFile(path string) ([]byte, error)
	WriteFile(path string, data []byte) error
	Exists(path string) bool
}

// OSFS is the real filesystem.
type OSFS struct{}

func (OSFS) ReadFile(p string) ([]byte, error)  { return os.ReadFile(p) }
func (OSFS) WriteFile(p string, b []byte) error { return os.WriteFile(p, b, 0o644) }
func (OSFS) Exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

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

// Patch sets PacketSendRate=20 in [TAGame.MatchStatsExporter_TA], leaving all
// other bytes untouched. changed is false when nothing needed to change.
func Patch(content []byte) (out []byte, changed bool) {
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
			inSection = strings.EqualFold(t, section)
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

// Apply patches the ini at path. The original is saved to path+".rltracker.bak"
// only if no backup exists yet. Nothing is written when no change is needed.
func Apply(path string, fs FS) (changed bool, err error) {
	orig, err := fs.ReadFile(path)
	if err != nil {
		return false, err
	}
	patched, changed := Patch(orig)
	if !changed {
		return false, nil
	}
	if bak := path + bakExt; !fs.Exists(bak) {
		if err := fs.WriteFile(bak, orig); err != nil {
			return false, err
		}
	}
	if err := fs.WriteFile(path, patched); err != nil {
		return false, err
	}
	return true, nil
}
