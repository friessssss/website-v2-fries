package main

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestBuildICO(t *testing.T) {
	for _, p := range palette {
		a := buildICO(p.C, 16, 32)
		if !bytes.Equal(a, buildICO(p.C, 16, 32)) {
			t.Fatalf("%s: not deterministic", p.Name)
		}
		if binary.LittleEndian.Uint16(a[0:]) != 0 || binary.LittleEndian.Uint16(a[2:]) != 1 || binary.LittleEndian.Uint16(a[4:]) != 2 {
			t.Fatalf("%s: bad header", p.Name)
		}
		for i, size := range []int{16, 32} {
			e := a[6+16*i:]
			if int(e[0]) != size || int(e[1]) != size {
				t.Fatalf("%s: entry %d dims %dx%d", p.Name, i, e[0], e[1])
			}
			n := int(binary.LittleEndian.Uint32(e[8:]))
			off := int(binary.LittleEndian.Uint32(e[12:]))
			want := 40 + size*size*4 + ((size+31)/32)*4*size
			if n != want || off+n > len(a) {
				t.Fatalf("%s: entry %d size %d want %d (off %d, len %d)", p.Name, i, n, want, off, len(a))
			}
		}
	}
}

func TestGlyphDrawn(t *testing.T) {
	px := render(32, rgb{1, 2, 3})
	var bgN, fgN int
	for i := 0; i < len(px); i += 4 {
		if px[i] == glyph.b && px[i+1] == glyph.g && px[i+2] == glyph.r {
			fgN++
		} else if px[i] == 3 {
			bgN++
		}
	}
	if fgN == 0 || bgN == 0 {
		t.Fatalf("fg=%d bg=%d", fgN, bgN)
	}
}
