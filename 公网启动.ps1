$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimePnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs'
function Invoke-PublicPackageManager {
  param([string[]]$Arguments)
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { & pnpm @Arguments }
  elseif (Test-Path -LiteralPath $runtimePnpm) { & node $runtimePnpm @Arguments }
  else { throw '请先安装 Node.js 22+ 和 pnpm 11。' }
  if ($LASTEXITCODE -ne 0) { throw '命令执行失败，请查看上方错误。' }
}
if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (!(Test-Path -LiteralPath 'node_modules/next')) { Invoke-PublicPackageManager -Arguments @('install','--frozen-lockfile') }
Invoke-PublicPackageManager -Arguments @('run','db:setup')
Invoke-PublicPackageManager -Arguments @('run','public:prepare')
Invoke-PublicPackageManager -Arguments @('run','build')
Invoke-PublicPackageManager -Arguments @('run','public:start')
