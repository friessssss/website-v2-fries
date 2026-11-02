// Package winsys wraps Windows-only OS APIs (credentials, install, dialogs,
// tray, toasts); see winsys_stub.go for the non-Windows no-ops.
package winsys

import (
	"path/filepath"
	"strings"
)

// samePath reports whether two Windows paths are the same file location,
// comparing cleaned paths case-insensitively. Empty paths never match.
func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	// filepath.Clean on non-Windows hosts does not treat backslash as a
	// separator, so normalise first to keep this OS-independent.
	norm := func(s string) string {
		return strings.ToLower(filepath.Clean(strings.ReplaceAll(s, `\`, "/")))
	}
	return norm(a) == norm(b)
}

// quoteRunValue returns the Run key value for an exe path.
func quoteRunValue(exe string) string { return `"` + exe + `"` }
