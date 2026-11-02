# RL Goal Tracker helper

## Releasing the helper

Releases are built by `.github/workflows/helper-release.yml`. To publish a new version, push a tag named `helper-vX.Y.Z` (for example `helper-v1.0.0`). The workflow runs the tests, builds `RLGoalTracker.exe` for Windows with the version taken from the tag, and attaches the exe and `RLGoalTracker.exe.sha256` to a GitHub Release. The site's `/api/rl/v1/helper/latest` endpoint serves the newest `helper-v*` release.

Do not release until the Stats API parser (Task 3) has landed.
