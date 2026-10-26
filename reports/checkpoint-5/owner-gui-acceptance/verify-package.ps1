$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
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

$failures = @()
foreach ($record in $manifest.files) {
  $path = Join-Path $root $record.path
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures += "Missing: $($record.path)"; continue }
  $actual = Get-CanonicalFileInfo $path
  if ($actual.bytes -ne $record.bytes -or $actual.sha256 -ne $record.sha256) {
    $failures += "Mismatch: $($record.path) expected $($record.sha256), got $($actual.sha256)"
  }
}
if ($failures.Count) {
  $failures | ForEach-Object { Write-Error $_ }
  throw "Package hash verification failed for $($failures.Count) file(s)."
}
Write-Output "PASS: $($manifest.files.Count) package files match manifest SHA-256 hashes (CRLF normalized to LF)."
