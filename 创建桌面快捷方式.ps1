$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot '一键启动.cmd'
if (!(Test-Path -LiteralPath $entry)) { throw '未找到一键启动.cmd，请在完整项目中执行此脚本。' }
$desktopDirectory = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktopDirectory '年级工具-启动.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $entry
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = '启动年级工具，建立公网连接并自动打开网站。运行窗口可最小化，按 Ctrl+C 停止。'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "桌面快捷方式已创建：$shortcutPath"
