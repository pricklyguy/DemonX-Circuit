$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$utf8 = [System.Text.Encoding]::UTF8
function Get-CanonicalFileInfo([string] $Path) {
  $raw = [System.IO.File]::ReadAllBytes($Path)
  $normalized = New-Object 'System.Collections.Generic.List[byte]'
  for ($i = 0; $i -lt $raw.Length; $i++) {
    if ($raw[$i] -eq 13 -and $i + 1 -lt $raw.Length -and $raw[$i + 1] -eq 10) {
      $normalized.Add(10); $i++
    } else { $normalized.Add($raw[$i]) }
  }
  $canonical = $normalized.ToArray()
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $digest = [BitConverter]::ToString($sha.ComputeHash($canonical)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  return @{ bytes = $canonical.Length; sha256 = $digest }
}
$evidence = Get-Content -LiteralPath (Join-Path $root 'roundtrip-evidence.json') -Raw | ConvertFrom-Json
$originalSch = Get-ChildItem -LiteralPath (Join-Path $root 'original') -Filter '*.kicad_sch' -File | Select-Object -First 1
$candidateSch = Get-ChildItem -LiteralPath (Join-Path $root 'candidate') -Filter '*.kicad_sch' -File | Select-Object -First 1
if (-not $originalSch -or -not $candidateSch) { throw 'Original or candidate native schematic is missing.' }
if ((Get-FileHash -LiteralPath $originalSch.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $evidence.sourceSha256) { throw 'Original schematic does not match round-trip evidence.' }
if ((Get-FileHash -LiteralPath $candidateSch.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $evidence.candidateSha256) { throw 'Candidate schematic does not match accepted round-trip evidence.' }
$acceptanceBackup = Join-Path $root 'candidate/backups/DemonX-Circuit-Project-3.kicad_sch.initial-candidate'
$resetBackup = Join-Path $root 'candidate/backups/DemonX-Circuit-Project-3.kicad_sch.gui-test-reset'
if (-not (Test-Path -LiteralPath $acceptanceBackup -PathType Leaf)) { throw 'CI pre-approval backup is missing.' }
if (-not (Test-Path -LiteralPath $resetBackup -PathType Leaf)) { throw 'Prepared GUI-test reset copy is missing.' }
if ((Get-FileHash -LiteralPath $resetBackup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $evidence.candidateSha256) { throw 'GUI-test reset copy does not match the staged candidate.' }

$files = Get-ChildItem -LiteralPath $root -File -Recurse |
  Where-Object { $_.FullName -ne $manifestPath -and $_.FullName -notlike (Join-Path $root 'owner-results\*') } |
  Sort-Object { $_.FullName.Substring($root.Length).Replace('\','/') }
$records = @($files | ForEach-Object {
  $canonical = Get-CanonicalFileInfo $_.FullName
  [ordered]@{
    path = $_.FullName.Substring($root.Length).TrimStart('\').Replace('\','/')
    bytes = $canonical.bytes
    sha256 = $canonical.sha256
  }
})
$manifest = [ordered]@{
  format = 'demonx-circuit-owner-gui-acceptance'
  formatVersion = '1.1'
  status = 'PREPARED; owner GUI acceptance NOT TESTED'
  testedSourceCommit = $evidence.sourceCommit
  stageId = $evidence.stageId
  kicadVersion = '10.0.7'
  fixture = 'DemonX Circuit LED/resistor round-trip candidate'
  sourceEvidence = 'Packaged Windows native round-trip acceptance; workflow run 40318330198'
  nativeSchematicNames = @{ original = $originalSch.Name; candidate = $candidateSch.Name }
  sourceSchematicSha256 = $evidence.sourceSha256
  stagedCandidateSha256 = $evidence.candidateSha256
  nativeValidation = @{
    originalNetlistMatches = $evidence.validation.originalNetlist.matches
    candidateNetlistMatches = $evidence.validation.candidateNetlist.matches
    candidateErcExitCode = $evidence.validation.erc.exitCode
    candidateNetGroups = $evidence.candidateConnectivity
    originalNetGroups = $evidence.originalConnectivity
    hostedGraphicalOpen = 'BLOCKED: hosted Windows runner has no OpenGL 2.1 support'
    ownerGraphicalOpen = 'NOT TESTED'
  }
  files = $records
  expectedComponents = @(
    @{ reference = 'D1'; originalValue = 'RED LED'; candidateValue = 'RED LED' },
    @{ reference = 'J1'; originalValue = '5V INPUT'; candidateValue = '5V INPUT' },
    @{ reference = 'R1'; originalValue = '330'; candidateValue = '470'; originalPositionMm = $evidence.expectedComponents[2].originalPositionMm; candidatePositionMm = $evidence.expectedComponents[2].candidatePositionMm; originalRotation = $evidence.expectedComponents[2].originalRotation; candidateRotation = $evidence.expectedComponents[2].candidateRotation; ownerReversibleTestValue = '510' }
  )
  expectedConnectivity = @(
    @{ pins = @('D1.1','R1.2'); original = $true; stagedCandidate = $false },
    @{ pins = @('D1.1','R1.1'); original = $false; stagedCandidate = $true },
    @{ pins = @('D1.2','J1.2'); original = $true; stagedCandidate = $true },
    @{ pins = @('J1.1','R1.1'); original = $true; stagedCandidate = $false },
    @{ pins = @('J1.1','R1.2'); original = $false; stagedCandidate = $true }
  )
  observedNativeComparison = 'The accepted candidate is a meaningful topology change: it exchanges R1.1 and R1.2 between D1.1 and J1.1. Original and candidate KiCad native netlists independently match their expected pin groups; candidate ERC exited 0.'
  expectedOwnerRun = 'Open candidate in KiCad GUI, change R1 470 to 510, save and reopen; then verify distinct original/candidate pin groups and candidate ERC exit 0.'
  ciPreApprovalBackupSha256 = (Get-FileHash -LiteralPath $acceptanceBackup -Algorithm SHA256).Hash.ToLowerInvariant()
  preparedCandidateResetSha256 = (Get-FileHash -LiteralPath $resetBackup -Algorithm SHA256).Hash.ToLowerInvariant()
  filesHashAlgorithm = 'SHA-256'
  filesHashLineEndings = 'CRLF normalized to LF; inventory matches Git-stored/downloaded package content'
}
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Wrote $manifestPath with $($records.Count) hashed files."
