# Exact owner schematic verification

Run this utility against the KiCad schematic from the owner's disposable Windows acceptance package. It reads the selected file in place, computes its SHA-256 before and after, imports it through DemonX's constrained KiCad adapter, checks the expected value and pin groups, routes display geometry, and—when KiCad CLI 10.0.7 is available—exports a native netlist and runs ERC. KiCad outputs and reports are placed in a fresh temporary directory. The source schematic is never rewritten, and an optional JSON report is created with create-new semantics so it cannot overwrite an existing report.

From the repository root in PowerShell:

```powershell
npm ci
npm run verify:owner-schematic -- "C:\path\to\disposable-test-package\candidate\DemonX-Circuit-Project-3.kicad_sch"
```

The command builds the adapter first. To select a nonstandard KiCad 10.0.7 CLI path or preserve a JSON report outside the source package:

```powershell
npm run verify:owner-schematic -- "C:\path\to\candidate.kicad_sch" `
  --kicad-cli "C:\Program Files\KiCad\10.0\bin\kicad-cli.exe" `
  --report "$env:TEMP\DemonX-owner-check.json"
```

The report has separate classifications for semantic electrical connectivity, display-route geometry, unsupported native constructs, native KiCad ERC, and revision freshness. `NOT TESTED` is retained when a prerequisite is unavailable. Exit code 0 means the R1 value, semantic and native net groups, route checks, and available native checks all pass; 1 means a check failed; 2 means the input could not be safely opened/imported or its bytes changed.

The exact accepted CI fixture in `reports/checkpoint-5/owner-gui-acceptance/candidate/` is R1=470 and is **not** the owner's KiCad-saved R1=510 file. `reports/checkpoint-5/owner-short-correction/project/` is an adapter-generated R1=510 verification copy, not that owner file either. Do not use either as a substitute when recording the owner's actual file hash. The owner must run the command against the original local file; the generated report records its content hash without uploading it.

KiCad CLI can emit per-user configuration access warnings while starting. In the restricted development environment it reported access denied for registry/preferences and still returned a real netlist and ERC report. This utility does not change Windows ACLs, registry values, or KiCad security settings. A user who requires a clean OS profile should perform the check in a disposable Windows account or VM.
