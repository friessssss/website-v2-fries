# Stats API capture notes (fill in after capturing)

## How to capture (on the gaming PC)

1. Find the Stats API ini in the Rocket League install folder:
   `<RL install>\TAGame\Config\TAStatsAPI.ini` (if it exists), otherwise `DefaultStatsAPI.ini` in the same folder.
2. In section `[TAGame.MatchStatsExporter_TA]` set `PacketSendRate=20` (by hand). Restart Rocket League.
3. Run `rlcapture.exe` (default port 49123, writes `capture-<timestamp>.bin` in the current directory). Stderr shows connect/disconnect lines; Ctrl+C stops cleanly and flushes the file.
4. Play one online match. Include a goal, an assist, a save, and a demo if possible.
5. Run `rlcapture.exe -port 49124 -ws` briefly for a WebSocket capture (messages are separated by `\n\x1e\n`).
6. Rename the outputs to `match-tcp.bin` and `match-ws.bin` and place them in `helper/testdata/`.

## Findings

### Which ini was used
(TAStatsAPI.ini or DefaultStatsAPI.ini, full path)

### Did 49123 answer as a WebSocket?
(yes/no, what the raw TCP capture looked like)

### Did 49124 WebSocket connect?
(yes/no)

### Observed message envelope / field names
(event name, data, match GUID, players, teams)

### Event names
- goal:
- statfeed (Assist, Save, Demolish):
- match created / initialized / started:
- match ended / destroyed:
- periodic update:

### Counts of each event in the capture
(event name: count)

### Contradictions with the spec
(e.g. no team on goal events; note parser adjustments for Task 3)

### Spotify Jam guest check
While a friend hosts a Jam, open the developer.spotify.com console "Get Currently Playing Track" as a guest.
- `is_playing` populated:
- `item` populated:
