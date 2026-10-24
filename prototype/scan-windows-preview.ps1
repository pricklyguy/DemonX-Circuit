param(
  [Parameter(Mandatory = $true)][string]$ScanPath,
  [Parameter(Mandatory = $true)][string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$scanRoot = (Resolve-Path -LiteralPath $ScanPath).Path
$reportFull = [System.IO.Path]::GetFullPath($ReportPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportFull) | Out-Null
$native = Get-ChildItem -LiteralPath $scanRoot -File -Recurse | Where-Object { $_.Extension -match '^\.(exe|dll|node|com|bat|cmd|ps1|vbs|scr|sys|msi)$' }
$signatureReport = foreach ($file in $native) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  [pscustomobject]@{
    path = $file.FullName.Substring($scanRoot.Length).TrimStart('\', '/')
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    signatureStatus = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  }
}
$scanResult = [ordered]@{ status = 'INCONCLUSIVE'; scanner = 'Microsoft Defender Antivirus'; scanPath = $scanRoot; startedAtUtc = [DateTime]::UtcNow.ToString('o'); executableInventory = @($signatureReport); output = ''; exitCode = $null }
$platform = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
$scanner = Get-ChildItem -LiteralPath $platform -Filter MpCmdRun.exe -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $scanner) {
  $fallback = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
  if (Test-Path -LiteralPath $fallback) { $scanner = Get-Item -LiteralPath $fallback } else { $scanner = $null }
}
if ($scanner) {
  $output = & $scanner.FullName -Scan -ScanType 3 -File $scanRoot 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $scanResult.output = $output.Trim()
  $scanResult.exitCode = $exitCode
  if ($output -match '(?i)(found\s+[1-9]\d*\s+threats?|threats? found\s*:\s*[1-9]\d*|detected\s+[1-9]\d*\s+threats?)') {
    $scanResult.status = 'FAIL'
  } elseif ($exitCode -eq 0 -and $output -match '(?i)(no threats found|found\s+no threats?|found\s+0\s+threats?|threats? found\s*:\s*0|0 threats? detected)') {
    $scanResult.status = 'PASS'
  }
}
else { $scanResult.output = 'Defender command-line scanner was not found on this runner.' }
$scanResult.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
$json = $scanResult | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $reportFull -Value $json -Encoding utf8NoBOM
Write-Output $json
if ($scanResult.status -eq 'FAIL') { throw 'Microsoft Defender reported a malware detection in the extracted release package.' }
