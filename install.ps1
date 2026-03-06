# ─────────────────────────────────────────────────────────
#  AI Account Manager — Windows Installer
#  Usage (PowerShell):
#    irm https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.ps1 | iex
# ─────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$REPO = "devzoic/antigravity-lab"
$APP_NAME = "AI Account Manager"

Write-Host ""
Write-Host "  $APP_NAME — Windows Installer" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── Fetch latest release ──
Write-Host "▸ Fetching latest release..." -ForegroundColor Blue
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -UseBasicParsing
} catch {
    Write-Host "✖ Failed to fetch release info. Check your internet connection." -ForegroundColor Red
    exit 1
}

# ── Find NSIS .exe installer ──
$asset = $release.assets | Where-Object { $_.name -match "\.exe$" -and $_.name -notmatch "\.sig$" } | Select-Object -First 1

if (-not $asset) {
    # Fallback to .msi
    $asset = $release.assets | Where-Object { $_.name -match "\.msi$" } | Select-Object -First 1
}

if (-not $asset) {
    Write-Host "✖ No Windows installer found in the latest release." -ForegroundColor Red
    exit 1
}

$downloadUrl = $asset.browser_download_url
$fileName = $asset.name
$tempPath = Join-Path $env:TEMP $fileName

Write-Host "▸ Downloading: $fileName" -ForegroundColor Blue

# ── Download ──
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempPath -UseBasicParsing
    Write-Host "✔ Downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host "✖ Download failed: $_" -ForegroundColor Red
    exit 1
}

# ── Install ──
Write-Host "▸ Running installer..." -ForegroundColor Blue

if ($fileName -match "\.msi$") {
    Start-Process msiexec.exe -ArgumentList "/i", "`"$tempPath`"", "/quiet", "/norestart" -Wait
} else {
    # NSIS installer — run silently
    Start-Process -FilePath $tempPath -ArgumentList "/S" -Wait
}

# ── Cleanup ──
Remove-Item $tempPath -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  ✔ $APP_NAME installed successfully!" -ForegroundColor Green
Write-Host "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  You can now find '$APP_NAME' in your Start Menu." -ForegroundColor Gray
Write-Host ""
