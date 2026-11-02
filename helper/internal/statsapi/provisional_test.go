package statsapi

import (
	"context"
	"errors"
	"testing"
)

func TestProvisionalDialAndParser(t *testing.T) {
	if _, err := Dial(context.Background(), "127.0.0.1", []int{49123}); !errors.Is(err, ErrNotImplemented) {
		t.Fatal(err)
	}
	p := NewParser()
	if p.Feed([]byte(`{}`)) != nil || p.InMatch() {
		t.Fatal("provisional parser must yield nothing")
	}
}
