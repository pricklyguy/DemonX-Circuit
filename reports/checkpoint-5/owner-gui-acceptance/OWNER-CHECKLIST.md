# DemonX Circuit — Owner KiCad GUI Acceptance

This is a disposable acceptance fixture. Copy or extract the complete folder to a new writable temporary directory (for example `%TEMP%\DemonX-Circuit-GUI-Acceptance-<date>`). Do not point it at, or extract over, an existing project. The original and candidate are separate, self-contained folders.

## Prerequisites

- KiCad **10.0.7** installed by the owner.
- DemonX Circuit development preview available (optional, for the reimport step).
- Windows PowerShell 5.1 or later.

## Acceptance steps

1. Verify all package files against `manifest.json` using `Get-FileHash -Algorithm SHA256`. The hashes cover the native source files, candidate files, and preserved reports. If a hash differs before testing, stop and mark FAIL.
2. Open `candidate\DX_LED_Smoke.kicad_pro` in KiCad Manager, or open `candidate\DX_LED_Smoke.kicad_sch` directly with `eeschema.exe`. Do not open the `original` folder for editing.
3. Inspect references and values: D1=`RED LED`, J1=`5V INPUT`, R1=`470`. Inspect the wires against the three connectivity groups in `manifest.json`. The expected native candidate and original netlists are identical electrically; the recorded staged edit is the R1 value change. The local DemonX semantic editing test exercised wiring changes, but this retained native pair does not evidence a changed native topology.
4. Exercise editability with a reversible native edit: change R1 from `470` to `510` in the candidate, save, close, and reopen the candidate schematic. Confirm that the reference, wiring, and `510` value remain visible. The original project is never involved in this edit.
5. From PowerShell, run:

   ```powershell
   .\verify-after-save.ps1 -KiCadCli 'C:\Program Files\KiCad\10.0\bin\kicad-cli.exe'
   ```

   If KiCad is installed elsewhere, pass the actual `kicad-cli.exe` path. The script requires version 10.0.7, creates a new timestamped report directory, exports native netlists for original and saved candidate, compares connectivity, and runs ERC on the candidate. It never modifies a schematic. Expected result after step 4: same three pin groups as the manifest, R1 value 510, ERC exit code 0. Inspect the generated `.net` and `.rpt`, not only the summary.
6. Reopen the candidate project folder in DemonX Circuit. Choose **Open Circuit Schematic**. Confirm R1 is 510 and the wires/pin identities match the just-generated native netlist. If DemonX reports a stale or unsupported revision, record FAIL and retain the reports; do not commit or overwrite anything.
7. Mark every row in the checklist below. Capture screenshots of the KiCad schematic before and after the edit, and the DemonX reimport. Keep these inside the temporary acceptance folder.

## Results (owner fills in)

| Check | Result | Evidence / notes |
|---|---|---|
| Initial source and candidate hashes match manifest | NOT TESTED | |
| Candidate opens in KiCad 10.0.7 graphical editor | NOT TESTED | |
| D1, J1, R1 references and values display correctly | NOT TESTED | |
| Candidate wires match expected pin groups | NOT TESTED | |
| R1 470→510 edit saves and survives KiCad close/reopen | NOT TESTED | |
| Original project remains unchanged | NOT TESTED | |
| KiCad 10.0.7 native netlist matches expected connectivity | NOT TESTED | |
| KiCad ERC on saved candidate completes with no violations | NOT TESTED | |
| Saved candidate reopens in DemonX with same connectivity | NOT TESTED | |
| Screenshots and reports retained in temporary package | NOT TESTED | |

## Rollback

After recording results and reimporting in DemonX, close KiCad. To restore the prepared candidate for another run, copy `candidate\backups\DX_LED_Smoke.kicad_sch.initial-candidate` over `candidate\DX_LED_Smoke.kicad_sch`. This overwrites only the disposable candidate in this test package. First verify that the backup hash equals `manifest.json`'s `preparedCandidateBackupSha256`. Never use this procedure against a project outside this package.

## Safety and interpretation

- No changes are made to the owner's existing projects, machine-wide settings, registry, or security configuration.
- This verifies only this small passive LED/resistor fixture and the observed KiCad 10.0.7 behavior. It is not electrical/manufacturing approval.
- A passing ERC is a tool result, not a complete engineering review.
- Keep the result separate from the hosted Windows OpenGL limitation. Owner GUI acceptance remains NOT TESTED until the owner completes this checklist.
