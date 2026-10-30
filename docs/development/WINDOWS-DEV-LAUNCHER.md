# DemonX Circuit Windows development launcher

The development launcher runs the current local checkout and is separate from
portable release packaging. It does not download an Actions artifact or install
software. KiCad remains a separately installed dependency.

## First use

From the repository checkout, run:

```powershell
powershell.exe -NoProfile -File .\scripts\Start-DemonXCircuitDev.ps1 -Watch
```

Alternatively, in the repository root use `npm run dev:windows`. The launcher
checks that this is the expected Git checkout, prints the checked-out branch and
short commit, requires Node.js 24.x and the repository's installed npm
dependencies, runs `npm run build`, and launches the repository-local
`node_modules\electron\dist\electron.exe` with the repository as its working
directory. It never invokes `npm ci` or another installer automatically.

The KiCad probe checks the usual Windows installation folders and reads the
executable's Windows version metadata without running KiCad or touching its
user configuration. It reports the exact CLI path, detected version, and
whether it is the qualified 10.0.7 version. Detection is informational: an
executable's version metadata does not imply that ERC/DRC was run successfully.

The optional `-Watch` mode watches local renderer TypeScript and UI source files
and runs the project build after edits settle. Electron receives a narrowly scoped reload
notification when the built renderer or UI files change. A clean renderer
reloads automatically while the project dashboard is active. If the schematic
editor is open, or has unsaved edits, reload is deferred and the application
offers an explicit reload control after the user is ready. No edit is silently
discarded and saving does not unexpectedly close the editor. The development app uses an
isolated profile in `build\dev\profile`, so it does not alter the normal preview
profile or its recent projects and theme preferences.

To open a specific local project on startup, append `-Project <project-folder>`.
The folder must contain `project.json`. This affects only the isolated development
profile. The board workspace also defers reload and refuses explicit reload while
it contains unsaved placement edits.

Changes to Electron main-process code or native adapters require closing and
relaunching the development app; watch mode does not hot-restart the privileged
process.

The launcher waits on the actual Electron executable process, not a command
shell wrapper. It records build and process output, errors, timestamps, and the
Electron PID and exit code in `build\dev\logs\circuit-dev-<timestamp>.log`.
The whole `build` directory is ignored by Git.

## Optional desktop shortcut

Run this once from the repository root:

```powershell
powershell.exe -NoProfile -File .\scripts\Install-DemonXCircuitDevShortcut.ps1
```

It creates a shortcut on the current user's Desktop, uses the official
`DemonX_Glowing_Board.ico`, and launches the local checkout in watch mode. It
does not require Administrator privileges or change execution policy, ACLs,
registry values, or Electron security settings. Delete the shortcut to remove
it; no repository or user application data is deleted.

## Troubleshooting

- If Node.js is missing or not 24.x, install the repository-required Node.js
  24.x release and retry.
- If local dependencies are incomplete, inspect `package-lock.json` and run
  `npm ci` yourself from the repository root. The launcher will not install
  them for you.
- If KiCad is missing or is not 10.0.7, the preview still opens but reports
  native EDA functionality as unavailable or incompatible.
- If startup fails, read the newest log in `build\dev\logs`. The launcher does
  not bypass Windows or Electron security restrictions to work around access
  errors.

## Owner acceptance

This launcher has been source/build checked in the repository, but a one-click
GUI session, actual window-close reporting, renderer reload, and editor
interaction require owner-machine execution and are reported as NOT TESTED until
performed there. The owner can confirm close detection by closing the window
and checking the final `EXIT ELECTRON pid=... code=...` line in the log.
