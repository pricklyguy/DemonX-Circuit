# Checkpoint 5 results

**Date:** 2026-10-25
**Branch:** `codex/demonx-circuit-schematic-editor`
**Scope:** 5A foundation study, constrained DemonX schematic sidecar editor, official MCP SDK read-only feasibility, and fixture-only native KiCad edit experiment. This report is not manufacturing approval.

## Results matrix

| Requirement | Result | Evidence and limits |
|---|---|---|
| Konva / tscircuit / maxGraph / KiCad editing foundation comparison | PASS | `docs/research/SCHEMATIC-EDITOR-FOUNDATIONS.md`; compares licensing, maintenance, edit primitives, electrical semantics and native compatibility. |
| TypeScript and renderer build | PASS | `npm run build`; TypeScript compilation succeeded and bundled renderer generated at about 490 kB. |
| Model pin rotation and stable coordinates | PASS | `npm run test:schematic-model`; rotation-aware pin geometry passes. |
| Explicit wire graph, disconnect/reconnect, merged nets | PASS | Model smoke test derives connectivity from endpoint IDs. Overlap/crossing is not an electrical connection. |
| Model save/reopen serialization | PASS | Deterministic JSON round-trip and pin-to-net assignment equality verified by the model smoke test. |
| Official MCP SDK stdio negotiation / tools | PASS | `npm run test:mcp`; official TypeScript SDK 2.4.0 client negotiated with the local SDK server, listed eight read-only tools and successfully inspected project/component/pin/net/object/library/firmware data. |
| Codex or Claude MCP client interoperability | NOT TESTED | SDK-to-SDK is not evidence that a named host can launch/configure the server. No host client was connected. |
| Native KiCad value-edit feasibility, exact fixture only | PASS | KiCad 10.0.7 CLI exported original and edited XML netlists; `compare-native-netlists.py` found all 6 pin-to-net assignments identical and R1 changed 330→470. The original was not overwritten. |
| Native KiCad ERC on staged edit | PASS | KiCad 10.0.7 `sch erc --severity-all --exit-code-violations`; exit 0, 0 errors, 0 warnings. Report: `native-roundtrip/validated-run/erc-edited.rpt`. KiCad also listed its default excluded check categories. |
| General KiCad import/export from the desktop editor | NOT TESTED / NOT IMPLEMENTED | DemonX editor stores its own append-only sidecar. It does not open or export arbitrary `.kicad_sch`; no unsupported native constructs are dropped. |
| Edited native schematic reopened in Eeschema | NOT TESTED | The parser output passed CLI netlist and ERC but was not opened in the KiCad GUI. |
| Packaged Windows mouse acceptance on this host | FAIL — environment blocked before UI tests | Attempted against a manually assembled portable Electron directory. Electron exited with code 2147483651 before exposing a renderer. Chromium reported that the workspace package ACL lacked `ALL APPLICATION PACKAGES` access for its sandbox token. Changing ACLs or disabling Electron sandbox is not an acceptable workaround here. No app interaction or screenshot was produced by this attempt. Hosted Windows Actions acceptance remains pending. |
| Windows hosted runner artifact/screenshots | NOT TESTED | Requires pushing this feature branch so its workflow can run. The Windows workflow was updated to trigger for this branch; no artifact is claimed yet. |
| Defender scan / provenance / checksums | NOT TESTED | Existing Windows distribution workflow is retained; this branch has not produced a hosted artifact. |
| Linux packaged UI / native GUI | NOT TESTED | Source/model and MCP scripts are OS-neutral; no Linux desktop package was built in this checkpoint. |

## Native experiment details

- Engine: `C:\Program Files\KiCad\10.0\bin\kicad-cli.exe`, reported version `10.0.7`.
- Parser: KiCad-bundled Python 3.11 plus project-local `kicad-sch-api==0.5.6`, supplied through `DEMONX_KICAD_SCH_API_PATH`. No system-wide Python install or machine configuration change was made.
- Input: generated native J1 / R1 / D1 LED/resistor fixture.
- Edit: `R1.value`: `330` → `470` into a separate candidate schematic.
- Candidate checks: both netlist exports exit 0; connectivity comparison exit 0; ERC exit 0, 0 errors and 0 warnings.
- Environment diagnostics: local KiCad CLI cannot create its HKCU preference key or access the real user KiCad settings under this sandbox, and Fontconfig reports `SHGetFolderPathA` failures. It nevertheless wrote the reports and netlists with the stated exit codes. Project-local KiCad symbol/footprint tables were used. These diagnostics are retained as a limitation, not hidden.
- Files: `native-roundtrip/validated-run/original.net`, `edited.net`, `erc-edited.rpt`, plus the candidate schematic under `edited/`.

## Schematic editor status

The working tree contains a Konva editor view with a 1.27 mm (50 mil) model grid, component picker, selection/movement, quarter-turn rotation, component deletion, wire-by-pin, explicit junctions, undo/redo, validation, and append-only sidecar saves. Component values are editable in the inspector. Only the built-in connector, resistor and LED definitions exist. Native files remain unchanged.

Automated model tests pass. Packaged mouse interaction tests were added to `desktop/acceptance.mjs` for opening the workspace, adding a component, undo/redo, rotate/delete, real canvas pin clicks to add a semantic wire, saving an immutable revision, reopening it, and comparing model state. These checks have **not run** because the local packaged Electron process failed at the sandbox ACL before UI startup. Their result is pending the Windows Actions run.

## Architecture recommendation

Continue the small DemonX-native sidecar editor as an explicitly limited usability preview. Keep KiCad 10.0.7 as the native project and verification engine. The fixture parser experiment is promising for a narrow, allowlisted adapter but does not justify general conversion. Do not present sidecar-only edits as KiCad edits, native netlists, or ERC results. The official MCP SDK integration is read-only and remains a separate local stdio development tool; named AI clients need tests before interoperability claims.

## Required next evidence / owner review

1. Run the updated extracted-ZIP acceptance workflow on a hosted Windows runner and inspect every click result plus the actual editor screenshots.
2. Fix any packaged editor interaction failures and rerun before delivering the application as mouse-testable.
3. Open the staged parser output in KiCad 10.0.7 GUI and record the result; only then close the fixture-only round-trip proof.
4. Decide whether the owner accepts a separately stored DemonX schematic model as an interim editor, or requires native KiCad document round-trip before owner testing.
5. Test Codex and Claude MCP launch/configuration separately; until then, do not claim client compatibility.

No manufacturing approval, arbitrary KiCad schematic editing capability, firmware behavior inference, or MCP modification permission is claimed.
