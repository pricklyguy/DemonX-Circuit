# DemonX Circuit — Owner KiCad GUI Acceptance

The fixture is disposable. First copy or extract the entire package into a new writable temporary directory (for example `%TEMP%\DemonX-Circuit-GUI-Acceptance-<date>`). Do not extract over an existing project. Keep the `original` and `candidate` folders separate; edit only the candidate.

## Prerequisites

- KiCad 10.0.7 installed by the owner.
- Windows PowerShell 5.1 or later.
- DemonX Circuit preview for the final reimport check.

## Steps

1. From the copied package root, verify every file against `manifest.json`:

   ```powershell
   .\verify-package.ps1
   ```

   The verifier hashes canonical LF bytes, so it also works from a Windows Git checkout with CRLF working files. Stop if any file is missing or differs before testing.

2. Open `candidate\DemonX-Circuit-Project-3.kicad_pro` in KiCad Manager, or open `candidate\DemonX-Circuit-Project-3.kicad_sch` with KiCad's schematic editor. Do not edit `original`.

3. Confirm visible references and values: D1=`RED LED`, J1=`5V INPUT`, R1=`470`. Confirm the candidate has the manifest's edited R1 position `(52,42) mm` and rotation `90°`. Inspect the actual wires and pin identities. The staged change is meaningful: R1 pin 1 and pin 2 exchange nets. The expected original groups are `D1.1–R1.2`, `D1.2–J1.2`, `J1.1–R1.1`; the candidate groups are `D1.1–R1.1`, `D1.2–J1.2`, `J1.1–R1.2`.

4. Make one reversible GUI test edit in the candidate: change R1 from `470` to `510`, save, close the schematic editor, and reopen the candidate. Confirm R1 remains `510`, and the references and wires remain editable and visible. This is a disposable copy; the original folder stays untouched.

5. From PowerShell at the copied package root, run native KiCad checks against the original and the saved candidate:

   ```powershell
   .\verify-after-save.ps1 -KiCadCli 'C:\Program Files\KiCad\10.0\bin\kicad-cli.exe'
   ```

   If installed elsewhere, pass the actual `kicad-cli.exe` path. The script requires version 10.0.7, exports both native netlists, compares each with its expected connectivity, checks that the original and candidate remain topologically distinct, confirms candidate R1 is `510`, and runs ERC on the saved candidate. It does not modify the schematics. Inspect the newly generated `.net` files and ERC report under `owner-results/`, not only `summary.json`.

6. Open the candidate project in DemonX Circuit and choose **Open Circuit Schematic**. Confirm R1=`510` and that the same three candidate pin groups are shown. Record whether DemonX successfully reimports the KiCad-saved document. A failure should be recorded with logs; do not overwrite either prepared fixture.

7. Capture screenshots of the KiCad candidate before and after the reversible edit and the DemonX reimport. Store them and the CLI reports in the copied temporary package. Fill in every checklist row below with PASS, FAIL, or NOT TESTED and a short evidence reference.

## Results (owner fills in)

| Check | Result | Evidence / notes |
|---|---|---|
| Package file hashes match manifest before testing | NOT TESTED | |
| Candidate opens in KiCad 10.0.7 graphical editor | NOT TESTED | |
| References, values, position, and rotation display as expected | NOT TESTED | |
| Candidate wires match the expected changed pin groups | NOT TESTED | |
| R1 470→510 edit saves and survives KiCad close/reopen | NOT TESTED | |
| Original project remains unchanged | NOT TESTED | |
| KiCad native netlists match original and candidate expected groups | NOT TESTED | |
| Candidate ERC completes with exit code 0 and no violations | NOT TESTED | |
| KiCad-saved candidate reopens in DemonX with the same connectivity | NOT TESTED | |
| Screenshots and fresh reports retained in the temporary copy | NOT TESTED | |

## Restore the candidate copy

After recording results and completing the reimport check, close KiCad. To reset only the disposable candidate to the exact staged design, first confirm `candidate/backups/DemonX-Circuit-Project-3.kicad_sch.gui-test-reset` matches `manifest.json`'s `preparedCandidateResetSha256`, then copy:

```powershell
Copy-Item -LiteralPath .\candidate\backups\DemonX-Circuit-Project-3.kicad_sch.gui-test-reset `
  -Destination .\candidate\DemonX-Circuit-Project-3.kicad_sch -Force
```

This overwrite applies only to the candidate inside the temporary package. Never use it against any project outside that package. `*.initial-candidate` is the original pre-approval rollback copy retained from CI; it is separately hash inventoried and is not the reset source for this GUI edit. The `original` fixture is not used for edits.

## Interpretation

- No machine-wide graphics, registry, security, or existing project settings are changed by this procedure.
- The fixture is a small LED/resistor schematic, not a manufacturing approval or full engineering review.
- ERC is one tool result, not proof of electrical suitability.
- Hosted native netlist/ERC checks passed. Hosted graphical opening is blocked by the runner's OpenGL 2.1 limitation. Owner GUI acceptance remains **NOT TESTED** until this checklist is completed.
