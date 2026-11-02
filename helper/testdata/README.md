# Stats API capture notes (fill in after capturing)

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
