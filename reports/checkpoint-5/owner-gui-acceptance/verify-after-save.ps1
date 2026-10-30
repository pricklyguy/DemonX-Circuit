param(
  [Parameter(Mandatory = $true)]
  [string] $KiCadCli
)

$ErrorActionPreference = 'Stop'
$cli = (Resolve-Path -LiteralPath $KiCadCli).Path
$version = (& $cli version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $version -ne '10.0.7') {
  throw "Expected KiCad CLI 10.0.7; got '$version' (exit $LASTEXITCODE). No verification was run."
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$originalDir = Join-Path $root 'original'
$candidateDir = Join-Path $root 'candidate'
$originalSch = Join-Path $originalDir $manifest.nativeSchematicNames.original
$candidateSch = Join-Path $candidateDir $manifest.nativeSchematicNames.candidate
foreach ($file in @($originalSch, $candidateSch)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required schematic missing: $file" }
}

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$reports = Join-Path $root "owner-results\$runId"
if (Test-Path -LiteralPath $reports) { throw "Report destination already exists; refusing to overwrite: $reports" }
New-Item -ItemType Directory -Path $reports -ErrorAction Stop | Out-Null
$originalNet = Join-Path $reports 'original.net'
$candidateNet = Join-Path $reports 'candidate.net'
$ercReport = Join-Path $reports 'candidate-erc.rpt'

function Invoke-KiCad([string[]] $Arguments, [string] $Label) {
  & $script:cli @Arguments
  $code = $LASTEXITCODE
  if ($code -ne 0) { throw "$Label failed with exit code $code. Reports, if created, are in '$reports'." }
}

Invoke-KiCad @('sch', 'export', 'netlist', '--format', 'kicadxml', '--output', $originalNet, $originalSch) 'Original netlist export'
Invoke-KiCad @('sch', 'export', 'netlist', '--format', 'kicadxml', '--output', $candidateNet, $candidateSch) 'Candidate netlist export'

function Get-NetGroups([string] $Path) {
  [xml]$xml = Get-Content -LiteralPath $Path -Raw
  $groups = @()
  foreach ($net in $xml.export.nets.net) {
    $pins = @($net.node | ForEach-Object { "$($_.ref).$($_.pin)" } | Sort-Object)
    if ($pins.Count -gt 0) { $groups += ,($pins -join ',') }
  }
  return @($groups | Sort-Object)
}

$expectedOriginal = @('D1.1,R1.2', 'D1.2,J1.2', 'J1.1,R1.1') | Sort-Object
$expectedCandidate = @('D1.1,R1.1', 'D1.2,J1.2', 'J1.1,R1.2') | Sort-Object
$actualOriginal = Get-NetGroups $originalNet
$actualCandidate = Get-NetGroups $candidateNet
$originalMatch = (@($actualOriginal) -join '|') -eq (@($expectedOriginal) -join '|')
$candidateMatch = (@($actualCandidate) -join '|') -eq (@($expectedCandidate) -join '|')
$topologyChanged = (@($actualOriginal) -join '|') -ne (@($actualCandidate) -join '|')

[xml]$candidateXml = Get-Content -LiteralPath $candidateNet -Raw
$r1 = @($candidateXml.export.components.comp | Where-Object { $_.ref -eq 'R1' }) | Select-Object -First 1
$valueMatch = $null -ne $r1 -and $r1.value -eq '510'

& $cli sch erc --severity-all --exit-code-violations --output $ercReport $candidateSch
$ercExit = $LASTEXITCODE
$summary = [ordered]@{
  status = if ($originalMatch -and $candidateMatch -and $topologyChanged -and $valueMatch -and $ercExit -eq 0) { 'PASS' } else { 'FAIL' }
  kicadCli = $cli
  kicadVersion = $version
  originalSchematicSha256 = (Get-FileHash -LiteralPath $originalSch -Algorithm SHA256).Hash.ToLowerInvariant()
  candidateSchematicSha256 = (Get-FileHash -LiteralPath $candidateSch -Algorithm SHA256).Hash.ToLowerInvariant()
  expectedOriginalNetGroups = $expectedOriginal
  expectedCandidateNetGroups = $expectedCandidate
  actualOriginalNetGroups = $actualOriginal
  actualCandidateNetGroups = $actualCandidate
  originalNetlistMatches = $originalMatch
  candidateNetlistMatches = $candidateMatch
  originalAndCandidateTopologyDiffer = $topologyChanged
  candidateR1Value = if ($r1) { [string]$r1.value } else { $null }
  expectedR1Value510 = $valueMatch
  ercExitCode = $ercExit
  reports = @{ netlistOriginal = $originalNet; netlistCandidate = $candidateNet; erc = $ercReport }
}
$summaryPath = Join-Path $reports 'summary.json'
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$summary | ConvertTo-Json -Depth 6
Write-Output "Reports: $reports"
if ($summary.status -ne 'PASS') { throw 'Owner acceptance checks did not match expected distinct connectivity/value or ERC returned violations. Inspect the saved reports.' }
