# Owner GUI acceptance fixture

Copy this directory to a fresh temporary folder, then follow [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md). The prepared project is for KiCad 10.0.7 and the DemonX Circuit development preview. No setup script launches KiCad or changes files.

## Fixture provenance

The native source and staged candidate are preserved from `reports/checkpoint-5/native-roundtrip/validated-run` (KiCad 10.0.7 round-trip evidence for commit `eaa7f89e4761b0e2b71bba3bd334e111187f02a9`). The candidate changes R1 from 330 to 470. The accompanying original and candidate KiCad XML netlists currently have identical pin groups. Thus, while the accepted hosted editor interaction evidence includes a semantic wiring edit, the locally retained native files do **not** show a corresponding native topology change. The package makes this limitation visible rather than claiming that it does.

The candidate schematic hash is recorded in `manifest.json`; the prepared backup has the same hash. `candidate/reports/roundtrip-candidate-erc.rpt` is the preserved native KiCad report, which reports 0 errors and 0 warnings for that candidate. The owner-run PowerShell script creates fresh, timestamped reports after the reversible 470→510 edit.

## Contents

- `original/`: separate native project snapshot and source netlist.
- `candidate/`: separate native project snapshot with staged schematic, original board fixture, saved native netlist/ERC evidence, and non-overwriting restore copy.
- `verify-after-save.ps1`: pinned-version KiCad CLI netlist and ERC check. It only reads project files and writes a new folder under `owner-results/`.
- `manifest.json`: SHA-256 inventory and expected observations.
- `OWNER-CHECKLIST.md`: GUI inspection, reversible edit, DemonX reimport, result recording, and rollback steps.

The board file is included to make both folders valid KiCad projects; this checkpoint is schematic-only and makes no PCB verification or manufacturing claim.
