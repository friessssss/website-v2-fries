# RL Goal Tracker helper

## Releasing the helper

Releases are built by `.github/workflows/helper-release.yml`. To publish a new version, push a tag named `helper-vX.Y.Z` (for example `helper-v1.0.0`). The workflow runs the tests, builds `RLGoalTracker.exe` for Windows with the version taken from the tag, and attaches the exe and `RLGoalTracker.exe.sha256` to a GitHub Release. The site's `/api/rl/v1/helper/latest` endpoint serves the newest `helper-v*` release.

## Uninstalling

1. Right-click the RL Goal Tracker tray icon and choose Quit.
2. Delete the `%LOCALAPPDATA%\RLGoalTracker` folder. The next sign-in no longer starts it (the Run entry points at a file that is gone).
3. Optional: to also remove the stored API key from Windows Credential Manager, run `RLGoalTracker.exe --reset` before deleting the folder.
