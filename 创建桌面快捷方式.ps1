$ErrorActionPreference = 'Stop'
$desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
$shell = New-Object -ComObject WScript.Shell
foreach ($item in @(
  @{ Name = '年级工具-启动'; Script = '公网启动.ps1'; Description = '启动网站并打开当前公网网址。停止网站请使用桌面停止快捷方式。'; Icon = 13 },
  @{ Name = '年级工具-停止'; Script = '停止网站.ps1'; Description = '停止网站与公网连接，保留学生、任务和提交数据。'; Icon = 27 }
)) {
  $entry = Join-Path $PSScriptRoot $item.Script
  if (!(Test-Path -LiteralPath $entry)) { throw "未找到 $($item.Script)，请在完整项目中执行此脚本。" }
  $shortcutPath = Join-Path $desktopDirectory ($item.Name + '.lnk')
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = '-NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $entry + '"'
  $shortcut.WorkingDirectory = $PSScriptRoot
  $shortcut.Description = $item.Description
  $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,$($item.Icon)"
  $shortcut.WindowStyle = 1
  $shortcut.Save()
  Write-Host "桌面快捷方式已创建：$shortcutPath"
}
