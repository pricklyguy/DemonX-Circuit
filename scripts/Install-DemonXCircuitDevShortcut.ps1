[CmdletBinding()]
param(
  [string]$Name = 'DemonX Circuit Dev'
)

$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'Start-DemonXCircuitDev.ps1'
$icon = Join-Path $PSScriptRoot '..\assets\DemonX_Icons\DemonX_Circuit\DemonX_Glowing_Board.ico'
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw "Launcher missing: $launcher" }
if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Official DemonX Circuit icon missing: $icon" }

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop "$Name.lnk"
$shortcut = $shell.CreateShortcut($shortcutPath)
$powershell = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $powershell) { $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source }
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -File `"$launcher`" -Watch"
$shortcut.WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$shortcut.IconLocation = "$((Resolve-Path $icon).Path),0"
$shortcut.Description = 'Build and launch the local DemonX Circuit development version.'
$shortcut.Save()
Write-Host "Created shortcut: $shortcutPath"
Write-Host "It builds the local checkout and records logs under build\dev\logs."
