//go:build windows

package media

import (
	"errors"
	"runtime"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/saltosystems/winrt-go/windows/foundation"
	"github.com/saltosystems/winrt-go/windows/media/control"
)

const (
	// asyncTimeout bounds one WinRT async call (RequestAsync,
	// TryGetMediaPropertiesAsync).
	asyncTimeout = 500 * time.Millisecond
	// smtcReplyTimeout bounds a whole SMTC read, so a stuck worker still
	// lets NowPlaying fall back to the window title.
	smtcReplyTimeout    = 2 * time.Second
	roInitMultithreaded = 1
)

var errAsync = errors.New("media: winrt async call failed or timed out")

type smtcResult struct {
	title, artist string
	ok            bool
}

// smtcReqs feeds the single SMTC worker. Capacity 1 plus a non-blocking
// send: a busy (or stuck) worker means "no SMTC reading" right away.
var smtcReqs = func() chan chan smtcResult {
	ch := make(chan chan smtcResult, 1)
	go smtcWorker(ch)
	return ch
}()

// smtcNowPlaying asks the worker for a reading.
func smtcNowPlaying() (string, string, bool) {
	reply := make(chan smtcResult, 1)
	select {
	case smtcReqs <- reply:
	default:
		return "", "", false
	}
	t := time.NewTimer(smtcReplyTimeout)
	defer t.Stop()
	select {
	case r := <-reply:
		return r.title, r.artist, r.ok
	case <-t.C:
		return "", "", false
	}
}

// smtcWorker owns one OS thread in the WinRT multithreaded apartment and
// keeps the session manager between reads.
func smtcWorker(reqs chan chan smtcResult) {
	runtime.LockOSThread() // never unlocked: the thread stays in the apartment
	// S_FALSE (already initialised) or a thread already in another apartment
	// is not fatal: the calls below fail and the window title is used.
	_ = ole.RoInitialize(roInitMultithreaded)
	var mgr *control.GlobalSystemMediaTransportControlsSessionManager
	for reply := range reqs {
		var r smtcResult
		func() {
			defer func() {
				if recover() != nil { // the bindings panic when QueryInterface fails
					if mgr != nil {
						mgr.Release()
					}
					mgr, r = nil, smtcResult{}
				}
			}()
			if mgr == nil {
				mgr = requestManager()
			}
			if mgr == nil {
				return
			}
			var err error
			r.title, r.artist, r.ok, err = readManager(mgr)
			if err != nil { // a broken manager is requested afresh next time
				mgr.Release()
				mgr = nil
			}
		}()
		reply <- r
	}
}

func requestManager() *control.GlobalSystemMediaTransportControlsSessionManager {
	op, err := control.GlobalSystemMediaTransportControlsSessionManagerRequestAsync()
	if err != nil || op == nil {
		return nil
	}
	defer op.Release()
	p, err := await(op)
	if err != nil || p == nil {
		return nil
	}
	return (*control.GlobalSystemMediaTransportControlsSessionManager)(p)
}

// readManager picks the song with PickSession. Media properties are only
// fetched for playing Spotify sessions, the only ones PickSession accepts.
func readManager(mgr *control.GlobalSystemMediaTransportControlsSessionManager) (string, string, bool, error) {
	cur, err := mgr.GetCurrentSession()
	if err != nil {
		return "", "", false, err
	}
	var current *Session
	if cur != nil {
		s := readSession(cur)
		cur.Release()
		current = &s
		if current.isSpotify() {
			if title, artist, ok := current.song(); ok {
				return title, artist, true, nil
			}
		}
	}
	var all []Session
	if v, err := mgr.GetSessions(); err == nil && v != nil {
		if n, err := v.GetSize(); err == nil {
			for i := uint32(0); i < n; i++ {
				p, err := v.GetAt(i)
				if err != nil || p == nil {
					continue
				}
				s := (*control.GlobalSystemMediaTransportControlsSession)(p)
				all = append(all, readSession(s))
				s.Release()
			}
		}
		v.Release()
	}
	title, artist, ok := PickSession(current, all)
	return title, artist, ok, nil
}

// readSession reads the app id and playback status, and the title and
// artist when it is a playing Spotify session.
func readSession(s *control.GlobalSystemMediaTransportControlsSession) Session {
	var out Session
	out.AppID, _ = s.GetSourceAppUserModelId()
	if info, err := s.GetPlaybackInfo(); err == nil && info != nil {
		st, err := info.GetPlaybackStatus()
		out.Playing = err == nil && st == control.GlobalSystemMediaTransportControlsSessionPlaybackStatusPlaying
		info.Release()
	}
	if !out.Playing || !out.isSpotify() {
		return out
	}
	op, err := s.TryGetMediaPropertiesAsync()
	if err != nil || op == nil {
		return out
	}
	defer op.Release()
	p, err := await(op)
	if err != nil || p == nil {
		return out
	}
	props := (*control.GlobalSystemMediaTransportControlsSessionMediaProperties)(p)
	defer props.Release()
	out.Title, _ = props.GetTitle()
	out.Artist, _ = props.GetArtist()
	return out
}

// await polls an async operation until it completes (no completion
// delegate needed) and returns its result, cancelling it on timeout.
func await(op *foundation.IAsyncOperation) (unsafe.Pointer, error) {
	d, err := op.QueryInterface(ole.NewGUID(foundation.GUIDIAsyncInfo))
	if err != nil {
		return nil, err
	}
	info := (*foundation.IAsyncInfo)(unsafe.Pointer(d))
	defer info.Release()
	deadline := time.Now().Add(asyncTimeout)
	for {
		st, err := info.GetStatus()
		if err != nil {
			return nil, err
		}
		switch st {
		case foundation.AsyncStatusCompleted:
			return op.GetResults()
		case foundation.AsyncStatusStarted:
			if time.Now().After(deadline) {
				_ = info.Cancel()
				return nil, errAsync
			}
			time.Sleep(2 * time.Millisecond)
		default: // canceled or error
			return nil, errAsync
		}
	}
}
