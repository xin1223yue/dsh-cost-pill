# Thin wrapper around install.mjs so PowerShell users do not need `node` in the
# calling convention. Pass the same flags: --profile <name> / --dry-run.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install.mjs'
node $installer @args
exit $LASTEXITCODE
