// Command gen writes the tray state icons (.ico, 16x16 and 32x32) deterministically.
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
)

type rgb struct{ r, g, b uint8 }

// Icon set: name -> background colour.
var palette = []struct {
	Name string
	C    rgb
}{
	{"grey", rgb{0x6b, 0x6b, 0x6b}},
	{"lime", rgb{0xc3, 0xff, 0x41}},
	{"amber", rgb{0xf5, 0xa5, 0x24}},
	{"red", rgb{0xef, 0x44, 0x44}},
}

var glyph = rgb{0x0a, 0x0a, 0x0a}

// 5x7 pixel "R".
var rGlyph = [7]string{
	"####.",
	"#...#",
	"#...#",
	"####.",
	"#.#..",
	"#..#.",
	"#...#",
}

// render returns top-down BGRA pixels for a size x size icon.
func render(size int, bg rgb) []byte {
	scale := size / 8 // 16 -> 2, 32 -> 4
	gw, gh := 5*scale, 7*scale
	ox, oy := (size-gw)/2, (size-gh)/2
	px := make([]byte, size*size*4)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			c := bg
			gx, gy := x-ox, y-oy
			if gx >= 0 && gy >= 0 && gx < gw && gy < gh && rGlyph[gy/scale][gx/scale] == '#' {
				c = glyph
			}
			i := (y*size + x) * 4
			px[i], px[i+1], px[i+2], px[i+3] = c.b, c.g, c.r, 0xff
		}
	}
	return px
}

// dib builds the BMP payload of one ICO image (BITMAPINFOHEADER, XOR bottom-up, AND mask).
func dib(size int, bg rgb) []byte {
	px := render(size, bg)
	var b bytes.Buffer
	w := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	w(uint32(40))
	w(int32(size))
	w(int32(size * 2)) // XOR + AND heights
	w(uint16(1))
	w(uint16(32))
	w(uint32(0))
	w(uint32(0))
	w(int32(0))
	w(int32(0))
	w(uint32(0))
	w(uint32(0))
	for y := size - 1; y >= 0; y-- {
		b.Write(px[y*size*4 : (y+1)*size*4])
	}
	maskRow := ((size + 31) / 32) * 4
	b.Write(make([]byte, maskRow*size)) // all opaque
	return b.Bytes()
}

// buildICO returns an .ico containing the given sizes.
func buildICO(bg rgb, sizes ...int) []byte {
	var b bytes.Buffer
	w := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	w(uint16(0))
	w(uint16(1))
	w(uint16(len(sizes)))
	imgs := make([][]byte, len(sizes))
	off := 6 + 16*len(sizes)
	for i, s := range sizes {
		imgs[i] = dib(s, bg)
		b.WriteByte(byte(s))
		b.WriteByte(byte(s))
		b.WriteByte(0)
		b.WriteByte(0)
		w(uint16(1))
		w(uint16(32))
		w(uint32(len(imgs[i])))
		w(uint32(off))
		off += len(imgs[i])
	}
	for _, im := range imgs {
		b.Write(im)
	}
	return b.Bytes()
}

func main() {
	dir := "."
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	for _, p := range palette {
		path := filepath.Join(dir, p.Name+".ico")
		if err := os.WriteFile(path, buildICO(p.C, 16, 32), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}
