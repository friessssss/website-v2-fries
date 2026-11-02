// Package api is the HTTP client for the site's /api/rl/v1 endpoints.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/friessssss/website-v2-fries/helper/internal/model"
)

const (
	requestTimeout = 15 * time.Second
	maxBodyKept    = 500
)

var (
	// ErrUnauthorized means the API key was rejected (401). Stop and re-pair.
	ErrUnauthorized = errors.New("api: unauthorized")
	// ErrRetryable means a network error, 429 or 5xx. Retry with backoff.
	ErrRetryable = errors.New("api: retryable")
	// ErrCodeExpired means the pairing code is invalid or expired.
	ErrCodeExpired = errors.New("api: pairing code expired")
)

// ErrRejected is any other 4xx. Retrying will not help. Use errors.As.
type ErrRejected struct {
	Status int
	Body   string // truncated to 500 bytes
}

func (e ErrRejected) Error() string {
	return fmt.Sprintf("api: rejected with status %d: %s", e.Status, e.Body)
}

// Result is the per-event outcome of POST /events.
type Result struct {
	Status       string `json:"status"`
	ID           string `json:"id"`
	Song         string `json:"song"`
	ActorDisplay string `json:"actorDisplay"`
}

// Client talks to the site. HTTP and Version are optional.
type Client struct {
	BaseURL string
	Key     string
	HTTP    *http.Client
	Version string
}

func (c *Client) do(ctx context.Context, method, path string, body any, auth bool) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rd = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("User-Agent", "RLGoalTracker/"+c.Version)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if auth {
		req.Header.Set("Authorization", "Bearer "+c.Key)
	}
	hc := c.HTTP
	if hc == nil {
		hc = http.DefaultClient
	}
	resp, err := hc.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrRetryable, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrRetryable, err)
	}
	return resp.StatusCode, b, nil
}

func classify(status int, body []byte) error {
	switch {
	case status == 401:
		return ErrUnauthorized
	case status == 429 || status >= 500:
		return fmt.Errorf("%w: status %d", ErrRetryable, status)
	default:
		if len(body) > maxBodyKept {
			body = body[:maxBodyKept]
		}
		return ErrRejected{Status: status, Body: string(body)}
	}
}

// Pair redeems a pairing code and returns the API key.
func (c *Client) Pair(ctx context.Context, code, label string) (string, error) {
	status, body, err := c.do(ctx, http.MethodPost, "/api/rl/v1/pair", map[string]string{"code": code, "label": label}, false)
	if err != nil {
		return "", err
	}
	if status == 400 {
		return "", ErrCodeExpired
	}
	if status != 200 && status != 201 {
		return "", classify(status, body)
	}
	var out struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.APIKey == "" {
		return "", fmt.Errorf("api: bad pair response")
	}
	return out.APIKey, nil
}

// PostEvents uploads one batch. Callers must pass at most 50 events: the
// server answers 400 for larger batches and the client does not split them.
func (c *Client) PostEvents(ctx context.Context, events []model.Event, sentAt time.Time) ([]Result, error) {
	if events == nil {
		events = []model.Event{}
	}
	payload := struct {
		HelperVersion string        `json:"helperVersion"`
		SentAt        string        `json:"sentAt"`
		Events        []model.Event `json:"events"`
	}{c.Version, model.FormatTime(sentAt), events}
	status, body, err := c.do(ctx, http.MethodPost, "/api/rl/v1/events", payload, true)
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, classify(status, body)
	}
	var out struct {
		Results []Result `json:"results"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("%w: bad response: %v", ErrRetryable, err)
	}
	return out.Results, nil
}

// Latest returns the newest helper version and its download URL.
func (c *Client) Latest(ctx context.Context) (version, url string, err error) {
	status, body, err := c.do(ctx, http.MethodGet, "/api/rl/v1/helper/latest", nil, false)
	if err != nil {
		return "", "", err
	}
	if status != 200 {
		return "", "", classify(status, body)
	}
	var out struct {
		Version     string `json:"version"`
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", "", fmt.Errorf("api: bad latest response: %v", err)
	}
	return out.Version, out.DownloadURL, nil
}

// Ping tells the site this helper is alive (keeps the live dot on between
// matches). It answers 204; 401 returns ErrUnauthorized.
func (c *Client) Ping(ctx context.Context) error {
	status, body, err := c.do(ctx, http.MethodPost, "/api/rl/v1/ping", nil, true)
	if err != nil {
		return err
	}
	if status == 204 || status == 200 {
		return nil
	}
	return classify(status, body)
}
