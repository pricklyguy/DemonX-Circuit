# Owner KiCad GUI acceptance fixture

This package contains the exact original and accepted staged native schematic captured by the packaged Windows round-trip acceptance run. Copy the complete directory to a new, writable temporary location before testing. Never extract over or edit an existing project.

## Evidence and scope

- Source acceptance commit: `c6f016acf775802025b92863ec627c15db5db9da`.
- KiCad version used for native export/ERC: 10.0.7.
- Original schematic SHA-256: `b3c611bff34261a99b3f7dafe0c12ec8b66939e76567ae375333fa0665b7fdf1`.
- Staged committed candidate SHA-256: `9c58f70b6dbb256452a30b81e9e7642f9a0a55f0846fdc4ad0d076070d37d5a7`.
- `roundtrip-evidence.json` records the exact staged candidate, component edits, native netlist comparison, ERC exit code, and original backup hash.
- Native CI verification passed: both native netlists matched their expected connectivity, and candidate ERC exited 0. The candidate intentionally changes topology; the complete expected groups are in the manifest and checklist.
- Hosted KiCad GUI launch is **BLOCKED** because that runner lacks OpenGL 2.1. Owner-machine GUI inspection, a reversible GUI edit/save/reopen, and DemonX reimport after that owner edit remain **NOT TESTED**.

## Files

- `original/`: isolated KiCad source project and original netlist.
- `candidate/`: exact accepted committed native candidate, project/library files, native reports, the CI pre-approval backup, and a separate candidate reset copy for the owner's reversible GUI edit.
- `verify-after-save.ps1`: read-only KiCad CLI netlist/ERC check after the manual save; it writes only a new timestamped folder under `owner-results/`.
- `verify-package.ps1`: validates the SHA-256 inventory; CRLF line endings are normalized to LF to match the downloadable Git content.
- `manifest.json`: SHA-256 inventory and expected observations.
- `OWNER-CHECKLIST.md`: safe graphical inspection and reversible edit procedure.

The PCB file is included because KiCad projects contain both schematic and board documents. This checkpoint verifies the schematic workflow only; it does not approve the board or manufacturing.
