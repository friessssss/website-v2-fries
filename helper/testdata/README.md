# Stats API capture notes

## How to capture (on the gaming PC)

### 0. Get rlcapture.exe
Install Go from https://go.dev/dl/ . Open the repo's `helper` folder in File Explorer, click the address bar, type `cmd` and press Enter (this opens a terminal in that folder). Run:

    go build -o rlcapture.exe ./cmd/rlcapture

Windows may show a SmartScreen or Defender prompt when you first run `rlcapture.exe`; choose "More info" then "Run anyway". The exe is a local build of the code in this repo.

Run it the same way each time: open a terminal in the folder where you want the files (File Explorer address bar, type `cmd`, Enter). `capture-<timestamp>.bin` files land in the folder you ran it from. Ctrl+C stops it cleanly; it prints `rlcapture: stopped, file flushed: <file>`.

### 1. Enable the Stats API
1. Find the Rocket League config folder:
   - Steam: `C:\Program Files (x86)\Steam\steamapps\common\rocketleague\TAGame\Config\`
   - Epic: `C:\Program Files\Epic Games\rocketleague\TAGame\Config\`
   (Other drive or library: look for `rocketleague\TAGame\Config`.)
2. Use `TAStatsAPI.ini` if it exists, otherwise `DefaultStatsAPI.ini`. Copy the file first as a backup (e.g. `TAStatsAPI.ini.bak`). Note which one you used.
3. Under the section `[TAGame.MatchStatsExporter_TA]` set `PacketSendRate=20`. If the section or the `PacketSendRate` line is missing, add them. You may need to edit as administrator (open Notepad as administrator).
4. Fully quit Rocket League (including the launcher/Epic/Steam overlay game process) and start it again.

### 2. Capture a match over TCP
Run `rlcapture.exe` (port 49123). Until RL is running it prints `waiting for Rocket League`; once in a match it prints `connected (tcp)` and JSON scrolls by. Play one online match: score a goal, and get an assist, a save, and a demo if possible. Press Ctrl+C when done.

### 3. Does 49123 answer as a WebSocket?
During a match (about 10 seconds is enough) run `rlcapture.exe -ws` (default port 49123). Note whether it printed `connected (websocket)` and whether the `.bin` file has data. Ctrl+C to stop.

### 4. WebSocket on 49124
Run `rlcapture.exe -port 49124 -ws -out ws.bin` for about 10 seconds during a match; note whether it connects. Messages in this file are separated by `\n\x1e\n`.

### 5. Hand back the files
Rename the best TCP capture to `match-tcp.bin` and the WebSocket capture to `match-ws.bin`, and put them in `helper/testdata/`. Fill in the Findings sections below. Then either commit and push them to the branch, or send the files to Claude in the chat.

## Findings

From Zach's capture on 2026-11-02 (1v1 casual, raw TCP on 49123). `match-tcp.bin` is trimmed and anonymised from the 10.6 MB original: every non-UpdateState event except BallHit and ClockUpdatedSeconds, plus every 20th UpdateState; PrimaryId and Loadout removed; the opponent renamed "OppPlayer1". Roster player: "Fries" (team 1, Orange).

### Which ini was used
The Stats API ini is read only when Rocket League launches: after editing it, fully restart RL (the port only opens after a restart). This was the cause of the earlier empty captures.

### Did 49123 answer as a WebSocket?
Not needed: 49123 is a raw TCP stream of concatenated JSON objects with no delimiter (`}{`).

### Did 49124 WebSocket connect?
Not tested.

### Observed message envelope / field names
`{"Event": "<Name>", "Data": "<JSON-encoded string>"}`. Data is a string holding JSON (double-encoded). Every Data has `MatchGuid`.

- UpdateState: `{MatchGuid, Players:[{Name, PrimaryId, Shortcut, TeamNum, Score, Goals, Shots, Assists, Saves, Touches, CarTouches, Demos, Loadout, bOnGround, bHasCar, Speed}], Game:{Teams:[{Name, TeamNum, Score, ...}], PlaylistId, TimeSeconds, bOvertime, Ball, bReplay, bHasWinner, Winner, Arena, bHasTarget, Target}}`
- MatchCreated, MatchInitialized, RoundStarted, CountdownBegin, MatchDestroyed: `{MatchGuid}` only.
- PlayerJoined / PlayerLeft: `{MatchGuid, PlayerName, PrimaryId}` (the last PlayerLeft has an empty MatchGuid).
- GoalScored: `{MatchGuid, GoalSpeed, GoalTime, ImpactLocation, Scorer:{Name, Shortcut, TeamNum}, BallLastTouch:{Player:{...}, Speed}}`. No assister.
- StatfeedEvent: `{MatchGuid, EventName, Type, MainTarget:{Name, Shortcut, TeamNum}, SecondaryTarget?}`.
- MatchEnded: `{MatchGuid, WinnerTeamNum}`. No scores.

### Event names
- goal: GoalScored (StatfeedEvent "Goal" also fires; the parser ignores it to avoid double counting)
- statfeed (Assist, Save, Demolish): StatfeedEvent with EventName "Assist", "Save"/"EpicSave", "Demolish" (MainTarget = attacker, SecondaryTarget = victim). Seen in this match: Shot, Goal, BicycleHit, EpicSave, LongGoal, Demolish, Win. Assist and Save were not seen.
- match created / initialized / started: MatchCreated, MatchInitialized, CountdownBegin, RoundStarted
- match ended / destroyed: MatchEnded, MatchDestroyed
- periodic update: UpdateState (team scores, clock `Game.TimeSeconds`, `bOvertime`, `bReplay`)

### Counts of each event in the capture
Full match: UpdateState 5377, ClockUpdatedSeconds 214, BallHit 166, StatfeedEvent 14, GoalScored 6, CountdownBegin 4, RoundStarted 4, GoalReplayStart 3, GoalReplayEnd 3, CrossbarHit 3, PlayerJoined 2, PlayerLeft 2, MatchCreated 1, MatchInitialized 1, GoalReplayWillEnd 1, MatchEnded 1, MatchDestroyed 1. The fixture keeps 268 UpdateState and drops BallHit and ClockUpdatedSeconds (314 messages).

Timeline: goals at clock 288 (OppPlayer1), 242 (OppPlayer1), 156 (Fries); EpicSave by Fries at 190; Demolish Fries -> OppPlayer1 at 109; MatchEnded at clock 88 (opponent left), WinnerTeamNum 0; final score Blue 2, Orange 1. (In the trimmed fixture the save and demo carry the nearest sampled clocks, 191 and 110.)

Expected parser output for the fixture: 1 match_start (Fries t1, OppPlayer1 t0), 3 goals, 1 save (Fries), 1 demo (Fries -> OppPlayer1), 0 assists, 1 match_end with score `{"0":2,"1":1}`.

### Contradictions with the spec
- No assister on GoalScored: goals are sent without one; assists come from StatfeedEvent "Assist".
- GoalScored fires again during each goal replay with an empty scorer name and GoalTime 0 (UpdateState `bReplay` true). The parser ignores GoalScored with no scorer name or during a replay.
- MatchEnded has no scores: match_end takes them from the latest UpdateState `Game.Teams[].Score`.
- gameTime is the UpdateState `Game.TimeSeconds` integer clock, plus 10000 in overtime. Goals are stamped with the first clock reading after GoalScored (the clock is frozen from the goal until kickoff), so every helper in the lobby sends the same value: 288, 242 and 156 in this capture. Saves, assists and demos use the latest clock (the server allows a small tolerance).
- The first UpdateState lists only the local player (the opponent loads later), so match_start waits until the match is live (MatchInitialized, CountdownBegin or RoundStarted, or the clock moving when joining mid-match) and is otherwise sent just before the first stat event.

### Spotify Jam guest check
While a friend hosts a Jam, open the developer.spotify.com console "Get Currently Playing Track" as a guest.
- `is_playing` populated: (not checked yet)
- `item` populated: (not checked yet)
