$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimePnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs'
function Invoke-PackageManager {
  param([string[]]$Arguments)
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm @Arguments }
  elseif (Test-Path -LiteralPath $runtimePnpm) { & node $runtimePnpm @Arguments }
  else { throw '未找到 pnpm。请先安装 Node.js 22+，然后运行 npm install -g pnpm@11.25.0' }
  if ($LASTEXITCODE -ne 0) { throw '命令执行失败，请查看上方错误信息。' }
}
if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (!(Test-Path -LiteralPath 'node_modules/next')) { Invoke-PackageManager -Arguments @('install','--frozen-lockfile') }
Invoke-PackageManager -Arguments @('run','db:setup')
Write-Host '打开浏览器访问 http://127.0.0.1:3000；按 Ctrl+C 停止。'
Invoke-PackageManager -Arguments @('run','dev')
