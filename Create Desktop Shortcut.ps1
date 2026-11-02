# Creates a "ReflexQ" icon on the Windows desktop that opens the teacher screen
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host ""
Write-Host "  ReflexQ - desktop shortcut" -ForegroundColor Magenta
Write-Host ""
$url = Read-Host "  Paste your ReflexQ web address (for example https://reflexq-aiims.onrender.com)"
$url = $url.Trim().TrimEnd('/')
if ($url -eq '') { Write-Host "  No address entered." -ForegroundColor Red; Read-Host "  Press Enter to close"; exit }
if ($url -notmatch '^https?://') { $url = "https://$url" }
$url = $url -replace '/host$', ''

$appDir = Join-Path $env:LOCALAPPDATA 'ReflexQ'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $here 'reflexq.ico') (Join-Path $appDir 'reflexq.ico') -Force
Set-Content -Path (Join-Path $appDir 'address.txt') -Value $url
$icon = Join-Path $appDir 'reflexq.ico'
$desktop = [Environment]::GetFolderPath('Desktop')

$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $desktop 'ReflexQ.lnk'))
  $lnk.TargetPath = $browser
  $lnk.Arguments = "--app=$url/host --start-maximized"
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'ReflexQ live classroom quiz'
  $lnk.Save()
} else {
  $content = "[InternetShortcut]`r`nURL=$url/host`r`nIconFile=$icon`r`nIconIndex=0`r`n"
  Set-Content -Path (Join-Path $desktop 'ReflexQ.url') -Value $content
}
Write-Host ""
Write-Host "  Done! A ReflexQ icon is now on your desktop." -ForegroundColor Green
Write-Host "  It opens: $url/host"
Write-Host ""
Read-Host "  Press Enter to close"
