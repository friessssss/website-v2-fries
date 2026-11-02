// Command RLGoalTracker is the Windows tray helper: it pairs with the site,
// turns on the Rocket League Stats API, uploads match events and keeps itself
// up to date. The logic lives in internal/setup and internal/app; this file
// only wires the Windows implementations together.
package main

import (
	"context"
	"flag"
	"fmt"
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
	elevateTimeout   = 2 * time.Minute
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
	showVersion := flag.Bool("version", false, "show the version and exit")
	reset := flag.Bool("reset", false, "delete the stored API key and exit")
	relaunched := flag.Bool("relaunched", false, "internal: started by an update or restart")
	patchIni := flag.String("patch-ini", "", "internal: patch this Stats API ini (run elevated) and exit")
	replay := flag.String("replay", "", "upload a Stats API capture file to --base-url and exit (testing)")
	flag.Parse()
	args := os.Args[1:]

	if *replay != "" {
		baseSet := false
		flag.Visit(func(f *flag.Flag) { baseSet = baseSet || f.Name == "base-url" })
		return runReplay(*base, baseSet, *replay)
	}

	if *patchIni != "" {
		return setup.PatchIni(*patchIni, statsini.OSFS{})
	}
	if *showVersion {
		winsys.Info("RL Goal Tracker " + version)
		return 0
	}
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
	logf("start version=%s base=%s relaunched=%v", version, *base, *relaunched)
	if lockErr != nil {
		logf("single-instance lock: %v (continuing)", lockErr)
	}
	if swapErr != nil {
		logf("update swap: %v", swapErr)
	}

	settings := setup.OpenSettings(filepath.Join(dir, "settings.json"))
	saveSettings := func(f func(*setup.Settings)) {
		if err := settings.Update(f); err != nil {
			logf("save settings: %v", err)
		}
	}
	tray := &winsys.Tray{}
	tray.SetToastsOn(settings.Get().Toasts)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	site := setup.NewSite(api.Client{BaseURL: *base, Version: version})
	label := setup.Label(os.Getenv("USERNAME"), os.Getenv("COMPUTERNAME"))
	var notices []setup.Notice // shown once the tray is up

	// 3. Pair if there is no key. A key-store error is not "unpaired": start
	// in the re-pair state instead of running the first-run prompts.
	key, loadErr := winsys.LoadKey()
	if loadErr != nil {
		logf("load key: %v", loadErr)
	}
	mode := setup.StartMode(key, loadErr)
	firstRun := mode == setup.ModeFirstRun
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
	// shown on the first run (and from the tray menu) so a missing install
	// doesn't nag every boot.
	iniDeps := setup.IniDeps{
		FS:        statsini.OSFS{},
		RLRunning: func() bool { return winsys.ProcessRunning(rlProcess) },
		Elevate: func(path string) error {
			self, err := os.Executable()
			if err != nil {
				return err
			}
			code, err := winsys.RunElevated(self, []string{"--patch-ini", path}, elevateTimeout)
			if err != nil {
				return err
			}
			if code != setup.PatchOK {
				return fmt.Errorf("elevated patch exited with code %d", code)
			}
			return nil
		},
		Once: settings.Once,
		Logf: logf,
	}
	exists := func(p string) bool {
		ok, err := statsini.OSFS{}.Exists(p)
		if err != nil {
			logf("stat %s: %v", p, err)
		}
		return ok
	}
	findAndEnable := func(ask bool) (bool, []setup.Notice) {
		cands := rlpath.Candidates(winsys.SteamRoot(), os.ReadFile)
		if d := settings.Get().RLDir; d != "" {
			cands = append([]string{d}, cands...)
		}
		rlDir, found := setup.FindRL(cands, exists, dialogs{}, ask)
		if !found {
			logf("rocket league not found")
			return false, nil
		}
		logf("rocket league at %s", rlDir)
		if rlDir != settings.Get().RLDir {
			saveSettings(func(s *setup.Settings) { s.RLDir = rlDir })
		}
		_, ns := setup.EnableStatsAPI(rlDir, iniDeps)
		return true, ns
	}
	rlFound, ns := findAndEnable(firstRun)
	notices = append(notices, ns...)
	if firstRun {
		notices = append(notices, setup.FirstRunNotice(rlFound))
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
	if mode == setup.ModeKeyError {
		a.SetNeedsPair()
	}

	appDone := make(chan struct{})
	go func() { a.Run(ctx); close(appDone) }()
	go ctl.PingLoop(ctx, sleepCtx)

	// 7. Self-update. Dev builds never update themselves. It starts from the
	// tray's OnReady so its Restart (tray.Quit) can never run before tray.Run.
	var relaunch atomic.Bool
	var updater *setup.Updater
	if exe != "" && !strings.Contains(version, "-dev") {
		updater = &setup.Updater{
			Current:  version,
			Latest:   site.Latest,
			Download: update.Download,
			Dest:     filepath.Join(filepath.Dir(exe), update.NewExeName),
			Idle:     func() bool { return ctl.State() != app.Connected },
			Restart:  func() { relaunch.Store(true); tray.Quit() },
			Logf:     logf,
			Sleep:    sleepCtx,
		}
	}
	tray.OnReady = func() {
		if updater != nil {
			go updater.Loop(ctx)
		}
		setup.ShowNotices(notices, settings.Once, winsys.Info, logf)
	}

	tray.OnOpen = func() {
		if err := winsys.OpenURL(strings.TrimRight(*base, "/") + "/RLTracker"); err != nil {
			logf("open tracker: %v", err)
		}
	}
	tray.OnTogglePause = ctl.TogglePause
	tray.OnToggleToasts = func() {
		on := tray.ToastsOn()
		saveSettings(func(s *setup.Settings) { s.Toasts = on })
	}
	tray.OnRepair = func() { ctl.Repair(ctx) }
	var findMu sync.Mutex
	tray.OnFindRL = func() {
		if !findMu.TryLock() {
			return
		}
		defer findMu.Unlock()
		found, ns := findAndEnable(true)
		if !found {
			return
		}
		if len(ns) == 0 {
			ns = []setup.Notice{{Msg: setup.MsgRLFound}}
		}
		setup.ShowNotices(ns, settings.Once, winsys.Info, logf)
	}
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
