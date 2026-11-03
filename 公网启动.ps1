param([switch]$NoBrowser, [switch]$NoPause)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$env:PUBLIC_PORT = if ($env:PUBLIC_PORT) { $env:PUBLIC_PORT } else { '3100' }
$runtimeRoot = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node'
$runtimePnpm = Join-Path $runtimeRoot 'node_modules/pnpm/bin/pnpm.cjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $runtimeRoot 'bin/node.exe' }
# 桌面启动时的 PATH 可能与开发终端不同，显式补上已安装的 Node 目录。
$env:PATH = (Split-Path -Parent $nodeExe) + ';' + $env:PATH

function Invoke-PublicPackageManager {
  param([string[]]$Arguments)
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm @Arguments }
  elseif (Test-Path -LiteralPath $runtimePnpm) { & $nodeExe $runtimePnpm @Arguments }
  else { throw '请先安装 Node.js 22+ 和 pnpm 11。' }
  if ($LASTEXITCODE -ne 0) { throw '命令执行失败，请查看上方错误。' }
}
function Get-RunningWebsite {
  try {
    $state = Get-Content -LiteralPath '.local/public-server.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.root -ne $PSScriptRoot -or $state.port -ne [int]$env:PUBLIC_PORT) { return $null }
    if ($state.url -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') { return $null }
    if (!(Get-Process -Id $state.pid -ErrorAction SilentlyContinue)) { return $null }
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$($state.port)" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) { return $state.url }
  } catch { return $null }
  return $null
}
function Open-Website([string]$Url) {
  if (!$NoBrowser) { Start-Process -FilePath $Url }
}

# 同一项目只允许一个启动窗口，避免重复迁移、构建和创建隧道。
$hasMutex = $false
$mutex = $null
try {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $key = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot))).Replace('-', '') }
  finally { $sha.Dispose() }
  $mutex = New-Object System.Threading.Mutex($false, "Local\GradeTools_$key")
  try { $hasMutex = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $hasMutex = $true }
  $existing = Get-RunningWebsite
  if ($existing) {
    Write-Host "网站已在运行，无需重复启动：$existing" -ForegroundColor Green
    Open-Website $existing
    return
  }
  if (!$hasMutex) {
    Write-Host '网站正在另一个窗口启动，请稍候；准备好后会自动打开浏览器。'
    return
  }
  if (!(Test-Path -LiteralPath $nodeExe)) { throw '未找到 Node.js，请先安装 Node.js 22 或更新版本。' }
  # 在迁移和构建前检查端口，避免影响另一个正在运行的服务。
  & $nodeExe -e "const net=require('node:net');const s=net.createServer();s.once('error',()=>process.exit(1));s.listen(Number(process.env.PUBLIC_PORT),'127.0.0.1',()=>s.close());"
  if ($LASTEXITCODE -ne 0) { throw '网站端口已占用，请先在原启动窗口按 Ctrl+C 停止服务后再试。' }
  Write-Host '正在启动年级工具，请稍候，完成后自动打开网页。' -ForegroundColor Green
  Write-Host '这个窗口需保持运行，可以最小化。按 Ctrl+C 停止网站和公网连接。'
  if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
  if (!(Test-Path -LiteralPath 'node_modules/next')) { Invoke-PublicPackageManager -Arguments @('install', '--frozen-lockfile') }
  Invoke-PublicPackageManager -Arguments @('run', 'db:setup')
  Invoke-PublicPackageManager -Arguments @('run', 'public:prepare')
  Invoke-PublicPackageManager -Arguments @('run', 'build')
  $arguments = @('scripts/public-server.mjs')
  if (!$NoBrowser) { $arguments += '--open' }
  & $nodeExe @arguments
  if ($LASTEXITCODE -ne 0) { throw '网站已停止或启动失败，请查看上方错误信息。' }
} catch {
  Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
  if (!$NoPause) { Read-Host '按回车键关闭窗口' | Out-Null }
  exit 1
} finally {
  if ($hasMutex -and $mutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
