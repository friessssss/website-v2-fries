package statsapi

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

// overtimeBase is added to the overtime clock (which counts up from 0) so an
// overtime gameTime never collides with a regulation one.
const overtimeBase = 10000

// Parser turns Stats API messages into helper events. It is stateful and
// not safe for concurrent use (app serialises Feed and InMatch).
//
// Wire format (testdata/README.md): each message is
// {"Event": "<Name>", "Data": "<JSON-encoded string>"} and every Data carries
// "MatchGuid".
type Parser struct {
	Now func() time.Time

	guid      string
	live      bool     // a MatchInitialized/CountdownBegin/RoundStarted was seen
	firstTick *float64 // clock of the first UpdateState, to spot a running match
	sentStart bool
	sentEnd   bool
	inMatch   bool
	replay    bool
	haveClock bool
	clock     float64
	overtime  bool
	players   []model.PlayerRef
	teams     map[string]int
	score     map[string]int
	seen      map[string]bool
	// goal waits for the first clock reading after GoalScored: the clock is
	// frozen from the goal until kickoff, so every helper stamps the same value.
	goal *model.Event
}

// NewParser returns a Parser using the wall clock, as an app.Source.
func NewParser() app.Source { return &Parser{Now: time.Now} }

var _ app.Source = (*Parser)(nil)

// InMatch reports whether a match_start was emitted and the match has not
// ended or been destroyed since.
func (p *Parser) InMatch() bool { return p.inMatch }

type wireEnvelope struct {
	Event string          `json:"Event"`
	Data  json.RawMessage `json:"Data"`
}

type target struct {
	Name    string `json:"Name"`
	TeamNum *int   `json:"TeamNum"`
}

type message struct {
	MatchGuid string `json:"MatchGuid"`
	Players   []struct {
		Name    string `json:"Name"`
		TeamNum int    `json:"TeamNum"`
	} `json:"Players"`
	Game *struct {
		Teams []struct {
			TeamNum int `json:"TeamNum"`
			Score   int `json:"Score"`
		} `json:"Teams"`
		TimeSeconds *float64 `json:"TimeSeconds"`
		Overtime    bool     `json:"bOvertime"`
		Replay      bool     `json:"bReplay"`
	} `json:"Game"`
	// ClockUpdatedSeconds (shape assumed; dropped from the fixture).
	TimeSeconds *float64 `json:"TimeSeconds"`
	Overtime    *bool    `json:"bOvertime"`
	// GoalScored
	Scorer *target `json:"Scorer"`
	// StatfeedEvent
	EventName       string  `json:"EventName"`
	MainTarget      *target `json:"MainTarget"`
	SecondaryTarget *target `json:"SecondaryTarget"`
}

// decode unwraps the wireEnvelope; Data is normally a JSON string holding JSON,
// but a plain object is accepted too.
func decode(raw json.RawMessage) (string, *message, bool) {
	var env wireEnvelope
	if json.Unmarshal(raw, &env) != nil || env.Event == "" || len(env.Data) == 0 {
		return "", nil, false
	}
	data := []byte(env.Data)
	if data[0] == '"' {
		var s string
		if json.Unmarshal(data, &s) != nil {
			return "", nil, false
		}
		data = []byte(s)
	}
	var m message
	if json.Unmarshal(data, &m) != nil {
		return "", nil, false
	}
	return env.Event, &m, true
}

func (p *Parser) reset(guid string) {
	*p = Parser{Now: p.Now, guid: guid, teams: map[string]int{}, seen: map[string]bool{}}
}

// Feed parses one message and returns the events it produces (often none).
func (p *Parser) Feed(raw json.RawMessage) []model.Event {
	name, m, ok := decode(raw)
	if !ok || m.MatchGuid == "" {
		return nil
	}
	var out []model.Event
	if m.MatchGuid != p.guid {
		out = p.flushGoal(out)
		p.reset(m.MatchGuid) // new match (or RL restarted): fresh dedupe set
	}
	switch name {
	case "UpdateState":
		clocked := p.updateState(m)
		out = p.maybeStart(out)
		if clocked {
			out = p.flushGoal(out)
		}
	case "ClockUpdatedSeconds":
		if m.TimeSeconds != nil {
			p.clock, p.haveClock = *m.TimeSeconds, true
			if m.Overtime != nil {
				p.overtime = *m.Overtime
			}
			out = p.flushGoal(out)
		}
	case "MatchInitialized", "CountdownBegin", "RoundStarted":
		p.live = true
		if name != "MatchInitialized" {
			p.replay = false
		}
		out = p.maybeStart(out)
	case "GoalReplayStart":
		p.replay = true
	case "GoalReplayEnd":
		p.replay = false
	case "GoalScored":
		// RL repeats GoalScored during the replay with an empty scorer.
		if p.replay || m.Scorer == nil || m.Scorer.Name == "" {
			break
		}
		if p.goal != nil && p.goal.Scorer.Name == m.Scorer.Name {
			break // repeated before any clock reading
		}
		out = p.flushGoal(out)
		p.goal = &model.Event{Kind: "goal", Scorer: p.ref(m.Scorer)}
	case "StatfeedEvent":
		if m.MainTarget == nil || m.MainTarget.Name == "" {
			break
		}
		switch m.EventName {
		case "Assist":
			out = p.stat(out, model.Event{Kind: "assist", Player: p.ref(m.MainTarget)})
		case "Save", "EpicSave":
			out = p.stat(out, model.Event{Kind: "save", Player: p.ref(m.MainTarget)})
		case "Demolish":
			if m.SecondaryTarget == nil || m.SecondaryTarget.Name == "" {
				break
			}
			out = p.stat(out, model.Event{Kind: "demo", Attacker: p.ref(m.MainTarget), Victim: p.ref(m.SecondaryTarget)})
		}
		// Goal comes from GoalScored; Shot, Win, LongGoal etc. are ignored.
	case "MatchEnded":
		out = p.flushGoal(out)
		if !p.sentEnd {
			out = p.ensureStart(out)
			p.sentEnd = true
			score := map[string]int{"0": 0, "1": 0}
			for k, v := range p.score {
				score[k] = v
			}
			out = append(out, p.event(model.Event{Kind: "match_end", Score: score}))
		}
		p.inMatch = false
	case "MatchDestroyed":
		out = p.flushGoal(out)
		p.inMatch = false
	}
	return out
}

// flushGoal emits a buffered goal stamped with the current clock.
func (p *Parser) flushGoal(out []model.Event) []model.Event {
	if p.goal == nil {
		return out
	}
	e := *p.goal
	p.goal = nil
	return p.stat(out, e)
}

// updateState records roster, scores and clock; it reports whether the
// message carried a clock reading.
func (p *Parser) updateState(m *message) bool {
	if len(m.Players) > 0 {
		p.players = p.players[:0]
		for _, pl := range m.Players {
			if pl.Name == "" {
				continue
			}
			p.players = append(p.players, model.PlayerRef{Name: pl.Name, Team: pl.TeamNum})
			p.teams[pl.Name] = pl.TeamNum
		}
	}
	g := m.Game
	if g == nil {
		return false
	}
	p.replay = g.Replay
	if len(g.Teams) > 0 {
		p.score = map[string]int{}
		for _, t := range g.Teams {
			p.score[fmt.Sprint(t.TeamNum)] = t.Score
		}
	}
	if g.TimeSeconds != nil {
		p.clock, p.overtime, p.haveClock = *g.TimeSeconds, g.Overtime, true
		if p.firstTick == nil {
			v := p.clock
			p.firstTick = &v
		} else if *p.firstTick != p.clock || p.overtime {
			p.live = true // the clock is running: we joined mid-match
		}
	}
	return g.TimeSeconds != nil
}

// maybeStart emits match_start once the match is live and players are known,
// so the lobby's partial roster (before the opponent loads) is not sent.
func (p *Parser) maybeStart(out []model.Event) []model.Event {
	if p.live {
		return p.ensureStart(out)
	}
	return out
}

func (p *Parser) ensureStart(out []model.Event) []model.Event {
	if p.sentStart || p.sentEnd || len(p.players) == 0 {
		return out
	}
	p.sentStart, p.inMatch = true, true
	players := append([]model.PlayerRef(nil), p.players...)
	return append(out, p.event(model.Event{Kind: "match_start", Players: players}))
}

// stat stamps a stat event with the game clock and drops repeats of the same
// (kind, clock, names) within this match.
func (p *Parser) stat(out []model.Event, e model.Event) []model.Event {
	gt := p.gameTime()
	var names []string
	for _, r := range []*model.PlayerRef{e.Scorer, e.Player, e.Attacker, e.Victim} {
		if r != nil {
			names = append(names, r.Name)
		}
	}
	key := fmt.Sprintf("%s|%.1f|%s", e.Kind, gt, strings.Join(names, "|"))
	if p.seen[key] {
		return out
	}
	p.seen[key] = true
	out = p.ensureStart(out)
	e.GameTime = &gt
	return append(out, p.event(e))
}

// gameTime is the integer match clock from UpdateState; overtime is offset so
// it never collides with regulation. Every helper in a lobby sees the same
// value, so the server can dedupe across them. 0 if no clock was seen yet.
func (p *Parser) gameTime() float64 {
	if !p.haveClock {
		return 0
	}
	if p.overtime {
		return overtimeBase + p.clock
	}
	return p.clock
}

func (p *Parser) event(e model.Event) model.Event {
	e.MatchGUID = p.guid
	now := p.Now
	if now == nil {
		now = time.Now
	}
	e.At = now()
	return e
}

// ref uses the target's own TeamNum when it is a real team (0 or 1), else
// the team from the latest UpdateState.
func (p *Parser) ref(t *target) *model.PlayerRef {
	r := &model.PlayerRef{Name: t.Name}
	if t.TeamNum != nil && (*t.TeamNum == 0 || *t.TeamNum == 1) {
		r.Team = *t.TeamNum
	} else if team, ok := p.teams[t.Name]; ok {
		r.Team = team
	} else if t.TeamNum != nil {
		r.Team = *t.TeamNum
	}
	return r
}
