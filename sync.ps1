# 把插件目录重新挂进 web profile 的 node_modules（pnpm 有时会把 file: 依赖落成硬拷贝，
# 那样源码改动就不会同步到运行时）。任何时候跑一下这个脚本即可恢复"源码即运行时"。
$ErrorActionPreference = 'Stop'
$link = Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules\dsh-cost-pill'
if (Test-Path $link) { Remove-Item $link -Recurse -Force }
New-Item -ItemType Junction -Path $link -Target $PSScriptRoot | Out-Null
Write-Host "linked: $link -> $PSScriptRoot" -ForegroundColor Green
