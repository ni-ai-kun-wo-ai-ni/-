param([switch]$NoPause)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  $nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
  if (!(Test-Path -LiteralPath $nodeExe)) { throw '未找到 Node.js，无法发送停止请求。' }
  & $nodeExe (Join-Path $PSScriptRoot 'scripts/stop-public.mjs')
  if ($LASTEXITCODE -ne 0) { throw '停止未完成，请查看上方提示。' }
} catch {
  Write-Host "停止失败：$($_.Exception.Message)" -ForegroundColor Red
  if (!$NoPause) { Read-Host '按回车关闭窗口' | Out-Null }
  exit 1
}
