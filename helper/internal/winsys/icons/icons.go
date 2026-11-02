// Package icons embeds the tray state icons (16x16 and 32x32 inside each .ico).
package icons

import _ "embed"

//go:generate go run ./gen .

//go:embed grey.ico
var Grey []byte

//go:embed lime.ico
var Lime []byte

//go:embed amber.ico
var Amber []byte

//go:embed red.ico
var Red []byte
