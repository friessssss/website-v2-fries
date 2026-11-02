package winsys

import "testing"

func TestSamePath(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{`C:\Users\A\AppData\Local\RLGoalTracker\RLGoalTracker.exe`, `c:\users\a\appdata\local\rlgoaltracker\rlgoaltracker.exe`, true},
		{`C:\x\y\..\z.exe`, `C:\x\z.exe`, true},
		{`C:\x\z.exe`, `C:\x\w.exe`, false},
		{``, ``, false},
	}
	for _, c := range cases {
		if got := samePath(c.a, c.b); got != c.want {
			t.Errorf("samePath(%q,%q)=%v want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestQuoteRunValue(t *testing.T) {
	if got := quoteRunValue(`C:\a b\x.exe`); got != `"C:\a b\x.exe"` {
		t.Fatal(got)
	}
}
