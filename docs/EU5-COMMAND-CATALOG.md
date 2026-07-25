# EU5 scripted navigation command catalog

`scripts/Invoke-EU5Navigation.ps1` is a local, standalone Windows runner for a
finite set of EU5 navigation shortcuts. It is intended to be invoked directly
from a Windows MCP PowerShell session. It does not use the repository's nested
Windows-MCP client.

The runner never accepts an arbitrary process name, window title, key,
coordinate, click, or command. Its only input is one of the six command names
documented below.

## Preconditions

Before every invocation, the caller must visibly verify all of the following:

1. The intended EU5 campaign is open and paused.
2. No modal dialog is present.
3. No text-entry field is focused.
4. The reviewed Ctrl+function-key navigation binding profile is active.
5. One navigation shortcut, by itself, is appropriate for the current UI
   state.

The runner cannot observe the game's paused state, modal state, text-entry
focus, active binding profile, or resulting panel. It enforces only the
OS-level process, window, focus, command, and key restrictions described under
[Runner behavior](#runner-behavior).

## Allowlisted commands

All commands are navigation-only and have the `read_only` risk classification.
Opening a panel grants no authority to change values, issue orders, select a
search result, acknowledge an alert, advance time, save, load, or confirm an
action.

| Command | Fixed hotkey | Expected visible result | Additional caution |
|---|---|---|---|
| `focus_capital` | `Ctrl+F11` | The map camera centers on the controlled country's capital. | Camera movement only; verify the controlled country and final map position. |
| `open_economy` | `Ctrl+F2` | The Economy panel is open. | Read only; do not change sliders, loans, maintenance, construction, or other economic controls. |
| `open_diplomacy` | `Ctrl+F5` | The Diplomacy panel is open. | Read only; do not create, change, or confirm a diplomatic relation or action. |
| `open_military` | `Ctrl+F6` | The Military panel is open. | Read only; do not recruit, move, reorganize, automate, or issue an order. |
| `open_alerts` | `Ctrl+F9` | The alerts menu is visible. | The underlying EU5 action is a toggle. If the menu was already visible it may close, so verify the post-input state and do not acknowledge an alert. |
| `find_province` | `Ctrl+F10` | The province search interface is open without selecting a result. | The runner sends no text. Do not invoke while another text-entry field is focused, and do not select a result without separate authorization. |

## Invocation

Use the fixed script path and one command name:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File 'E:\AI\Games\EUV\scripts\Invoke-EU5Navigation.ps1' `
  -Command open_economy
```

`-ExecutionPolicy Bypass` is scoped to that child PowerShell process. It does
not change the machine or user execution policy. If the calling PowerShell
session already permits local scripts, direct invocation is also valid:

```powershell
& 'E:\AI\Games\EUV\scripts\Invoke-EU5Navigation.ps1' -Command open_economy
```

Any other command value is rejected by PowerShell parameter binding before the
runner can search for a window or send input.

## Runner behavior

For an allowlisted command, the runner performs this fixed sequence:

1. Query only processes named `eu5` (`eu5.exe`).
2. Enumerate visible, unowned top-level Win32 windows belonging to those
   process IDs.
3. Stop without input unless exactly one candidate window exists.
4. Request that window as the foreground window, restoring it first only if it
   is minimized.
5. Poll for at most 1.5 seconds for an exact foreground window-handle and PID
   match.
6. Recheck that exact handle and PID immediately inside the native input method.
7. Submit one four-event `SendInput` array: Ctrl down, the fixed function key
   down, the function key up, Ctrl up.
8. Return one compact JSON object. A successful result records the command,
   hotkey, PID, window handle, title, foreground confirmation, number of input
   events sent, expected visible result, and `verificationRequired: true`.

The native input method repeats the command allowlist and maps each name to a
fixed function-key virtual key. It exposes no generic key-sending method.

Failures such as no `eu5.exe`, no eligible window, multiple candidate windows,
a stale window, failure to confirm foreground focus, focus loss immediately
before input, or an incomplete `SendInput` call return `success: false` JSON.
No fallback process, window, coordinate, click, key, or command is attempted.

## Required postcondition

After any `success: true` result, capture or inspect the visible EU5 UI and
compare it with the command's expected result. `success: true` means only that
the complete fixed input array was submitted while the EU5 handle and PID were
confirmed as foreground; it does not prove that EU5 applied the binding or
displayed the expected panel.

Do not chain a second scripted command until that visible postcondition has
been checked.
