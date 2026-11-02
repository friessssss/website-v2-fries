// Command RLGoalTracker is the Windows tray helper: it pairs with the site,
// turns on the Rocket League Stats API, uploads match events and keeps itself
// up to date. The logic lives in internal/setup and internal/app; this file
// only wires the Windows implementations together.
package main

import (
	"context"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/api"
	"github.com/friessssss/website-v2-fries/helper/internal/app"
	"github.com/friessssss/website-v2-fries/helper/internal/queue"
	"github.com/friessssss/website-v2-fries/helper/internal/rlpath"
	"github.com/friessssss/website-v2-fries/helper/internal/setup"
	"github.com/friessssss/website-v2-fries/helper/internal/statsapi"
	"github.com/friessssss/website-v2-fries/helper/internal/statsini"
	"github.com/friessssss/website-v2-fries/helper/internal/update"
	"github.com/friessssss/website-v2-fries/helper/internal/winsys"
)

// Set at build time with -ldflags "-X main.version=… -X main.baseURL=…".
var (
	version = "0.0.0-dev"
	baseURL = "https://zachrobertson.co"
)

const (
	logMaxBytes      = 1 << 20
	shutdownWait     = 3 * time.Second
	relaunchLockWait = 15 * time.Second
	rlProcess        = "RocketLeague.exe"
)

const (
	msgNoDataDir = "RL Goal Tracker couldn't open its folder in AppData, so it can't start."
)

// dialogs and keyStore adapt winsys functions to the setup interfaces.
type dialogs struct{}

func (dialogs) AskPairingCode() (string, bool) { return winsys.AskPairingCode() }
func (dialogs) AskRLFolder() (string, bool)    { return winsys.AskRLFolder() }
func (dialogs) Info(msg string)                { winsys.Info(msg) }

type keyStore struct{}

func (keyStore) Save(k string) error { return winsys.SaveKey(k) }
func (keyStore) Delete() error       { return winsys.DeleteKey() }

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func main() { os.Exit(run()) }

func run() int {
	base := flag.String("base-url", baseURL, "site base URL (for local testing)")
	ver := flag.String("version", version, "version reported to the site and used for update checks")
	reset := flag.Bool("reset", false, "delete the stored API key and exit")
	relaunched := flag.Bool("relaunched", false, "internal: started by an update or restart")
	flag.Parse()
	args := os.Args[1:]

	if *reset {
		if err := winsys.DeleteKey(); err != nil {
			return 1
		}
		return 0
	}

	// 1. Single instance. A relaunched process waits for its parent to exit.
	wait := time.Duration(0)
	if *relaunched {
		wait = relaunchLockWait
	}
	release, ok, lockErr := winsys.SingleInstance(wait)
	if lockErr == nil && !ok {
		return 0 // already running
	}
	if release == nil {
		release = func() {}
	}
	var releaseOnce sync.Once
	releaseLock := func() { releaseOnce.Do(release) }
	defer releaseLock()

	// 2. Finish a pending update swap.
	swapped, swapErr := winsys.SwapIfPending(args)
	if swapped {
		return 0
	}

	dir, err := winsys.InstallDir()
	if err == nil {
		err = os.MkdirAll(dir, 0o755)
	}
	if err != nil {
		winsys.Info(msgNoDataDir)
		return 1
	}
	lg, _ := setup.OpenLog(filepath.Join(dir, "helper.log"), logMaxBytes) // nil-safe on error
	defer lg.Close()
	logf := lg.Logf
	winsys.ToastLogf = logf
	logf("start version=%s base=%s relaunched=%v", *ver, *base, *relaunched)
	if lockErr != nil {
		logf("single-instance lock: %v (continuing)", lockErr)
	}
	if swapErr != nil {
		logf("update swap: %v", swapErr)
	}

	settingsPath := filepath.Join(dir, "settings.json")
	var settingsMu sync.Mutex
	settings := setup.LoadSettings(settingsPath)
	tray := &winsys.Tray{}
	tray.SetToastsOn(settings.Toasts)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	site := setup.NewSite(api.Client{BaseURL: *base, Version: *ver})
	label := setup.Label(os.Getenv("USERNAME"), os.Getenv("COMPUTERNAME"))

	// 3. Pair if there is no key.
	key, err := winsys.LoadKey()
	if err != nil {
		logf("load key: %v", err)
	}
	firstRun := key == ""
	if firstRun {
		k, ok := setup.Pair(ctx, dialogs{}, site, label, logf)
		if !ok {
			logf("pairing cancelled")
			return 0
		}
		key = k
		if err := winsys.SaveKey(key); err != nil {
			logf("save key: %v", err)
		}
		logf("paired as %s", label)
	}
	site.SetKey(key)

	// 4. Find Rocket League and enable the Stats API. The folder picker is only
	// shown on the first run so a missing install doesn't nag every boot.
	exists := func(p string) bool {
		ok, err := statsini.OSFS{}.Exists(p)
		if err != nil {
			logf("stat %s: %v", p, err)
		}
		return ok
	}
	cands := rlpath.Candidates(winsys.SteamRoot(), os.ReadFile)
	if settings.RLDir != "" {
		cands = append([]string{settings.RLDir}, cands...)
	}
	if rlDir, found := setup.FindRL(cands, exists, dialogs{}, firstRun); found {
		logf("rocket league at %s", rlDir)
		if rlDir != settings.RLDir {
			settingsMu.Lock()
			settings.RLDir = rlDir
			if err := setup.SaveSettings(settingsPath, settings); err != nil {
				logf("save settings: %v", err)
			}
			settingsMu.Unlock()
		}
		setup.EnableStatsAPI(rlDir, statsini.OSFS{}, func() bool { return winsys.ProcessRunning(rlProcess) }, dialogs{}, logf)
	} else {
		logf("rocket league not found")
	}

	// 5. Install.
	exe, err := winsys.InstallSelf()
	if err != nil {
		logf("install: %v", err)
		if exe, err = os.Executable(); err != nil {
			logf("executable: %v", err)
		}
	}

	q, err := queue.Open(filepath.Join(dir, "queue.jsonl"))
	if err != nil {
		logf("open queue: %v", err)
		winsys.Info(msgNoDataDir)
		return 1
	}

	// 6. Run the app behind the tray.
	ctl := &setup.Controller{
		Dialogs: dialogs{}, Site: site, Keys: keyStore{}, Label: label,
		Tray: tray, QueueLen: q.Len, Logf: logf,
	}
	a := app.New(app.Deps{
		Dial: func(ctx context.Context) (app.Stream, error) {
			return statsapi.Dial(ctx, "127.0.0.1", []int{49123, 49124})
		},
		NewSource: statsapi.NewParser,
		Poster:    site,
		Queue:     q,
		OnState:   ctl.OnState, // non-blocking: records state, posts to the tray mailbox
		OnGoal: func(display, song string) {
			if tray.ToastsOn() {
				winsys.Toast(setup.GoalToast(display, song), "")
			}
		},
		Logf: logf,
	})
	ctl.SetApp(a)
	ctl.OnState(app.Idle)

	appDone := make(chan struct{})
	go func() { a.Run(ctx); close(appDone) }()
	go ctl.PingLoop(ctx, sleepCtx)

	// 7. Self-update. Dev builds never update themselves.
	var relaunch atomic.Bool
	if exe != "" && !strings.Contains(*ver, "-dev") {
		u := &setup.Updater{
			Current:  *ver,
			Latest:   site.Latest,
			Download: update.Download,
			Dest:     filepath.Join(filepath.Dir(exe), update.NewExeName),
			Idle:     func() bool { return ctl.State() != app.Connected },
			Restart:  func() { relaunch.Store(true); tray.Quit() },
			Logf:     logf,
			Sleep:    sleepCtx,
		}
		go u.Loop(ctx)
	}

	tray.OnOpen = func() {
		if err := winsys.OpenURL(strings.TrimRight(*base, "/") + "/RLTracker"); err != nil {
			logf("open tracker: %v", err)
		}
	}
	tray.OnTogglePause = ctl.TogglePause
	tray.OnToggleToasts = func() {
		settingsMu.Lock()
		defer settingsMu.Unlock()
		settings.Toasts = tray.ToastsOn()
		if err := setup.SaveSettings(settingsPath, settings); err != nil {
			logf("save settings: %v", err)
		}
	}
	tray.OnRepair = func() { ctl.Repair(ctx) }
	tray.OnQuit = cancel

	tray.Run() // blocks on the main thread until Quit

	// Stop the app and let it finish its current queue write before exiting.
	cancel()
	select {
	case <-appDone:
	case <-time.After(shutdownWait):
		logf("shutdown: app did not stop within %v", shutdownWait)
	}
	releaseLock()
	if relaunch.Load() {
		if err := winsys.Relaunch(exe, args); err != nil {
			logf("relaunch: %v", err)
		}
	}
	logf("exit")
	return 0
}
