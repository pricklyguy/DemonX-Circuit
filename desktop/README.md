# DemonX Circuit desktop preview

## Windows development launch

Requirements: Node.js 24.x and npm. KiCad 10.0.7 and ESPHome CLI are separate optional installations. The preview does not install them or alter PATH, registry, or machine configuration.

```powershell
npm ci
npm start
```

`npm start` compiles the TypeScript preload and renderer, ensures the pinned project-local Electron runtime is present, and launches the desktop app. Run `npm run build` alone to compile without opening a window.

The portable Windows ZIP is produced by the `DemonX Circuit Windows desktop preview` workflow. Extract it and launch `DemonX Circuit.exe`; it does not use an installer. KiCad must be installed separately for native editor, ERC/DRC, and manufacturing operations. ESPHome CLI is required for configuration validation. AI/MCP and Forge/CNC handoffs remain unavailable. Repository screenshots are static still images captured from the packaged Electron application; the ZIP itself is the interactive desktop application. No interactive browser-only demo is provided.

## Packaged interaction acceptance

The workflow extracts the ZIP and runs:

```powershell
node desktop/acceptance.mjs "<extracted>\DemonX-Circuit\DemonX Circuit.exe" "<report-directory>"
```

The acceptance runner launches the packaged executable with a dedicated temporary user-data folder, then sends real mouse clicks through Chromium DevTools Protocol. It checks New Project filesystem output, Open Project reopening, settings and theme persistence across restart, actual native-tool detection, fixture-backed PCB/check/manufacturing actions, ESPHome preview, renderer/preload errors, and captures dark and light screenshots. It redirects native dialogs only inside this isolated test process. The report distinguishes PASS, FAIL, and NOT TESTED.

## DemonX Suite appearance

The header uses the original transparent DemonX Circuit wordmark from `assets/DemonX_wordmarks/DemonX Circuit.png`. The window uses the official Circuit ICO on Windows and the 512px Circuit PNG on Linux; both remain byte-identical to the source artworks under `desktop/assets/`. The rest of the Suite artwork remains available in the repository's root `assets/` collection and is not loaded by the Circuit UI. CSS applies the existing copper/teal palette around the unchanged artwork in both themes.
