# Windows development preview distribution

Status researched: 2026-10-24. This workflow produces an unsigned development preview, not a public production release.

## Independent security signals

The workflow reports these separately:

- **Dependency audit:** `npm audit` checks the locked Node dependency graph against the npm advisory database. The preview bundles a version-pinned Electron runtime.
- **Packaging integrity:** a file inventory checks the extracted package against the pinned Electron distribution, rejects unexpected executable-like files, and records SHA-256 hashes.
- **Microsoft Defender:** the unpacked portable directory is scanned, including the Electron executable and DLLs. A confirmed detection fails distribution. Missing scanner, denied scan, unrecognized output, or a nonzero scan without a confirmed threat is recorded as `INCONCLUSIVE`; that result is not represented as a clean scan.
- **Checksums:** SHA-256 files detect changes to the supplied bytes when compared against a separately trusted copy of the published checksum.
- **GitHub artifact attestation:** the supported `actions/attest` action binds the workflow identity and source repository/commit to the release ZIP digest. It attests provenance, not benign behavior.
- **Code signing:** signing identifies a publisher and supports file-integrity validation. This preview is intentionally unsigned because the owner has not approved a signing service or credentials.
- **Browser reputation:** Chrome/SmartScreen use reputation and download-risk signals beyond whether a ZIP is signed. No browser acceptance test has been performed; this work does not claim that Chrome warnings are fixed.

These signals address different questions. None alone establishes that software is malware-free or guarantees that Chrome will accept a download.

## Checkpoint 4 successful build evidence

- Build commit: `ff15e03115c155022e6131ee43c2a4d17d6af4d0` on `codex/demonx-circuit-foundation`; build date `2026-10-24`; package version `0.5.0`.
- [GitHub Actions run 40124011182](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40124011182) passed. The [Windows development-preview artifact](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40124011182/artifacts/12572795325) contains the portable ZIP, release manifest, checksum sidecars, Defender report, package-inventory evidence, native reports/exports and provenance status. The [packaged acceptance artifact](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40124011182/artifacts/12572965106) contains the 36-check report and actual dark/light screenshots. Artifacts expire `2026-11-23`.
- ZIP SHA-256: `7298020fe11b28393a726db6da49be3c2fcdea5db436e2570e36b41463a5269f` (`DemonX-Circuit-Windows-Preview-0.5.0.zip`). Primary executable SHA-256: `8e84549b05d27d444da2957653200d1e0ac287eff0fc5722b92835b9e0821a59` (`DemonX Circuit.exe`). The ZIP digest matches the attested subject.
- Dependency audit: `npm audit --audit-level=high`, 0 vulnerabilities. Package integrity: PASS, 113 packaged files. Microsoft Defender Antivirus: PASS; output states `found no threats`. These are point-in-time signals, not a guarantee of safety.
- GitHub provenance: PASS. `actions/attest@v4.2.2` created build provenance for ZIP SHA-256 `7298020fe11b28393a726db6da49be3c2fcdea5db436e2570e36b41463a5269f`; the Sigstore certificate and attestation were uploaded to Rekor and GitHub ([attestation 59463204](https://github.com/pricklyguy/DemonX-Circuit/attestations/59463204)).
- Authenticode signing: **UNSIGNED**. The app executable has no publisher signature. No public release was created. Chrome/browser reputation and owner-machine download/launch behavior remain **NOT TESTED**.
- Packaged Windows acceptance: 36 PASS, 0 FAIL, 0 NOT TESTED on GitHub-hosted Windows 2022 with KiCad 10.0.7 and ESPHome 2026.10.0. This includes real native project creation/reopen, native ERC/DRC, Gerber/Excellon/STEP, YAML validation, settings/theme persistence, and no renderer/preload exceptions. The ESP32 fixture remains **NOT APPROVED FOR MANUFACTURE**.

## Pinned Windows build inputs

- Windows runner: `windows-2022` (GitHub-hosted disposable runner).
- Node.js: `24.19.0`.
- Electron: `45.0.0`, locked in `package-lock.json`.
- KiCad verification runtime: official `kicad-10.0.7-x86_64.exe`, downloaded from the KiCad source-mirror release URL, checked against SHA-256 `ce3881b6a9188eb34ac1ebaaec7651149e8a025206410addfb11a1a9656ecf95`, and required to have a valid Authenticode signature from KiCad Services Corporation. Installation occurs only in the temporary GitHub runner for acceptance tests. Circuit never installs KiCad on a user’s machine.
- LED/resistor project fixture: generated and checked using the pinned KiCad 10.0.7 Linux container used by the native smoke workflow. The same workflow-run artifact feeds the Windows package; no old workflow run ID is used.
- ZIP entries are path-sorted and receive a fixed timestamp. Input actions, runtime versions, fixture image digest, and package file hashes are retained with the workflow evidence. The Windows runner image and compression implementation are hosted by GitHub, so bit-for-bit reproducibility across runner-image changes is not guaranteed.

## Download verification

Download the ZIP and its sidecars from the same GitHub Actions run. Keep the checksum file separate from the ZIP while verifying it.

```powershell
$zip = '.\DemonX-Circuit-Windows-Preview-0.5.0.zip'
$expected = (Get-Content '.\DemonX-Circuit-Windows-Preview-0.5.0.zip.sha256' -Raw).Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'ZIP SHA-256 mismatch' }
```

After extraction, compare `DemonX Circuit.exe` against `DemonX-Circuit-Windows-Preview-0.5.0.exe.sha256` (the executable checksum is for the file inside the extracted folder). The release manifest lists hashes for every packaged file, the ZIP, and the primary executable. An attacker who can replace both the ZIP and its checksum can replace both values, so obtain the checksum/manifest from the trusted GitHub Actions artifact page or verify the GitHub attestation as a separate provenance check. Do not treat an attestation as an antivirus verdict.

## Defender scan evidence

The workflow attempts a Microsoft Defender custom file scan over the fully extracted package before creating the ZIP. It stores Defender command output, exit code, scan times, and a signed/unsigned inventory with SHA-256 for every executable-like file. A confirmed positive detection is a failed workflow. An unavailable or ambiguous scanner is retained as `INCONCLUSIVE`, not a PASS. A failed package-integrity check or dependency audit fails the workflow.

The scan is one point-in-time check on the GitHub runner. It is not equivalent to a malware analysis, and another antivirus provider may classify the package differently.

## Signing options (owner decision required)

### Microsoft Artifact Signing

Microsoft currently offers Basic at $9.99/month with 5,000 signatures/month and Premium at $99.99/month with 100,000 signatures/month; excess signatures are priced at $0.005 each. It requires a paid Azure subscription and Microsoft identity validation before issuing a signing profile. Organization eligibility currently includes the US, Canada, EU, and UK; individual eligibility includes the US and Canada. Official documentation lists GitHub Actions / CI integration and no hardware token requirement. New publisher/file reputation still takes time to build, so signing does not promise immediate SmartScreen or Chrome acceptance.

### Conventional Authenticode certificate

Microsoft's current Windows app developer guidance estimates OV certificates at roughly $150–$300/year (other Microsoft packaging guidance gives a higher range depending on certificate and channel). Expect identity checks and allow time for issuance. Current OV certificate rules require the private key to be stored in an HSM or hardware token; CI integration therefore needs an approved signing provider/HSM workflow and carefully scoped credentials. SignTool supports SHA-256 signing and RFC 3161 timestamping. A valid signature establishes publisher/integrity information; it does not establish the program is safe or immediately trusted by SmartScreen.

No certificate purchase, paid account, secret, release signing, or public production release is authorized by this checkpoint.

## References

- [KiCad 10.0.7 release](https://www.kicad.org/blog/2026/10/KiCad-10.0.7-Release/)
- [KiCad Windows downloads and installer verification](https://www.kicad.org/download/windows/), [verification guide](https://www.kicad.org/help/windows-download-verification/)
- [Microsoft Windows code-signing options, eligibility and cost guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Microsoft Artifact Signing pricing tiers](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku), [FAQ and subscription requirements](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [GitHub `actions/attest`](https://github.com/actions/attest)
- [Microsoft Defender command-line scanning](https://learn.microsoft.com/en-us/defender-endpoint/command-line-arguments-microsoft-defender-antivirus)
- [Microsoft Defender PowerShell scanning](https://learn.microsoft.com/en-us/defender-endpoint/run-scan-microsoft-defender-antivirus)
- [Chrome download warnings](https://support.google.com/chrome/answer/6261569)
- [Microsoft SmartScreen reputation signals](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/)
