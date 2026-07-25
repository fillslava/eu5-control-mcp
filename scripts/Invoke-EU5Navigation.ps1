<#
.SYNOPSIS
Sends one allowlisted navigation shortcut to the foreground EU5 window.

.DESCRIPTION
Finds the visible, unowned top-level window belonging to eu5.exe, brings that
window to the foreground, confirms that the foreground window and PID still
match, and sends one fixed Ctrl+function-key chord through Win32 SendInput.

This script does not accept arbitrary keys, coordinates, process names, window
titles, or command strings. A successful result means only that input was sent
to a confirmed EU5 foreground window. The caller must inspect the visible game
UI to verify the expected navigation result.

.EXAMPLE
.\Invoke-EU5Navigation.ps1 -Command open_economy
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        'focus_capital',
        'open_economy',
        'open_diplomacy',
        'open_military',
        'open_alerts',
        'find_province'
    )]
    [string] $Command
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:EU5NavigationCatalog = [ordered] @{
    focus_capital  = [pscustomobject] @{
        hotkey                = 'ctrl+f11'
        expectedVisibleResult = "The map camera centers on the controlled country's capital."
    }
    open_economy   = [pscustomobject] @{
        hotkey                = 'ctrl+f2'
        expectedVisibleResult = 'The Economy panel is open.'
    }
    open_diplomacy = [pscustomobject] @{
        hotkey                = 'ctrl+f5'
        expectedVisibleResult = 'The Diplomacy panel is open.'
    }
    open_military  = [pscustomobject] @{
        hotkey                = 'ctrl+f6'
        expectedVisibleResult = 'The Military panel is open.'
    }
    open_alerts    = [pscustomobject] @{
        hotkey                = 'ctrl+f9'
        expectedVisibleResult = 'The alerts menu is visible.'
    }
    find_province  = [pscustomobject] @{
        hotkey                = 'ctrl+f10'
        expectedVisibleResult = 'The province search interface is open without selecting a result.'
    }
}

if (-not ('EU5Navigation.Win32' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace EU5Navigation
{
    public static class Win32
    {
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const ushort VK_CONTROL = 0x11;
        private const uint GW_OWNER = 4;
        private const int SW_RESTORE = 9;

        private delegate bool EnumWindowsProc(IntPtr window, IntPtr state);

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct INPUTUNION
        {
            [FieldOffset(0)]
            public MOUSEINPUT mouse;

            [FieldOffset(0)]
            public KEYBDINPUT keyboard;

            [FieldOffset(0)]
            public HARDWAREINPUT hardware;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public INPUTUNION data;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindow(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsWindowVisible(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsIconic(IntPtr window);

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr window, uint command);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AttachThreadInput(
            uint idAttach,
            uint idAttachTo,
            [MarshalAs(UnmanagedType.Bool)] bool attach
        );

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindowAsync(IntPtr window, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool BringWindowToTop(IntPtr window);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int GetWindowTextLength(IntPtr window);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint count, INPUT[] inputs, int inputSize);

        public static IntPtr[] FindMainWindows(uint expectedProcessId)
        {
            List<IntPtr> windows = new List<IntPtr>();
            EnumWindowsProc callback = delegate(IntPtr window, IntPtr state)
            {
                uint actualProcessId;
                GetWindowThreadProcessId(window, out actualProcessId);
                if (
                    actualProcessId == expectedProcessId &&
                    IsWindow(window) &&
                    IsWindowVisible(window) &&
                    GetWindow(window, GW_OWNER) == IntPtr.Zero
                )
                {
                    windows.Add(window);
                }
                return true;
            };

            if (!EnumWindows(callback, IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "EnumWindows failed");
            }

            GC.KeepAlive(callback);
            return windows.ToArray();
        }

        public static string GetTitle(IntPtr window)
        {
            int length = GetWindowTextLength(window);
            StringBuilder title = new StringBuilder(Math.Max(length + 1, 2));
            GetWindowText(window, title, title.Capacity);
            return title.ToString();
        }

        public static bool IsExpectedForeground(IntPtr expectedWindow, uint expectedProcessId)
        {
            if (!IsWindow(expectedWindow) || GetForegroundWindow() != expectedWindow)
            {
                return false;
            }

            uint actualProcessId;
            GetWindowThreadProcessId(expectedWindow, out actualProcessId);
            return actualProcessId == expectedProcessId;
        }

        public static uint GetForegroundProcessId()
        {
            IntPtr foreground = GetForegroundWindow();
            if (foreground == IntPtr.Zero)
            {
                return 0;
            }

            uint processId;
            GetWindowThreadProcessId(foreground, out processId);
            return processId;
        }

        public static void RequestForeground(IntPtr targetWindow, uint expectedProcessId)
        {
            if (!IsWindow(targetWindow))
            {
                throw new InvalidOperationException("EU5_WINDOW_STALE: The selected EU5 window is no longer valid.");
            }

            uint actualProcessId;
            uint targetThreadId = GetWindowThreadProcessId(targetWindow, out actualProcessId);
            if (actualProcessId != expectedProcessId || targetThreadId == 0)
            {
                throw new InvalidOperationException("EU5_WINDOW_STALE: The selected EU5 window no longer belongs to the expected process.");
            }

            if (IsIconic(targetWindow))
            {
                ShowWindowAsync(targetWindow, SW_RESTORE);
            }

            if (IsExpectedForeground(targetWindow, expectedProcessId))
            {
                return;
            }

            uint currentThreadId = GetCurrentThreadId();
            IntPtr previousForeground = GetForegroundWindow();
            uint ignoredProcessId;
            uint foregroundThreadId = previousForeground == IntPtr.Zero
                ? 0
                : GetWindowThreadProcessId(previousForeground, out ignoredProcessId);

            bool attachedToForeground = false;
            bool attachedToTarget = false;
            try
            {
                if (foregroundThreadId != 0 && foregroundThreadId != currentThreadId)
                {
                    attachedToForeground = AttachThreadInput(currentThreadId, foregroundThreadId, true);
                }
                if (targetThreadId != currentThreadId && targetThreadId != foregroundThreadId)
                {
                    attachedToTarget = AttachThreadInput(currentThreadId, targetThreadId, true);
                }

                BringWindowToTop(targetWindow);
                SetForegroundWindow(targetWindow);
            }
            finally
            {
                if (attachedToTarget)
                {
                    AttachThreadInput(currentThreadId, targetThreadId, false);
                }
                if (attachedToForeground)
                {
                    AttachThreadInput(currentThreadId, foregroundThreadId, false);
                }
            }
        }

        public static uint SendNavigationCommand(
            IntPtr expectedWindow,
            uint expectedProcessId,
            string command
        )
        {
            ushort virtualKey;
            switch (command)
            {
                case "focus_capital":
                    virtualKey = 0x7A; // F11
                    break;
                case "open_economy":
                    virtualKey = 0x71; // F2
                    break;
                case "open_diplomacy":
                    virtualKey = 0x74; // F5
                    break;
                case "open_military":
                    virtualKey = 0x75; // F6
                    break;
                case "open_alerts":
                    virtualKey = 0x78; // F9
                    break;
                case "find_province":
                    virtualKey = 0x79; // F10
                    break;
                default:
                    throw new ArgumentOutOfRangeException("command", "Command is not on the EU5 navigation allowlist.");
            }

            // This is the final fail-closed focus/PID check immediately before
            // the input array is submitted.
            if (!IsExpectedForeground(expectedWindow, expectedProcessId))
            {
                throw new InvalidOperationException("EU5_FOCUS_LOST: EU5 was not the confirmed foreground window immediately before input.");
            }

            INPUT[] inputs = new INPUT[4];
            inputs[0] = KeyboardInput(VK_CONTROL, 0);
            inputs[1] = KeyboardInput(virtualKey, 0);
            inputs[2] = KeyboardInput(virtualKey, KEYEVENTF_KEYUP);
            inputs[3] = KeyboardInput(VK_CONTROL, KEYEVENTF_KEYUP);

            uint sent = SendInput(
                (uint)inputs.Length,
                inputs,
                Marshal.SizeOf(typeof(INPUT))
            );
            if (sent != inputs.Length)
            {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "EU5_INPUT_FAILED: SendInput did not submit the complete fixed chord."
                );
            }

            return sent;
        }

        private static INPUT KeyboardInput(ushort virtualKey, uint flags)
        {
            INPUT input = new INPUT();
            input.type = INPUT_KEYBOARD;
            input.data.keyboard.wVk = virtualKey;
            input.data.keyboard.dwFlags = flags;
            return input;
        }
    }
}
'@
}

function Write-EU5NavigationResult {
    param([Parameter(Mandatory = $true)][object] $Result)

    $Result | ConvertTo-Json -Depth 6 -Compress
}

function Invoke-EU5NavigationInternal {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'focus_capital',
            'open_economy',
            'open_diplomacy',
            'open_military',
            'open_alerts',
            'find_province'
        )]
        [string] $CommandName
    )

    $startedAtUtc = [DateTime]::UtcNow
    $target = $null

    try {
        if (-not $script:EU5NavigationCatalog.Contains($CommandName)) {
            throw "EU5_COMMAND_REJECTED: Command is not on the EU5 navigation allowlist."
        }
        $definition = $script:EU5NavigationCatalog[$CommandName]

        $processes = @(Get-Process -Name 'eu5' -ErrorAction SilentlyContinue)
        if ($processes.Count -eq 0) {
            throw 'EU5_NOT_RUNNING: No eu5.exe process is running.'
        }

        $windows = @(
            foreach ($process in $processes) {
                foreach ($window in [EU5Navigation.Win32]::FindMainWindows([uint32] $process.Id)) {
                    [pscustomobject] @{
                        process = $process
                        handle  = $window
                        title   = [EU5Navigation.Win32]::GetTitle($window)
                    }
                }
            }
        )

        if ($windows.Count -eq 0) {
            throw 'EU5_WINDOW_NOT_FOUND: eu5.exe has no visible, unowned top-level window.'
        }
        if ($windows.Count -ne 1) {
            throw "EU5_WINDOW_AMBIGUOUS: Found $($windows.Count) candidate EU5 windows; no input was sent."
        }

        $target = $windows[0]
        $targetPid = [uint32] $target.process.Id
        $targetHandle = [IntPtr] $target.handle

        [EU5Navigation.Win32]::RequestForeground($targetHandle, $targetPid)

        $focusConfirmed = $false
        $focusDeadline = [DateTime]::UtcNow.AddMilliseconds(1500)
        do {
            $focusConfirmed = [EU5Navigation.Win32]::IsExpectedForeground(
                $targetHandle,
                $targetPid
            )
            if (-not $focusConfirmed) {
                Start-Sleep -Milliseconds 50
            }
        } while (-not $focusConfirmed -and [DateTime]::UtcNow -lt $focusDeadline)

        if (-not $focusConfirmed) {
            throw 'EU5_FOCUS_FAILED: Could not confirm the EU5 window as foreground; no input was sent.'
        }

        $eventsSent = [EU5Navigation.Win32]::SendNavigationCommand(
            $targetHandle,
            $targetPid,
            $CommandName
        )
        $focusRetained = [EU5Navigation.Win32]::IsExpectedForeground(
            $targetHandle,
            $targetPid
        )

        Write-EU5NavigationResult -Result ([ordered] @{
            schemaVersion        = 1
            success              = $true
            command              = $CommandName
            hotkey               = $definition.hotkey
            target               = [ordered] @{
                processName = 'eu5'
                processId   = [int] $targetPid
                windowHandle = $targetHandle.ToInt64().ToString(
                    [System.Globalization.CultureInfo]::InvariantCulture
                )
                windowTitle = $target.title
            }
            focusConfirmed       = $true
            focusRetained        = $focusRetained
            input                = [ordered] @{
                method          = 'Win32.SendInput'
                eventsRequested = 4
                eventsSent      = [int] $eventsSent
            }
            expectedVisibleResult = $definition.expectedVisibleResult
            verificationRequired  = $true
            startedAtUtc           = $startedAtUtc.ToString('o')
            completedAtUtc         = [DateTime]::UtcNow.ToString('o')
        })
    }
    catch {
        $message = $_.Exception.Message
        $code = 'EU5_NAVIGATION_FAILED'
        if ($message -match '^(EU5_[A-Z_]+):\s*(?<detail>.*)$') {
            $code = $Matches[1]
            $message = $Matches['detail']
        }

        $targetDetails = $null
        if ($null -ne $target) {
            $targetDetails = [ordered] @{
                processName = 'eu5'
                processId   = [int] $target.process.Id
                windowHandle = ([IntPtr] $target.handle).ToInt64().ToString(
                    [System.Globalization.CultureInfo]::InvariantCulture
                )
                windowTitle = $target.title
            }
        }

        Write-EU5NavigationResult -Result ([ordered] @{
            schemaVersion    = 1
            success          = $false
            command          = $CommandName
            target           = $targetDetails
            focusConfirmed   = $false
            inputSent        = $false
            error            = [ordered] @{
                code    = $code
                message = $message
            }
            startedAtUtc     = $startedAtUtc.ToString('o')
            completedAtUtc   = [DateTime]::UtcNow.ToString('o')
        })
    }
}

# Dot-sourcing loads the native declarations and functions for non-UI tests.
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-EU5NavigationInternal -CommandName $Command
}
