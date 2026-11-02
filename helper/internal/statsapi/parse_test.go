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
		{Kind: "goal", GameTime: gt(288), Scorer: ref("OppPlayer1", 0)},
		{Kind: "goal", GameTime: gt(243), Scorer: ref("OppPlayer1", 0)},
		{Kind: "save", GameTime: gt(191), Player: ref("Fries", 1)},
		{Kind: "goal", GameTime: gt(157), Scorer: ref("Fries", 1)},
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
	var evs []model.Event
	for i := 0; i < 3; i++ {
		evs = append(evs, p.Feed(goal)...)
		evs = append(evs, p.Feed(save)...)
	}
	if !reflect.DeepEqual(kinds(evs), []string{"goal", "save"}) {
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
	if evs := p.Feed(goalScored("G", "A", 0)); !reflect.DeepEqual(kinds(evs), []string{"goal"}) {
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
	evs := p.Feed(goalScored("G", "A", 0))
	if len(evs) != 1 || *evs[0].GameTime != 10012 {
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
	evs = q.Feed(goalScored("H", "A", 0))
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
