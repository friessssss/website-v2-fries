package statsapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

const fixtureGUID = "234796F811F1D691EDF14A9138FAFC7A"

var fixedNow = time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)

func newTestParser() *Parser { return &Parser{Now: func() time.Time { return fixedNow }} }

func fixtureMessages(t *testing.T) []json.RawMessage {
	t.Helper()
	b, err := os.ReadFile("../../testdata/match-tcp.bin")
	if err != nil {
		t.Fatal(err)
	}
	next := splitJSON(bytes.NewReader(b))
	var out []json.RawMessage
	for {
		raw, err := next()
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			t.Fatalf("split after %d messages: %v", len(out), err)
		}
		out = append(out, raw)
	}
}

func feedAll(p *Parser, msgs []json.RawMessage) []model.Event {
	var evs []model.Event
	for _, m := range msgs {
		evs = append(evs, p.Feed(m)...)
	}
	return evs
}

// envelope builds a Stats API message with double-encoded Data, as RL sends it.
func envelope(event string, data any) json.RawMessage {
	d, _ := json.Marshal(data)
	b, _ := json.Marshal(map[string]any{"Event": event, "Data": string(d)})
	return b
}

func ref(name string, team int) *model.PlayerRef { return &model.PlayerRef{Name: name, Team: team} }

func TestFixtureEvents(t *testing.T) {
	msgs := fixtureMessages(t)
	if len(msgs) != 314 {
		t.Fatalf("split %d messages, want 314", len(msgs))
	}
	p := newTestParser()
	if p.InMatch() {
		t.Fatal("InMatch before any message")
	}
	var evs []model.Event
	sawInMatch := false
	for _, m := range msgs {
		evs = append(evs, p.Feed(m)...)
		if len(evs) > 0 && evs[len(evs)-1].Kind != "match_end" && p.InMatch() {
			sawInMatch = true
		}
	}
	if !sawInMatch {
		t.Fatal("InMatch never true during the match")
	}
	if p.InMatch() {
		t.Fatal("InMatch still true after MatchEnded/MatchDestroyed")
	}

	gt := func(v float64) *float64 { return &v }
	want := []model.Event{
		{Kind: "match_start", Players: []model.PlayerRef{{Name: "Fries", Team: 1}, {Name: "OppPlayer1", Team: 0}}},
		// Goals carry the clock frozen after the goal (first reading after it).
		{Kind: "goal", GameTime: gt(288), Scorer: ref("OppPlayer1", 0)},
		{Kind: "goal", GameTime: gt(242), Scorer: ref("OppPlayer1", 0)},
		{Kind: "save", GameTime: gt(191), Player: ref("Fries", 1)},
		{Kind: "goal", GameTime: gt(156), Scorer: ref("Fries", 1)},
		{Kind: "demo", GameTime: gt(110), Attacker: ref("Fries", 1), Victim: ref("OppPlayer1", 0)},
		{Kind: "match_end", Score: map[string]int{"0": 2, "1": 1}},
	}
	for i := range want {
		want[i].MatchGUID = fixtureGUID
		want[i].At = fixedNow
	}
	if !reflect.DeepEqual(evs, want) {
		got, _ := json.MarshalIndent(evs, "", " ")
		t.Fatalf("events:\n%s", got)
	}
	for _, e := range evs {
		if e.Kind == "goal" && e.Assister != nil {
			t.Fatalf("goal has an assister: %+v", e)
		}
	}

	// The same stream again through the same Parser: nothing new.
	if again := feedAll(p, msgs); len(again) != 0 {
		t.Fatalf("second pass emitted %d events: %+v", len(again), again)
	}
}

func TestNewGUIDResetsDedupe(t *testing.T) {
	msgs := fixtureMessages(t)
	p := newTestParser()
	first := feedAll(p, msgs)
	var second []json.RawMessage
	for _, m := range msgs {
		second = append(second, json.RawMessage(strings.ReplaceAll(string(m), fixtureGUID, "NEWGUID")))
	}
	evs := feedAll(p, second)
	if len(evs) != len(first) || evs[0].Kind != "match_start" || evs[0].MatchGUID != "NEWGUID" {
		t.Fatalf("new match: %+v", evs)
	}
	for i := range evs {
		if evs[i].MatchGUID != "NEWGUID" || evs[i].Kind != first[i].Kind {
			t.Fatalf("event %d: %+v", i, evs[i])
		}
	}
}

func updateState(guid string, clock float64, replay bool, players ...model.PlayerRef) json.RawMessage {
	ps := []map[string]any{}
	for _, pl := range players {
		ps = append(ps, map[string]any{"Name": pl.Name, "TeamNum": pl.Team})
	}
	return envelope("UpdateState", map[string]any{
		"MatchGuid": guid, "Players": ps,
		"Game": map[string]any{
			"Teams":       []map[string]any{{"Name": "Blue", "TeamNum": 0, "Score": 0}, {"Name": "Orange", "TeamNum": 1, "Score": 0}},
			"TimeSeconds": clock, "bOvertime": false, "bReplay": replay,
		},
	})
}

func goalScored(guid, name string, team int) json.RawMessage {
	return envelope("GoalScored", map[string]any{"MatchGuid": guid, "GoalTime": 12, "Scorer": map[string]any{"Name": name, "Shortcut": 1, "TeamNum": team}})
}

func statfeed(guid, name string, main map[string]any, secondary map[string]any) json.RawMessage {
	d := map[string]any{"MatchGuid": guid, "EventName": name, "Type": name, "MainTarget": main}
	if secondary != nil {
		d["SecondaryTarget"] = secondary
	}
	return envelope("StatfeedEvent", d)
}

func kinds(evs []model.Event) []string {
	var k []string
	for _, e := range evs {
		k = append(k, e.Kind)
	}
	return k
}

func startedParser(t *testing.T) *Parser {
	t.Helper()
	p := newTestParser()
	p.Feed(envelope("MatchInitialized", map[string]any{"MatchGuid": "G"}))
	evs := p.Feed(updateState("G", 250, false, model.PlayerRef{Name: "A", Team: 0}, model.PlayerRef{Name: "B", Team: 1}))
	if !reflect.DeepEqual(kinds(evs), []string{"match_start"}) {
		t.Fatalf("start: %+v", evs)
	}
	return p
}

func TestRepeatedMessagesSentOnce(t *testing.T) {
	p := startedParser(t)
	goal := goalScored("G", "A", 0)
	save := statfeed("G", "Save", map[string]any{"Name": "B", "TeamNum": 1}, nil)
	frozen := updateState("G", 249, false)
	var evs []model.Event
	for i := 0; i < 3; i++ {
		evs = append(evs, p.Feed(goal)...)
		evs = append(evs, p.Feed(save)...)
	}
	for i := 0; i < 2; i++ {
		evs = append(evs, p.Feed(frozen)...)
		evs = append(evs, p.Feed(goal)...)
		evs = append(evs, p.Feed(frozen)...)
	}
	if !reflect.DeepEqual(kinds(evs), []string{"save", "goal"}) || *evs[1].GameTime != 249 {
		t.Fatalf("got %+v", evs)
	}
	// The same player saving again at a different clock is a new event.
	p.Feed(updateState("G", 240, false, model.PlayerRef{Name: "A", Team: 0}, model.PlayerRef{Name: "B", Team: 1}))
	if evs := p.Feed(save); !reflect.DeepEqual(kinds(evs), []string{"save"}) || *evs[0].GameTime != 240 {
		t.Fatalf("later save: %+v", evs)
	}
}

func TestReplayGoalsIgnored(t *testing.T) {
	p := startedParser(t)
	if evs := p.Feed(goalScored("G", "", 0)); len(evs) != 0 {
		t.Fatalf("empty scorer: %+v", evs)
	}
	p.Feed(envelope("GoalReplayStart", map[string]any{"MatchGuid": "G"}))
	if evs := p.Feed(goalScored("G", "A", 0)); len(evs) != 0 {
		t.Fatalf("during GoalReplayStart: %+v", evs)
	}
	p.Feed(envelope("GoalReplayEnd", map[string]any{"MatchGuid": "G"}))
	p.Feed(updateState("G", 250, true))
	if evs := p.Feed(goalScored("G", "A", 0)); len(evs) != 0 {
		t.Fatalf("during bReplay: %+v", evs)
	}
	p.Feed(updateState("G", 250, false))
	if evs := p.Feed(goalScored("G", "A", 0)); len(evs) != 0 {
		t.Fatalf("goal before the next clock reading: %+v", evs)
	}
	if evs := p.Feed(updateState("G", 249, false)); !reflect.DeepEqual(kinds(evs), []string{"goal"}) {
		t.Fatalf("live goal: %+v", evs)
	}
}

func TestStatfeedMapping(t *testing.T) {
	p := startedParser(t)
	evs := p.Feed(statfeed("G", "Assist", map[string]any{"Name": "A"}, nil)) // no TeamNum: from the team map
	if len(evs) != 1 || evs[0].Kind != "assist" || !reflect.DeepEqual(evs[0].Player, ref("A", 0)) {
		t.Fatalf("assist: %+v", evs)
	}
	evs = p.Feed(statfeed("G", "EpicSave", map[string]any{"Name": "B", "TeamNum": 1}, nil))
	if len(evs) != 1 || evs[0].Kind != "save" || !reflect.DeepEqual(evs[0].Player, ref("B", 1)) {
		t.Fatalf("epic save: %+v", evs)
	}
	evs = p.Feed(statfeed("G", "Demolish", map[string]any{"Name": "B"}, map[string]any{"Name": "A", "TeamNum": 0}))
	if len(evs) != 1 || evs[0].Kind != "demo" || evs[0].Attacker == nil || evs[0].Victim == nil ||
		*evs[0].Attacker != *ref("B", 1) || *evs[0].Victim != *ref("A", 0) {
		t.Fatalf("demo: %+v", evs)
	}
	for _, name := range []string{"Goal", "Shot", "Win", "BicycleHit", "LongGoal"} {
		if evs := p.Feed(statfeed("G", name, map[string]any{"Name": "A", "TeamNum": 0}, nil)); len(evs) != 0 {
			t.Fatalf("%s: %+v", name, evs)
		}
	}
}

func TestOvertimeClock(t *testing.T) {
	p := startedParser(t)
	p.Feed(envelope("UpdateState", map[string]any{"MatchGuid": "G", "Players": []any{},
		"Game": map[string]any{"TimeSeconds": 12, "bOvertime": true}}))
	p.Feed(goalScored("G", "A", 0))
	evs := p.Feed(envelope("ClockUpdatedSeconds", map[string]any{"MatchGuid": "G", "TimeSeconds": 13})) // no bOvertime: stays in overtime
	if len(evs) != 1 || *evs[0].GameTime != 10013 {
		t.Fatalf("overtime goal: %+v", evs)
	}
}

func TestMatchStartWaitsForLiveMatch(t *testing.T) {
	p := newTestParser()
	// Lobby: one player, clock not running, no lifecycle event yet.
	if evs := p.Feed(updateState("G", 300, false, model.PlayerRef{Name: "A", Team: 0})); len(evs) != 0 {
		t.Fatalf("lobby: %+v", evs)
	}
	// Joined mid-match: the clock moving starts the match.
	evs := p.Feed(updateState("G", 299, false, model.PlayerRef{Name: "A", Team: 0}, model.PlayerRef{Name: "B", Team: 1}))
	if len(evs) != 1 || evs[0].Kind != "match_start" || len(evs[0].Players) != 2 || !p.InMatch() {
		t.Fatalf("mid-match: %+v", evs)
	}

	// A stat before any match_start forces the match_start first.
	q := newTestParser()
	q.Feed(updateState("H", 300, false, model.PlayerRef{Name: "A", Team: 0}))
	q.Feed(goalScored("H", "A", 0))
	evs = q.Feed(updateState("H", 300, false, model.PlayerRef{Name: "A", Team: 0}))
	if !reflect.DeepEqual(kinds(evs), []string{"match_start", "goal"}) {
		t.Fatalf("forced start: %+v", evs)
	}
}

func TestMalformedMessagesIgnored(t *testing.T) {
	p := newTestParser()
	for _, m := range []string{`{}`, `not json`, `{"Event":"UpdateState","Data":"{bad"}`, `{"Event":"PlayerLeft","Data":"{\"MatchGuid\":\"\"}"}`} {
		if evs := p.Feed(json.RawMessage(m)); len(evs) != 0 {
			t.Fatalf("%s: %+v", m, evs)
		}
	}
	// Data as a plain object (not double-encoded) is also accepted.
	p.Feed(json.RawMessage(`{"Event":"MatchInitialized","Data":{"MatchGuid":"G"}}`))
	evs := p.Feed(json.RawMessage(`{"Event":"UpdateState","Data":{"MatchGuid":"G","Players":[{"Name":"A","TeamNum":0}],"Game":{"TimeSeconds":300}}}`))
	if len(evs) != 1 || evs[0].Kind != "match_start" {
		t.Fatalf("object data: %+v", evs)
	}
}

// sampled keeps only the UpdateStates with index%2 == phase, like two helpers
// whose 20 Hz samples land at different moments.
func sampled(msgs []json.RawMessage, phase int) []json.RawMessage {
	var out []json.RawMessage
	k := 0
	for _, m := range msgs {
		if strings.Contains(string(m), `"Event":"UpdateState"`) {
			k++
			if k%2 != phase {
				continue
			}
		}
		out = append(out, m)
	}
	return out
}

func goalTimes(evs []model.Event) []float64 {
	var ts []float64
	for _, e := range evs {
		if e.Kind == "goal" {
			ts = append(ts, *e.GameTime)
		}
	}
	return ts
}

func TestGoalGameTimeSameAcrossHelpers(t *testing.T) {
	msgs := fixtureMessages(t)
	a := goalTimes(feedAll(newTestParser(), sampled(msgs, 0)))
	b := goalTimes(feedAll(newTestParser(), sampled(msgs, 1)))
	if !reflect.DeepEqual(a, []float64{288, 242, 156}) || !reflect.DeepEqual(a, b) {
		t.Fatalf("phase 0 %v, phase 1 %v", a, b)
	}

	// Synthetic: one helper saw the 101 sample before the goal, the other
	// only 102; both stamp the frozen post-goal clock.
	pl := []model.PlayerRef{{Name: "A", Team: 0}, {Name: "B", Team: 1}}
	run := func(before []float64) []float64 {
		p := startedParser(t)
		for _, c := range before {
			p.Feed(updateState("G", c, false, pl...))
		}
		var evs []model.Event
		evs = append(evs, p.Feed(goalScored("G", "A", 0))...)
		evs = append(evs, p.Feed(updateState("G", 101, false, pl...))...)
		evs = append(evs, p.Feed(updateState("G", 101, true, pl...))...)
		return goalTimes(evs)
	}
	if x, y := run([]float64{103, 102, 101}), run([]float64{103, 102}); !reflect.DeepEqual(x, []float64{101}) || !reflect.DeepEqual(x, y) {
		t.Fatalf("%v vs %v", x, y)
	}
}

func TestBufferedGoalFlushedAtMatchEndAndNewGUID(t *testing.T) {
	p := startedParser(t)
	p.Feed(goalScored("G", "A", 0))
	evs := p.Feed(envelope("MatchEnded", map[string]any{"MatchGuid": "G", "WinnerTeamNum": 0}))
	if !reflect.DeepEqual(kinds(evs), []string{"goal", "match_end"}) || *evs[0].GameTime != 250 {
		t.Fatalf("match ended: %+v", evs)
	}

	p = startedParser(t)
	p.Feed(goalScored("G", "B", 1))
	evs = p.Feed(envelope("MatchDestroyed", map[string]any{"MatchGuid": "G"}))
	if !reflect.DeepEqual(kinds(evs), []string{"goal"}) || p.InMatch() {
		t.Fatalf("match destroyed: %+v", evs)
	}

	p = startedParser(t)
	p.Feed(goalScored("G", "A", 0))
	evs = p.Feed(envelope("MatchCreated", map[string]any{"MatchGuid": "H"}))
	if !reflect.DeepEqual(kinds(evs), []string{"goal"}) || evs[0].MatchGUID != "G" || *evs[0].GameTime != 250 {
		t.Fatalf("new guid: %+v", evs)
	}
}

func TestClockUpdatedSecondsOvertime(t *testing.T) {
	p := startedParser(t)
	clock := func(d map[string]any) {
		d["MatchGuid"] = "G"
		p.Feed(envelope("ClockUpdatedSeconds", d))
	}
	clock(map[string]any{"TimeSeconds": 5, "bOvertime": true})
	clock(map[string]any{"TimeSeconds": 6}) // bOvertime absent: unchanged
	evs := p.Feed(statfeed("G", "Save", map[string]any{"Name": "A", "TeamNum": 0}, nil))
	if len(evs) != 1 || *evs[0].GameTime != 10006 {
		t.Fatalf("overtime kept: %+v", evs)
	}
	clock(map[string]any{"TimeSeconds": 7, "bOvertime": false})
	evs = p.Feed(statfeed("G", "Save", map[string]any{"Name": "A", "TeamNum": 0}, nil))
	if len(evs) != 1 || *evs[0].GameTime != 7 {
		t.Fatalf("overtime cleared: %+v", evs)
	}
}

func TestFlushReturnsBufferedGoalOnce(t *testing.T) {
	p := startedParser(t)
	if evs := p.Flush(); len(evs) != 0 {
		t.Fatalf("nothing buffered: %+v", evs)
	}
	p.Feed(goalScored("G", "A", 0))
	evs := p.Flush()
	if len(evs) != 1 || evs[0].Kind != "goal" || *evs[0].GameTime != 250 || evs[0].MatchGUID != "G" {
		t.Fatalf("flush: %+v", evs)
	}
	if evs := p.Flush(); len(evs) != 0 {
		t.Fatalf("second flush: %+v", evs)
	}
	var _ app.Flusher = p
}

// songParser is a started parser whose song source returns *cur and counts calls.
func songParser(t *testing.T, cur **model.Song, calls *int) *Parser {
	t.Helper()
	p := startedParser(t)
	p.Song = func() *model.Song { *calls++; return *cur }
	return p
}

func TestGoalCarriesSongFromGoalScoredArrival(t *testing.T) {
	a, b := model.LocalSong("Uprising", "Muse"), model.LocalSong("Starlight", "Muse")
	cur, calls := a, 0
	p := songParser(t, &cur, &calls)
	pl := []model.PlayerRef{{Name: "A", Team: 0}, {Name: "B", Team: 1}}

	p.Feed(goalScored("G", "A", 0))
	cur = b // the track changes before the clock reading flushes the goal
	evs := p.Feed(updateState("G", 101, false, pl...))
	if len(evs) != 1 || evs[0].Kind != "goal" || evs[0].Song != a {
		t.Fatalf("goal song: %+v", evs)
	}

	// Same for a goal flushed at match end, by Flush and by a new guid.
	cur = a
	p.Feed(goalScored("G", "B", 1))
	cur = b
	evs = p.Feed(envelope("MatchEnded", map[string]any{"MatchGuid": "G", "WinnerTeamNum": 1}))
	if evs[0].Kind != "goal" || evs[0].Song != a || evs[1].Kind != "match_end" || evs[1].Song != nil {
		t.Fatalf("match end flush: %+v", evs)
	}

	p = songParser(t, &cur, &calls)
	cur = a
	p.Feed(goalScored("G", "A", 0))
	cur = b
	if evs := p.Flush(); len(evs) != 1 || evs[0].Song != a {
		t.Fatalf("Flush: %+v", evs)
	}

	p = songParser(t, &cur, &calls)
	cur = a
	p.Feed(goalScored("G", "A", 0))
	cur = b
	if evs := p.Feed(envelope("MatchCreated", map[string]any{"MatchGuid": "H"})); len(evs) != 1 || evs[0].Song != a {
		t.Fatalf("new guid flush: %+v", evs)
	}
}

func TestStatEventsCarrySong(t *testing.T) {
	s := model.LocalSong("Uprising", "Muse")
	cur, calls := s, 0
	p := songParser(t, &cur, &calls)
	a := map[string]any{"Name": "A", "TeamNum": 0}
	b := map[string]any{"Name": "B", "TeamNum": 1}
	var evs []model.Event
	evs = append(evs, p.Feed(statfeed("G", "Assist", a, nil))...)
	evs = append(evs, p.Feed(statfeed("G", "Save", a, nil))...)
	evs = append(evs, p.Feed(statfeed("G", "EpicSave", b, nil))...)
	evs = append(evs, p.Feed(statfeed("G", "Demolish", a, b))...)
	if !reflect.DeepEqual(kinds(evs), []string{"assist", "save", "save", "demo"}) {
		t.Fatalf("kinds %v", kinds(evs))
	}
	for _, e := range evs {
		if e.Song != s {
			t.Fatalf("%s song %+v", e.Kind, e.Song)
		}
	}

	cur = nil // nothing playing
	p.Feed(envelope("ClockUpdatedSeconds", map[string]any{"MatchGuid": "G", "TimeSeconds": 200}))
	evs = p.Feed(statfeed("G", "Save", b, nil))
	if len(evs) != 1 || evs[0].Song != nil {
		t.Fatalf("nothing playing: %+v", evs)
	}
}

func TestSongReadOnlyForStatMessages(t *testing.T) {
	cur, calls := model.LocalSong("Uprising", "Muse"), 0
	p := songParser(t, &cur, &calls)
	pl := []model.PlayerRef{{Name: "A", Team: 0}, {Name: "B", Team: 1}}
	for c := 250.0; c > 240; c-- {
		p.Feed(updateState("G", c, false, pl...)) // clock ticks must not hit the media source
	}
	p.Feed(statfeed("G", "Shot", map[string]any{"Name": "A", "TeamNum": 0}, nil))
	p.Feed(envelope("GoalReplayStart", map[string]any{"MatchGuid": "G"}))
	p.Feed(goalScored("G", "", 0)) // replay repeat
	p.Feed(envelope("GoalReplayEnd", map[string]any{"MatchGuid": "G"}))
	if calls != 0 {
		t.Fatalf("song read %d times for non-stat messages", calls)
	}
	evs := p.Feed(envelope("MatchEnded", map[string]any{"MatchGuid": "G", "WinnerTeamNum": 0}))
	if len(evs) != 1 || evs[0].Song != nil || calls != 0 {
		t.Fatalf("match_end: %+v (calls %d)", evs, calls)
	}
}

func TestNoSongSourceMeansNoSong(t *testing.T) {
	p := startedParser(t) // Song is nil, as in --replay
	p.Feed(goalScored("G", "A", 0))
	evs := p.Flush()
	evs = append(evs, p.Feed(statfeed("G", "Save", map[string]any{"Name": "A", "TeamNum": 0}, nil))...)
	for _, e := range evs {
		if e.Song != nil {
			t.Fatalf("%s song %+v", e.Kind, e.Song)
		}
	}
	if NewSongParser(nil).(*Parser).Song != nil {
		t.Fatal("NewSongParser(nil) set a song source")
	}
	if NewParser().(*Parser).Song != nil {
		t.Fatal("NewParser set a song source")
	}
}
