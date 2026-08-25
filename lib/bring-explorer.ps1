# dsh-plugin-admin: bring Explorer window to foreground
# Usage: powershell -File bring-explorer.ps1 -Path <absolute path>
param([Parameter(Mandatory=$true)][string]$Path)

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

$base = ($Path -replace '\\', '/').Split('/')[-1]
$script:pattern = [regex]::Escape($base) + '\s*-'
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

if ($target -ne [IntPtr]::Zero) {
  # Simulated ALT keypress grants foreground permission
  [Fr]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  [Fr]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Fr]::ShowWindow($target, 9) | Out-Null
  [Fr]::SetForegroundWindow($target) | Out-Null
  [Fr]::BringWindowToTop($target) | Out-Null
}