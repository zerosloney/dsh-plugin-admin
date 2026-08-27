# dsh-plugin-admin: bring Explorer window to foreground
# Usage: powershell -File bring-explorer.ps1 -Path <absolute path>
# Fail-soft contract: never waits on user input -- an empty/missing -Path
# must NOT hit a Mandatory prompt (this console is HIDDEN; the process
# would linger forever), so the parameter is optional and guarded below.
param([string]$Path = '')

$ErrorActionPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($Path)) { exit 0 }

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Fr {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@

# The title Explorer displays is the DISPLAY NAME of the revealed FOLDER:
# the folder itself -- or its PARENT when reveal ran `/select,<file>` on a
# file. Fall back to the last path segment when the item is gone/unreadable.
$base = $null
$item = Get-Item -LiteralPath $Path
if ($null -ne $item) {
  if ($item.PSIsContainer) { $base = $item.Name }
  else { $base = Split-Path -Leaf $item.DirectoryName }
} else {
  $segments = ($Path -replace '\\', '/').Split('/') | Where-Object { $_ }
  if ($segments.Count -gt 0) { $base = $segments[-1] }
}
if ([string]::IsNullOrWhiteSpace($base)) { exit 0 }

# Stock Windows 10/11 titles are the bare folder name; some shell addons
# append " - <suffix>". Anchor at start, make the dash clause optional so
# both shapes match, and prefix collisions ("Test" vs "Test 2") stay safe.
$script:pattern = '^' + [regex]::Escape($base) + '(?:\s*-|$)'
$script:found = [IntPtr]::Zero

function Find-Target {
  $script:found = [IntPtr]::Zero
  $cb = [Fr+EnumProc]{ param($h, $l)
    $sb = New-Object System.Text.StringBuilder 512
    [Fr]::GetWindowText($h, $sb, 512) | Out-Null
    $t = $sb.ToString()
    if ([Fr]::IsWindowVisible($h) -and $t -match $script:pattern) {
      $script:found = $h
      return $false
    }
    return $true
  }
  [Fr]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $script:found
}

$target = [IntPtr]::Zero
for ($i = 0; $i -lt 30; $i++) {
  $target = Find-Target
  if ($target -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 200
}

if ($target -eq [IntPtr]::Zero) { exit 1 }

# Simulated ALT keypress grants foreground permission
[Fr]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[Fr]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Fr]::ShowWindow($target, 9) | Out-Null
[Fr]::SetForegroundWindow($target) | Out-Null
[Fr]::BringWindowToTop($target) | Out-Null

# One debuggable line on stdout; the host pipe just drains it.
Write-Output ("raised:{0}" -f $target)
exit 0