# Captnz Board — Windows .exe Build Script
$ErrorActionPreference = "Stop"

Write-Host "=== Building Captnz Board (Windows x64) ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed. Run: winget install -e --id OpenJS.NodeJS.LTS"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "Rust/Cargo is not installed. Run: winget install -e --id Rustlang.Rustup"
}

Write-Host "1/2 Installing frontend dependencies..." -ForegroundColor Yellow
npm install

Write-Host "2/2 Compiling Tauri v2 release binary & NSIS/MSI installer..." -ForegroundColor Yellow
npm run tauri build

Write-Host "`nBuild complete! Check:" -ForegroundColor Green
Write-Host "  src-tauri\target\release\bundle\nsis\Captnz Board_1.0.0_x64-setup.exe"
Write-Host "  src-tauri\target\release\captnz-board.exe"
