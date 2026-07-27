<#
.SYNOPSIS
  Run a .bat/.cmd script, show its output live, and write the same output to a
  UTF-8 log file.

.DESCRIPTION
  cmd.exe has no `tee`, and piping a .bat through PowerShell inline from a .bat
  mangles the quoting of paths that contain spaces. This wrapper takes the two
  paths as bound parameters instead, so no quoting is built by hand, and it
  propagates the script's exit code to the caller.

  Used by the one-click Windows installer to keep a transcript of the setup
  phase: without it a failed install is unreadable once the console is closed.

.PARAMETER Script
  Full path of the .bat/.cmd file to run.

.PARAMETER LogFile
  Full path of the log file to write. Existing content is kept (append).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File run-with-log.ps1 `
    -Script "C:\ws\scripts\setup\setup-windows.bat" -LogFile "C:\ws\install-log.txt"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Script,
  [Parameter(Mandatory = $true)][string]$LogFile
)

$ErrorActionPreference = 'Continue'

$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Windows PowerShell's Tee-Object has no -Encoding switch and writes UTF-16LE,
# which doubles the log size and leaves it unreadable to grep/tail on the support
# side. Write through an explicit UTF-8 (no BOM) writer instead, and pass every
# line on down the pipeline so the console still updates live.
$writer = [System.IO.StreamWriter]::new($LogFile, $true, [System.Text.UTF8Encoding]::new($false))
$rc = 0
try {
  $writer.WriteLine("=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') run: $Script")
  # 2>&1 folds stderr into the pipeline. "$_" flattens it to plain text first:
  # Windows PowerShell wraps native stderr in an ErrorRecord, which would print
  # every warning inside a "NativeCommandError" block with a script trace.
  & cmd.exe /c $Script 2>&1 | ForEach-Object {
    $line = "$_"
    $writer.WriteLine($line)
    $writer.Flush()
    $line
  }
  # $LASTEXITCODE is set by cmd.exe above, not by the pipeline.
  if ($null -ne $LASTEXITCODE) { $rc = $LASTEXITCODE }
} finally {
  $writer.Dispose()
}

exit $rc
