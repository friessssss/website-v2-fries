# RL Tracker Helper (Windows) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `RLGoalTracker.exe`, a Windows tray app that friends download and run once. It pairs with a 6-character code, finds Rocket League, turns on the Stats API, starts on login, and streams goals, assists, saves, demos, heartbeats and match start/end to `/api/rl/v1/events`.

**Architecture:** A Go module in `helper/`. Pure packages hold all logic and are tested on any OS: protocol sniffing, message parsing, ini patching, path discovery from file contents, the queue, and the API client. Windows-only packages are thin adapters behind interfaces, behind `//go:build windows`: credential storage, registry, tray, toasts and the dialog. `main.go` wires them together. GitHub Actions builds and releases on `helper-v*` tags.

**Tech Stack:** Go 1.24. `github.com/coder/websocket`, `fyne.io/systray`, `github.com/ncruces/zenity` (pairing and folder dialogs), `github.com/danieljoos/wincred`, `golang.org/x/sys/windows/registry`, `git.sr.ht/~jackmordaunt/go-toast/v2`. No cgo.

**Spec:** `docs/superpowers/specs/2026-11-02-rl-tracker-automation-design.md` (§8 helper, §7 `POST /events` body). Server side: `docs/superpowers/plans/2026-11-02-rl-tracker-site.md`, Tasks 4, 6, 7 and 10, which must be deployed before the end-to-end check in Task 9.

## Global Constraints

- Stats API: `127.0.0.1:49123` (TCP JSON or WebSocket, sniffed). Also try a WebSocket on `49124`. Reconnect every 5 s.
- Ini: `TAGame/Config/TAStatsAPI.ini` if present, otherwise `DefaultStatsAPI.ini`. Section `[TAGame.MatchStatsExporter_TA]`, `PacketSendRate=20`. Backup `<name>.rltracker.bak`, created once.
- Install dir `%LOCALAPPDATA%\RLGoalTracker\`. Run key `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\RLGoalTracker`. No admin rights.
- Key stored in Windows Credential Manager, target `RLGoalTracker/apiKey`.
- Queue file `queue.jsonl` in the install dir. Flush every 2 s, batches ≤ 50. Backoff doubles from 2 s to a 60 s maximum. On 401, stop and show the re-pair state.
- Heartbeat every 30 s while a match is active.
- Self-update check on start and every 12 h via `GET /api/rl/v1/helper/latest`.
- Pairing label: `<USERNAME>@<COMPUTERNAME>`.
- Server base URL: compile-time `-X main.baseURL=https://zachrobertson.co`. `--base-url` flag for local testing.
- Copy matches the site: plain, no emoji. Toast text: `"{Display} scored · {Song}"`, using the song from the server response when present, otherwise `"{Display} scored"`.
- Commit messages end with the session's attribution lines.

## Review Focus

- **Rocket League restarted mid-session, or a new match in the same lobby** → the connection drops and resumes, and the new match GUID starts a fresh local dedupe set. Test in Task 3 (parser state reset on GUID change) and Task 5 (reconnect loop).
- **The game repeats the same statfeed message** (same type, player and game time) → sent once. Test in Task 3.
- **Ini already has `PacketSendRate=0`, or other keys and comments** → set to 20, everything else byte-for-byte unchanged, and running it twice changes nothing. Test in Task 4.
- **The PC is offline for a whole match** → events stay in the queue across an app restart and upload later with their original `at`. The server marks them late. Test in Task 5.
- **A Steam library on a second drive, or a path with spaces or unicode** → found. Test in Task 4 with a `libraryfolders.vdf` fixture that has two libraries.

---

## File Structure

```
helper/
  go.mod                          module github.com/friessssss/website-v2-fries/helper
  main.go                         wiring, flags, run loop
  cmd/rlcapture/main.go           spike: raw stream recorder
  internal/model/model.go         Event types sent to the server (spec §7)
  internal/statsapi/conn.go       dial + sniff TCP vs WebSocket → message stream
  internal/statsapi/parse.go      raw JSON → model.Event (stateful per match)
  internal/statsini/statsini.go   ini choose + patch
  internal/rlpath/rlpath.go       Steam vdf / Epic dat parsing → candidate dirs
  internal/queue/queue.go         persistent JSONL queue
  internal/api/client.go          pair, post events, latest version
  internal/app/app.go             orchestration (OS-agnostic, depends on interfaces)
  internal/winsys/*.go            //go:build windows: creds, registry, install, dialogs, tray, toast, update swap
  testdata/                       captured streams + vdf/dat/ini fixtures
.github/workflows/helper-release.yml
```

---

### Task 1: Spike: capture real Stats API output

**Files:** Create `helper/go.mod`, `helper/cmd/rlcapture/main.go`, `helper/testdata/README.md`.

**Interfaces:**
- Produces:
  - `rlcapture.exe [-port 49123] [-out capture-<timestamp>.bin]`. It connects over TCP, writes every received byte unchanged to the output file and also prints it to stdout, then reconnects every 5 s until Ctrl+C.
  - With `-ws`, it instead dials `ws://127.0.0.1:<port>` and writes each message followed by `\n\x1e\n`.
  - Built with `GOOS=windows GOARCH=amd64 go build ./cmd/rlcapture`.

- [ ] **Step 1: Write `rlcapture`** (standard library plus `coder/websocket`). Verify it builds: `cd helper && GOOS=windows go build ./cmd/rlcapture`.
- [ ] **Step 2: Capture (Zach, on the gaming PC).**
  1. Set `PacketSendRate=20` in the RL ini by hand and restart RL.
  2. Run `rlcapture.exe` and play one online match. Score, assist, save and demo if possible.
  3. Run `rlcapture.exe -port 49124 -ws` for a second short capture.
  4. Commit both files to `helper/testdata/` as `match-tcp.bin` and `match-ws.bin`.
  5. Also note in `testdata/README.md` which ini file RL used, and whether 49123 answered as a WebSocket.
- [ ] **Step 3: Spotify Jam check (Zach).** While a friend hosts a Jam, open `https://developer.spotify.com` console "Get Currently Playing Track" with Zach's account as a guest, and record in `testdata/README.md` whether `is_playing` and `item` are populated.
- [ ] **Step 4: Write `testdata/README.md`:**
  - The observed message envelope (field names for event name, data, match GUID, players and teams).
  - The exact names for goal, statfeed (Assist, Save, Demolish), match created/started, match ended, and the periodic update.
  - The findings from Steps 2 and 3.
- [ ] **Step 5: Commit** `spike(helper): capture tool and recorded Stats API streams`.

**Gate:** Tasks 3 and 9 use these captures. If anything contradicts the spec (for example, no team on goal events), note it in the README and adjust Task 3's parser. The server contract in spec §7 doesn't change.

---

### Task 2: Event model and API client

**Files:** Create `helper/internal/model/model.go`, `helper/internal/api/client.go`, `helper/internal/api/client_test.go`

**Interfaces:**
- Produces:
  - `model.PlayerRef{Name string; Team int}`
  - `model.Event{Kind string; MatchGUID string; At time.Time; GameTime *float64; Scorer, Assister, Player, Attacker, Victim *PlayerRef; Players []PlayerRef; Score map[string]int}`, with JSON tags exactly as in spec §7 (`kind`, `matchGuid`, `at`, `gameTime`, `scorer`, `assister`, `player`, `attacker`, `victim`, `players`, `score`) and `omitempty`.
  - `api.Client{BaseURL string; Key string; HTTP *http.Client; Version string}`
  - `(*Client) Pair(ctx, code, label string) (string, error)`. On 400 it returns `ErrCodeExpired`.
  - `(*Client) PostEvents(ctx, events []model.Event, sentAt time.Time) ([]api.Result, error)`. It returns `ErrUnauthorized` on 401, `ErrRetryable` on network errors, 429 or 5xx, and `ErrRejected{Status, Body}` on other 4xx.
  - `api.Result{Status string; ID string; Song string; ActorDisplay string}`, matching the site plan's `IngestResult` (`status`, `id`, `song`, `actorDisplay`).
  - `(*Client) Latest(ctx) (version, url string, err error)`

- [ ] **Step 1: Failing tests** with `httptest.Server`:
  - `PostEvents` sends `Authorization: Bearer k`, a body with `helperVersion`, `sentAt` and `events[0].kind == "goal"`, and `gameTime` serialised as a number.
  - 401 → `ErrUnauthorized`. 503 → `ErrRetryable`.
  - `Pair` 400 → `ErrCodeExpired`.
- [ ] **Step 2: Run** `cd helper && go test ./internal/api/...`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(helper): event model and site API client`.

---

### Task 3: Stats API connection and parser

**Files:** Create `helper/internal/statsapi/conn.go`, `parse.go`, `conn_test.go`, `parse_test.go`

**Interfaces:**
- Consumes: `model` (T2), captures (T1).
- Produces:
  - `statsapi.Dial(ctx, host string, ports []int) (Stream, error)`. Tries each port. On TCP connect, it reads the first bytes with a 1 s deadline: if they start with `{`, it's raw JSON; otherwise it closes and retries the same port as a WebSocket. `Stream` interface: `Next(ctx) (json.RawMessage, error)`.
  - `splitJSON(r io.Reader) func() (json.RawMessage, error)` splits concatenated or newline-separated JSON objects with `json.Decoder`.
  - `statsapi.Parser{Now func() time.Time}` with `(*Parser) Feed(raw json.RawMessage) []model.Event`. It's stateful:
    - It tracks the current match GUID, and `Players` with teams from the periodic update.
    - It emits `match_start` once per new GUID, carrying the players.
    - It maps the goal message → `goal` (with an assister when present), statfeed Assist/Save/Demolish → `assist`/`save`/`demo` (demo attacker = main target, victim = secondary), and match ended → `match_end` with the team scores.
    - It drops repeats with the same (kind, gameTime rounded to 0.1, names) within a match, and resets that set on a GUID change.
    - It fills a missing `team` from the tracked player list.
    - Field names come from `testdata/README.md` (Task 1).
  - `(*Parser) InMatch() bool` (true between match_start and match_end), used by the heartbeat ticker.

- [ ] **Step 1: Failing tests:**
  - `parse_test`: feeding `testdata/match-tcp.bin` through `splitJSON` and the `Parser` yields exactly one `match_start`, one `match_end`, and goal/assist/save/demo counts equal to the numbers recorded in `testdata/README.md`.
  - Feeding the same goal message twice yields one event.
  - A new GUID resets dedupe and emits a new `match_start`.
  - A demo has a non-nil `Attacker` and `Victim`.
  - `conn_test`: a local TCP server writing two concatenated JSON objects gives two messages. A local WebSocket server (coder/websocket) gives two messages through the same `Dial`.
- [ ] **Step 2: Run** `go test ./internal/statsapi/...`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(helper): Stats API connection sniffing and event parser`.

---

### Task 4: Finding Rocket League and enabling the Stats API

**Files:** Create `helper/internal/rlpath/rlpath.go`, `rlpath_test.go`, `helper/internal/statsini/statsini.go`, `statsini_test.go`. Fixtures: `testdata/libraryfolders.vdf` (two libraries, one `D:\\Spiele Bibliothek\\Steam`), `testdata/LauncherInstalled.dat` (an entry with `"AppName": "Sugar"`), and `testdata/ini/*.ini`.

**Interfaces:**
- Produces:
  - `rlpath.SteamLibraries(vdf []byte) []string`
  - `rlpath.EpicInstall(dat []byte) (string, bool)`
  - `rlpath.Candidates(steamRoot string, readFile func(string) ([]byte, error)) []string`. Order: each Steam library + `steamapps/common/rocketleague`, then the Epic install, then `C:/Program Files/Epic Games/rocketleague`, then `C:/Program Files (x86)/Steam/steamapps/common/rocketleague`.
  - `rlpath.Find(cands []string, exists func(string) bool) (string, bool)` returns the first candidate containing `TAGame/Config`.
  - `statsini.Choose(rlDir string, exists func(string) bool) string`
  - `statsini.Patch(content []byte) (out []byte, changed bool)` sets `PacketSendRate=20` inside `[TAGame.MatchStatsExporter_TA]`. It adds the key if it's missing, adds the section at the end if that's missing, preserves CRLF/LF style, and leaves every other line identical.
  - `statsini.Apply(path string, fs FS) (changed bool, err error)`. Writes `path + ".rltracker.bak"` only if it doesn't already exist, then writes the patched content. `FS` is an interface `{ReadFile; WriteFile; Exists}` so tests use a map.

- [ ] **Step 1: Failing tests:**
  - The vdf fixture → two paths, including the one with a space.
  - The dat fixture → the Epic path.
  - `Patch` on `PacketSendRate=0` with CRLF and comments → only that line changes, and the line endings stay CRLF.
  - A second `Patch` returns `changed=false`.
  - A file without the section gets it appended.
  - `Apply` twice creates the backup once, with the original content.
- [ ] **Step 2: Run** `go test ./internal/rlpath/... ./internal/statsini/...`. Expected: FAIL.
- [ ] **Step 3: Implement.** Parse the vdf with a small tokenizer for `"key" "value"` pairs, collecting `path` values. Parse the dat with `encoding/json` (`InstallationList[].{AppName,InstallLocation}`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(helper): find Rocket League and enable the Stats API ini`.

---

### Task 5: Persistent queue and app orchestration

**Files:** Create `helper/internal/queue/queue.go`, `queue_test.go`, `helper/internal/app/app.go`, `app_test.go`

**Interfaces:**
- Consumes: `api.Client` (T2), `statsapi.Dial/Parser` (T3).
- Produces:
  - `queue.Open(path string) (*Queue, error)`, `(*Queue) Push(evs ...model.Event) error` (append plus fsync), `(*Queue) Peek(n int) []model.Event`, `(*Queue) Drop(n int) error` (rewrites the file atomically via a temp file and rename), `(*Queue) Len() int`.
  - `app.State` enum: `Idle` (RL not running), `Connected`, `Queued` (offline with a backlog), `NeedsPair`, `Paused`.
  - `app.Deps{Dial func(ctx) (statsapi.Stream, error); Poster interface{PostEvents(...)}; Queue *queue.Queue; Now func() time.Time; Sleep func(ctx, d) error; OnState func(State); OnGoal func(display, song string)}`
  - `app.Run(ctx, deps) error` runs three loops:
    1. **Reader:** dial with a 5 s retry, feed the parser, push its events to the queue.
    2. **Heartbeat:** every 30 s while `InMatch()`, push a `heartbeat` event.
    3. **Flusher:** every 2 s, peek up to 50 and post them. On success, drop them and call `OnGoal(result.ActorDisplay, result.Song)` for recorded `goal` events whose actor is a roster player (`ActorDisplay` not `Opponent`/`Teammate`). On `ErrRetryable`, back off 2 s→60 s and set `Queued`. On `ErrUnauthorized`, set `NeedsPair` and stop flushing until `Resume()`. On `ErrRejected`, drop the batch and log it (one bad event must not block the queue forever).
  - `(*App) Pause()`, `Resume()`.

- [ ] **Step 1: Failing tests** with fakes and a fake clock:
  - Queue: push 3, reopen the file, `Len()==3`. Drop 2, reopen, the one left is the third.
  - App: a fake stream yields a goal, and the fake poster receives it within one flush tick.
  - The poster fails with `ErrRetryable` 3 times → the state goes to `Queued`, then the event is delivered, and the backoff sleeps are 2 s, 4 s, 8 s.
  - `ErrUnauthorized` → `NeedsPair` and no more posts.
  - The stream returns EOF → redial after 5 s.
  - Heartbeats are pushed only while in a match.
- [ ] **Step 2: Run** `go test ./internal/queue/... ./internal/app/...`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** with `go test -race`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(helper): persistent queue and run loop`.

---

### Task 6: Windows adapters: credentials, install, dialogs, tray, toasts

**Files:** Create under `helper/internal/winsys/` (all `//go:build windows`): `creds.go`, `install.go`, `dialog.go`, `tray.go`, `toast.go`, plus `icons/` (16×16 and 32×32 `.ico` in grey, lime, amber and red, each a pixel "R" in the ZR mark style, embedded with `//go:embed`). Create `helper/internal/winsys/winsys_stub.go` (`//go:build !windows`, no-op implementations so `go vet ./...` passes on Linux CI).

**Interfaces:**
- Produces:
  - `LoadKey() (string, error)`, `SaveKey(k string) error`, `DeleteKey() error` (wincred, target `RLGoalTracker/apiKey`)
  - `InstallSelf() (exePath string, err error)` copies the running exe to the install dir if it's not already running from there, and sets the Run key.
  - `AskPairingCode() (string, bool)`. A zenity entry dialog titled "RL Goal Tracker" with the text "Enter the code from zachrobertson.co/RLTracker/settings".
  - `AskRLFolder() (string, bool)` (zenity directory picker)
  - `Info(msg string)` (zenity info)
  - `Tray{OnOpen, OnTogglePause, OnToggleToasts, OnRepair, OnQuit func()}` with `Run()` and `SetState(app.State, statusText string)`. The menu items are: the status line (disabled), "Open tracker", "Toasts on/off", "Pause tracking", "Re-pair", "Quit".
  - `Toast(title, body string)`

- [ ] **Step 1: Verify cross-compile:** `cd helper && GOOS=windows go vet ./... && go vet ./...`. Expected: both pass after the stubs exist. (These adapters wrap OS APIs; there's no unit test, and they're exercised in Task 9.)
- [ ] **Step 2: Implement the adapters.**
- [ ] **Step 3: Verify again** with `GOOS=windows go build ./...`. Expected: success.
- [ ] **Step 4: Commit** `feat(helper): Windows credential, install, dialog, tray and toast adapters`.

---

### Task 7: Main wiring, first-run flow and self-update

**Files:** Create `helper/main.go`, `helper/internal/update/update.go`, `update_test.go`. Create `helper/internal/winsys/update_swap.go`.

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `main`. Flags: `--base-url`, `--version`, `--reset` (deletes the key and exits). The flow is:
    1. Single-instance guard: a named mutex `Global\RLGoalTracker`. If it's already held, exit silently.
    2. Finish any pending update swap (Task 7 update).
    3. If there's no key: loop `AskPairingCode` → `Pair`. On `ErrCodeExpired`, show "That code expired. Get a new one in Settings." and ask again. Cancel → exit.
    4. Find RL via `rlpath`. If it's not found, call `AskRLFolder`. Then `statsini.Apply`. If changed and `RocketLeague.exe` is running (`tasklist` check through `golang.org/x/sys/windows` process snapshot), call `Info("Restart Rocket League once to start tracking.")`.
    5. `InstallSelf`.
    6. Start `app.Run`, connect `OnState` → `Tray.SetState` and `OnGoal` → `Toast`. "Re-pair" → `DeleteKey`, `AskPairingCode`, `Pair`, `Resume`.
    7. Start the update ticker.
  - `update.Newer(current, latest string) bool` (semver compare of `vX.Y.Z` with the `helper-v` prefix stripped)
  - `update.Download(ctx, url, dest string) error` (to `RLGoalTracker.new.exe`)
  - `winsys.SwapIfPending()`: on start, if `RLGoalTracker.new.exe` exists next to the exe, rename the current one to `.old.exe`, rename the new one into place, relaunch, and exit. The `.old.exe` is deleted on the next start.

- [ ] **Step 1: Failing tests:** `Newer("1.0.0","helper-v1.0.1")==true`, `Newer("1.2.0","helper-v1.10.0")==true`, `Newer("1.0.0","helper-v1.0.0")==false`. `Download` from an `httptest` server writes the exact bytes.
- [ ] **Step 2: Run** `go test ./internal/update/...`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `go test ./... && GOOS=windows go build -ldflags "-H windowsgui -X main.version=0.0.0-dev -X main.baseURL=https://zachrobertson.co" -o RLGoalTracker.exe .`. Expected: PASS and the exe is produced.
- [ ] **Step 5: Commit** `feat(helper): first-run flow, tray wiring and self-update`.

---

### Task 8: Release workflow

**Files:** Create `.github/workflows/helper-release.yml`

**Interfaces:**
- Produces: on `push: tags: ['helper-v*']`, a job on `ubuntu-latest` that:
  1. Uses `actions/setup-go@v5` with go `1.24`.
  2. Runs `cd helper && go test ./...`.
  3. Builds `GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H windowsgui -X main.version=${TAG#helper-v} -X main.baseURL=https://zachrobertson.co" -o RLGoalTracker.exe .`.
  4. Runs `softprops/action-gh-release@v2` with `files: helper/RLGoalTracker.exe`. Needs `permissions: contents: write`.
  - Also runs `go test` on pull requests that touch `helper/**` (a separate `on: pull_request: paths`).

- [ ] **Step 1: Write the workflow.**
- [ ] **Step 2: Verify the syntax locally:** `npx --yes action-validator .github/workflows/helper-release.yml` (or `actionlint` if available). Expected: no errors.
- [ ] **Step 3: Commit** `ci(helper): build and release RLGoalTracker.exe on helper-v tags`.
- [ ] **Step 4 (Zach, after merge):** push tag `helper-v1.0.0`. Expected: a Release with `RLGoalTracker.exe`, and `GET /api/rl/v1/helper/latest` returns it.

---

### Task 9: End-to-end acceptance (manual)

- [ ] **Step 1: Replay test.** Add a `--replay testdata/match-tcp.bin` flag to `main` that feeds a capture through the parser and queue against `--base-url http://localhost:3000`, with no RL needed. Run it against the site's `npm run rl:seed` plus `npm run dev`, using a key from Settings. Expected:
  - The tracker shows the captured goals, assists, saves and demos once each.
  - Running the replay a second time adds nothing (dedupe).
  - `/analytics` Fun stats count the demos.
  - Commit with `test(helper): capture replay mode`.
- [ ] **Step 2: Real match (Zach plus one friend).** Both install from the Release on clean PCs and time the setup: under 2 minutes, with one SmartScreen prompt. Play one online match with the Jam running. Check:
  - Every goal, assist, save and demo appears once, with the correct friend and song.
  - The match result and victory song are recorded.
  - Pulling the network for a goal, then reconnecting, uploads it marked as sent late.
- [ ] **Step 3: Record the results** in the final report: anything that differed from the spec, and any follow-ups.
