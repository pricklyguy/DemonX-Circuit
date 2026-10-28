[CmdletBinding()]
param(
  [switch]$Watch
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$expectedRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildRoot = Join-Path $repoRoot 'build'
$devRoot = Join-Path $buildRoot 'dev'
$logRoot = Join-Path $devRoot 'logs'
$profileRoot = Join-Path $devRoot 'profile'
$null = New-Item -ItemType Directory -Force -Path $logRoot, $profileRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logRoot "circuit-dev-$stamp.log"

function Write-Log([string]$Text) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff zzz')] $Text"
  Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
  Write-Host $line
}

function Invoke-LoggedCommand([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  Write-Log "START ${Label}: $FilePath $($Arguments -join ' ')"
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $FilePath
  $info.WorkingDirectory = $repoRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.Arguments = (($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' ')
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw "$Label process failed to start: $FilePath" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  foreach ($line in ($stdout -split "`r?`n" | Where-Object { $_ })) { Write-Log "$Label OUT: $line" }
  foreach ($line in ($stderr -split "`r?`n" | Where-Object { $_ })) { Write-Log "$Label ERR: $line" }
  Write-Log "EXIT $Label code=$($process.ExitCode)"
  $code = $process.ExitCode
  $process.Dispose()
  return $code
}

function Get-SourceSignature {
  $items = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'desktop') -File -Recurse |
    Where-Object { $_.FullName -notmatch '[\\/]dist[\\/]' -and $_.Extension -in '.ts', '.html', '.css' } |
    Sort-Object FullName
  return ($items | ForEach-Object { "$($_.FullName):$($_.Length):$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"
}

try {
  $git = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
  if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { $git = (Get-Command git.exe -ErrorAction Stop).Source }
  $top = (& $git -C $repoRoot rev-parse --show-toplevel 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $top) { throw "The launcher folder is not a valid Git checkout: $repoRoot" }
  $top = (Resolve-Path -LiteralPath $top).Path
  if (-not [string]::Equals($top, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Repository path verification failed. Git reported '$top', expected '$expectedRoot'." }
  $branch = (& $git -C $repoRoot branch --show-current 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Could not determine the checked-out Git branch.' }
  $commit = (& $git -C $repoRoot rev-parse --short=12 HEAD 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $commit) { throw 'Could not determine the current Git commit.' }
  $worktreeOutput = (& $git -C $repoRoot status --porcelain 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Could not determine whether the working tree has local changes.' }
  $treeState = if ($worktreeOutput) { 'modified' } else { 'clean' }

  Write-Log 'DemonX Circuit local development launcher'
  Write-Log "Repository: $repoRoot"
  Write-Log "Build identity: $branch@$commit ($treeState working tree)"
  Write-Log "Automatic rebuild/reload: $([bool]$Watch) (unsaved schematic edits defer reload)"
  Write-Log "Isolated development profile: $profileRoot"
  Write-Log "Log file: $logPath"

  Get-ChildItem Env: | Where-Object { $_.Name -like 'DEMONX_CIRCUIT_ACCEPTANCE_*' -or $_.Name -eq 'DEMONX_CIRCUIT_USER_DATA' } | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" -ErrorAction SilentlyContinue }

  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $node) { throw 'Node.js was not found. Install the repository-required Node.js 24.x release, then relaunch.' }
  if (-not $npm) { throw 'npm.cmd was not found with Node.js. Repair the local Node.js installation and relaunch.' }
  $nodeVersion = (& $node --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "Unsupported Node.js version '$nodeVersion'; this repository requires Node.js 24.x." }
  $npmVersion = (& $npm --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "npm version check failed: $npmVersion" }
  $npmCli = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
  if (-not (Test-Path -LiteralPath $npmCli -PathType Leaf)) { throw "npm's CLI JavaScript file was not found next to Node.js: $npmCli" }
  Write-Log "Node.js $nodeVersion; npm $npmVersion"
  $electronExe = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'
  $tsc = Join-Path $repoRoot 'node_modules\typescript\bin\tsc'
  $esbuild = Join-Path $repoRoot 'node_modules\esbuild\bin\esbuild'
  foreach ($dependency in @($electronExe, $tsc, $esbuild)) {
    if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) { throw "Project dependencies are incomplete ($dependency). Run 'npm ci' from '$repoRoot' after reviewing package-lock.json." }
  }
  Write-Log 'Repository-local Electron, TypeScript, and esbuild dependencies: available'

  $kicadCandidates = @()
  $pathKiCad = Get-Command kicad-cli.exe -ErrorAction SilentlyContinue
  if ($pathKiCad -and $pathKiCad.Source) { $kicadCandidates += $pathKiCad.Source }
  $kicadBases = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
  if ($env:LOCALAPPDATA) { $kicadBases += Join-Path $env:LOCALAPPDATA 'Programs' }
  foreach ($base in $kicadBases) {
    if ($base) { $kicadCandidates += Join-Path $base 'KiCad\10.0\bin\kicad-cli.exe' }
  }
  $kicad = $kicadCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if ($kicad) {
    $kicadVersion = (Get-Item -LiteralPath $kicad).VersionInfo.ProductVersion
    Write-Log "KiCad CLI executable: $kicad (Windows file ProductVersion='$kicadVersion'; no CLI command run by launcher)"
    if ($kicadVersion -ne '10.0.7') { Write-Log "WARNING: KiCad 10.0.7 compatibility is unavailable; detected '$kicadVersion'." }
  } else { Write-Log 'KiCad CLI 10.0.7: NOT FOUND in standard Windows installation folders.' }

  $buildCode = Invoke-LoggedCommand -FilePath $node -Arguments @($npmCli, 'run', 'build') -Label 'BUILD'
  if ($buildCode -ne 0) { throw "TypeScript/renderer build failed with exit code $buildCode. See $logPath" }
  $env:DEMONX_CIRCUIT_DEV_MODE = '1'
  $env:DEMONX_CIRCUIT_DEV_BRANCH = $branch
  $env:DEMONX_CIRCUIT_DEV_COMMIT = $commit
  $env:DEMONX_CIRCUIT_DEV_TREE = $treeState
  $env:DEMONX_CIRCUIT_DEV_LOG = $logPath
  $env:DEMONX_CIRCUIT_DEV_USER_DATA = $profileRoot
  $env:DEMONX_CIRCUIT_DEV_REPO = $repoRoot

  $startSignature = Get-SourceSignature
  $info = [System.Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $electronExe
  $info.WorkingDirectory = $repoRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.Arguments = '"' + $repoRoot.Replace('"', '\"') + '"'
  $electron = [System.Diagnostics.Process]::new()
  $electron.StartInfo = $info
  Write-Log "START ELECTRON: $electronExe $repoRoot"
  if (-not $electron.Start()) { throw 'The project-local Electron executable did not start.' }
  $stdoutTask = $electron.StandardOutput.ReadToEndAsync()
  $stderrTask = $electron.StandardError.ReadToEndAsync()
  Write-Host "DemonX Circuit running: $branch@$commit ($treeState working tree)"
  Write-Host "Close the app normally. Development log: $logPath"
  $lastChange = Get-Date
  $observedSignature = $startSignature
  while (-not $electron.WaitForExit(500)) {
    if ($Watch) {
      $signature = Get-SourceSignature
      if ($signature -ne $observedSignature) {
        $lastChange = Get-Date
        $observedSignature = $signature
      } elseif (((Get-Date) - $lastChange).TotalMilliseconds -ge 900 -and $observedSignature -ne $startSignature) {
        $code = Invoke-LoggedCommand -FilePath $node -Arguments @($npmCli, 'run', 'build') -Label 'WATCH BUILD'
        if ($code -eq 0) { Write-Log 'Renderer update built; Electron will reload only after the schematic is saved.' }
        else { Write-Log "WATCH BUILD failed with exit code $code; previous built app remains open." }
        $startSignature = $observedSignature
        $lastChange = Get-Date
      }
    }
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  foreach ($line in ($stdout -split "`r?`n" | Where-Object { $_ })) { Write-Log "ELECTRON OUT: $line" }
  foreach ($line in ($stderr -split "`r?`n" | Where-Object { $_ })) { Write-Log "ELECTRON ERR: $line" }
  $electron.WaitForExit()
  $exitCode = $electron.ExitCode
  Write-Log "EXIT ELECTRON pid=$($electron.Id) code=$exitCode"
  $electron.Dispose()
  Write-Host "DemonX Circuit closed with exit code $exitCode. Log: $logPath"
  exit $exitCode
} catch {
  Write-Log "LAUNCHER ERROR: $($_.Exception.Message)"
  Write-Host "Launch failed. Log: $logPath" -ForegroundColor Red
  exit 1
}
