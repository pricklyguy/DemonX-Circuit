# Checkpoint 3 — packaged Windows owner-acceptance repair

Tested: 2026-10-24 06:05 UTC  
Branch: `codex/demonx-circuit-foundation`  
Commit: `693241b08d086bb0365b8245e8a4fbf362478f61`  
Workflow: [Windows preview run 40068737957](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40068737957)  
Runtime: Windows 2022, Node.js 24.19.0, Electron 45.0.0, DemonX Circuit 0.4.0

## Diagnosis and repair

The first packaged renderer logged:

```text
[Circuit renderer console] ... Uncaught ReferenceError: exports is not defined
```

`renderer.ts` was compiled with TypeScript's CommonJS output and loaded as a classic browser script. It threw before its button listeners could register. The preload file existed at the packaged path and the context bridge was separately available. The repair moved shared renderer/preload interfaces into `circuit-api.d.ts`, so the browser renderer compiles without a CommonJS wrapper while the isolated Electron preload stays CommonJS.

Acceptance testing found a second usability issue: a 1280 × 820 window put the rail controls below the hosted runner's 1024 × 768 screen. The default window is now 1120 × 720 and theme/settings sit near the top of the rail. The final test verifies the controls are visible and sends actual CDP mouse events; the report records their hit targets.

## Results

| Area | Result | Evidence |
|---|---|---|
| Extracted portable ZIP starts | **PASS** | Packaged process logged `packaged=true`; `appPath=.../resources/app`; `preloadExists=true`. |
| Renderer and preload bridge | **PASS** | Packaged page loaded `./dist/renderer.js`; `typeof window.circuit === "object"`. |
| New Project | **PASS** | Mouse click created a real `project.json` with format `demonx-project` and project ID `dx-mvlzvga6`. |
| Open Project | **PASS** | A second mouse click reopened the created project and restored its project ID. |
| Recent Projects | **PASS** | A recent-project mouse click reopened the project; the recent list persisted through restart. |
| Theme and settings | **PASS** | Rail theme toggle changed dark to light; Settings opened; its theme toggle worked. Light mode persisted after closing and restarting the packaged executable. |
| Tool availability UI | **PASS** | The runner detected `kicad=null`, `kicadEditor=null`, `esphome=null`; the dashboard displayed KiCad CLI and ESPHome CLI as `NOT FOUND`. |
| ESPHome generation | **PASS, generation only** | The packaged fixture preview included ESP32-S3 variant, GPIO8 SDA and GPIO10 relay mapping. |
| Helpful missing-tool errors | **PASS** | Open PCB, Check Circuit, and manufacturing actions explained that KiCad was missing and stated `NOT TESTED`. The ESPHome preview likewise stated CLI compatibility validation was `NOT TESTED`. |
| Renderer/preload unhandled exceptions | **PASS** | Acceptance report `unhandled: []`; no CDP runtime exceptions or preload errors occurred during startup and tested clicks. |
| KiCad editor launch | **NOT TESTED** | KiCad desktop editor was not installed on the hosted Windows runner. |
| Native KiCad ERC/DRC | **NOT TESTED** | KiCad CLI was not installed on the hosted Windows runner. |
| Gerber/Excellon/STEP export from the packaged UI | **NOT TESTED** | KiCad CLI was not installed on the hosted Windows runner. The independent native KiCad CI results remain recorded in `CHECKPOINT-3-RESULTS.md`; this run did not modify those fixture files. |
| ESPHome CLI compatibility validation | **NOT TESTED** | ESPHome CLI was not installed on the hosted Windows runner; only the generated preview was checked. |
| Owner's Windows computer | **NOT TESTED** | Acceptance ran on GitHub-hosted Windows 2022. The managed development host blocks Electron sandbox access to workspace folders through inherited AppContainer ACLs; no host-wide configuration or permissions were changed. |

The detailed machine-readable interaction report and screenshots are in [acceptance artifact 12550323018](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40068737957/artifacts/12550323018). The runnable Windows package is [artifact 12549989086](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40068737957/artifacts/12549989086) (273,949,939 bytes; 30-day retention). Extract the ZIP and launch `DemonX Circuit.exe`. KiCad 10.0.7 and ESPHome CLI must be installed separately for their native actions.

## Screenshots from the packaged Electron window

![DemonX Circuit 0.4.0 dark mode](desktop-preview.png)

![DemonX Circuit 0.4.0 light mode](desktop-preview-light.png)

## Current preview scope

The start screen has one New Project and one Open Project action, persisted recent projects, accessible settings and theme controls, clear tool-availability labels, a primary AI assistance panel marked unavailable, and Forge/CNC handoffs marked unavailable. Project actions continue to use the packaged fixture and existing narrow IPC. No schematic or PCB canvas was rebuilt.

Development launch on Windows: `npm ci`, then `npm start` from the repository root. The app requires no automatic installer. The next step is an owner-led launch/usability check on the owner's Windows computer; native KiCad and ESPHome operations should only be marked tested when those installed tools actually run.
