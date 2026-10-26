$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$files = Get-ChildItem -LiteralPath $root -File -Recurse |
  Where-Object { $_.FullName -ne $manifestPath -and $_.FullName -notlike (Join-Path $root 'owner-results\*') } |
  Sort-Object { $_.FullName.Substring($root.Length).Replace('\','/') }
$records = @($files | ForEach-Object {
  [ordered]@{
    path = $_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    bytes = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
})
$manifest = [ordered]@{
  format = 'demonx-circuit-owner-gui-acceptance'
  formatVersion = '1.0'
  status = 'PREPARED; owner GUI acceptance NOT TESTED'
  testedSourceCommit = 'eaa7f89e4761b0e2b71bba3bd334e111187f02a9'
  kicadVersion = '10.0.7'
  fixture = 'DX_LED_Smoke'
  sourceEvidence = 'reports/checkpoint-5/native-roundtrip/validated-run; CI run 40271029212'
  files = $records
  expectedComponents = @(
    @{ reference = 'D1'; originalValue = 'RED LED'; candidateValue = 'RED LED' },
    @{ reference = 'J1'; originalValue = '5V INPUT'; candidateValue = '5V INPUT' },
    @{ reference = 'R1'; originalValue = '330'; candidateValue = '470'; ownerReversibleTestValue = '510' }
  )
  expectedConnectivity = @(
    @{ pins = @('D1.1','R1.2'); original = $true; stagedCandidate = $true },
    @{ pins = @('D1.2','J1.2'); original = $true; stagedCandidate = $true },
    @{ pins = @('J1.1','R1.1'); original = $true; stagedCandidate = $true }
  )
  observedNativeComparison = 'Preserved original.net and edited.net have the same pin-to-net groups. The retained staged native candidate does not demonstrate the semantic wiring change described in the earlier interaction acceptance; the owner GUI package does not claim otherwise.'
  expectedOwnerRun = 'After changing candidate R1 from 470 to 510 in KiCad and saving, the two netlists should match the listed connectivity; ERC should exit 0.'
  preparedCandidateBackupSha256 = (Get-FileHash -LiteralPath (Join-Path $root 'candidate/backups/DX_LED_Smoke.kicad_sch.initial-candidate') -Algorithm SHA256).Hash.ToLowerInvariant()
  filesHashAlgorithm = 'SHA-256'
}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Wrote $manifestPath with $($records.Count) hashed files."
