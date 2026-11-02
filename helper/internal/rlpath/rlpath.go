// Package rlpath locates a Rocket League install from Steam and Epic metadata.
package rlpath

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

const (
	epicDatPath     = "C:/ProgramData/Epic/UnrealEngineLauncher/LauncherInstalled.dat"
	epicDefault     = "C:/Program Files/Epic Games/rocketleague"
	steamDefault    = "C:/Program Files (x86)/Steam/steamapps/common/rocketleague"
	epicAppName     = "Sugar"
	steamRelative   = "steamapps/common/rocketleague"
	libraryFoldsRel = "steamapps/libraryfolders.vdf"
)

type vdfTok struct {
	s     string
	brace byte // '{' or '}' for structural tokens, 0 for strings
}

// tokenize splits Valve KeyValues text into strings and braces. It handles
// escaped characters inside quoted strings and // line comments.
func tokenize(b []byte) []vdfTok {
	var toks []vdfTok
	n := len(b)
	for i := 0; i < n; {
		c := b[i]
		switch {
		case c == '{' || c == '}':
			toks = append(toks, vdfTok{brace: c})
			i++
		case c == '/' && i+1 < n && b[i+1] == '/':
			for i < n && b[i] != '\n' {
				i++
			}
		case c == '"':
			i++
			var sb strings.Builder
			closed := false
			for i < n {
				ch := b[i]
				if ch == '\\' && i+1 < n {
					switch b[i+1] {
					case '\\':
						sb.WriteByte('\\')
					case '"':
						sb.WriteByte('"')
					case 'n':
						sb.WriteByte('\n')
					case 't':
						sb.WriteByte('\t')
					default:
						sb.WriteByte('\\')
						sb.WriteByte(b[i+1])
					}
					i += 2
					continue
				}
				if ch == '"' {
					closed = true
					i++
					break
				}
				sb.WriteByte(ch)
				i++
			}
			if closed {
				toks = append(toks, vdfTok{s: sb.String()})
			}
		default:
			i++
		}
	}
	return toks
}

// SteamLibraries returns every "path" value in a libraryfolders.vdf, in file order.
func SteamLibraries(vdf []byte) []string {
	toks := tokenize(vdf)
	var out []string
	for i := 0; i+1 < len(toks); i++ {
		k, v := toks[i], toks[i+1]
		if k.brace != 0 || v.brace != 0 {
			continue
		}
		if strings.EqualFold(k.s, "path") && v.s != "" {
			out = append(out, v.s)
		}
		i++ // consumed the pair
	}
	return out
}

// EpicInstall returns the install location of Rocket League (AppName "Sugar")
// from Epic's LauncherInstalled.dat.
func EpicInstall(dat []byte) (string, bool) {
	var f struct {
		InstallationList []struct {
			AppName         string
			InstallLocation string
		}
	}
	if err := json.Unmarshal(dat, &f); err != nil {
		return "", false
	}
	for _, e := range f.InstallationList {
		if strings.EqualFold(e.AppName, epicAppName) && e.InstallLocation != "" {
			return e.InstallLocation, true
		}
	}
	return "", false
}

func key(p string) string {
	return strings.ToLower(strings.TrimRight(strings.ReplaceAll(p, `\`, "/"), "/"))
}

// Candidates lists possible Rocket League install dirs, most likely first.
func Candidates(steamRoot string, readFile func(string) ([]byte, error)) []string {
	var out []string
	seen := map[string]bool{}
	add := func(p string) {
		if k := key(p); p != "" && !seen[k] {
			seen[k] = true
			out = append(out, p)
		}
	}
	if steamRoot != "" {
		var libs []string
		if b, err := readFile(filepath.Join(steamRoot, filepath.FromSlash(libraryFoldsRel))); err == nil {
			libs = SteamLibraries(b)
		}
		if len(libs) == 0 {
			libs = []string{steamRoot}
		}
		for _, l := range libs {
			add(filepath.Join(l, filepath.FromSlash(steamRelative)))
		}
	}
	if b, err := readFile(epicDatPath); err == nil {
		if p, ok := EpicInstall(b); ok {
			add(p)
		}
	}
	add(filepath.FromSlash(epicDefault))
	add(filepath.FromSlash(steamDefault))
	return out
}

// Find returns the first candidate that contains TAGame/Config.
func Find(cands []string, exists func(string) bool) (string, bool) {
	for _, c := range cands {
		if exists(filepath.Join(c, "TAGame", "Config")) {
			return c, true
		}
	}
	return "", false
}
