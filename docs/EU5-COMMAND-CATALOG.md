# EU5 navigation command catalog

This is the coordinator's working registry for EU5 navigation: it records the
only approved hotkeys, the expected screen, and the required visual check.
The custom EU5 MCP only prepares and validates finite procedures; it has no
nested Windows MCP client and never sends input. The Win32 script is not an
authoritative input route: it can test a procedure, but does not prove that EU5
accepted an input.

The machine-readable authoritative catalogue is
`src/control/control-procedure-catalog.js` with schema identifier
`eu5.control-procedure-catalog/v1`. It contains only named procedures:
`focus_game`, `pause`, `open_control_panel`, `dismiss_debug_console`,
`refresh_state`, `open_capital`, `economy`, `markets`, `diplomacy`, `military`,
`alerts`, `back`, and `close`.
Every entry fixes its target type, expected evidence, risk class, one-use
authorization, and idempotency rules. In v1 every authoritative catalogue
entry is a disabled candidate:
`dispatch` is `null`, `operationalStatus` is
`candidate_requires_live_proof`, and `nonOperationalReason` records the
missing proof.

`src/control/control-procedure-gate.js` rejects stale observations, ambiguous
or incorrectly focused windows, modals, focused text fields, test-session
mismatches, unexpected starting screens, and every route without live proof.
Missing acknowledgement or an inconclusive post-state would be
`execution_unknown` for a future admitted route; current disabled candidates
are rejected before dispatch or outcome verification.

The authoritative catalogue gate currently returns no dispatch metadata. Its
disabled status is not changed by the two semantic top-level MCP preparation
tools described below: those tools return bounded candidate instructions for
an external supervised executor, not catalogue admission or UI execution.
Neither surface authorizes MCP-to-MCP calls, arbitrary clicks, typing, console
text, effects, coordinates, or macros. A route may gain fixed direct Computer
Use metadata only after three clean live repetitions and independent review.

The semantic preparation helpers in
`src/control/click-navigation-procedures.js` never contain or return stored
coordinates. They are reachable through the finite read-only MCP tools
`eu5_prepare_panel_interaction` and `eu5_prepare_console_dismiss`. The tools
prepare external Computer Use steps but never execute UI input. A panel click
is prepared only from the exact enabled label found in the current fresh
screenshot. A panel may move anywhere in the EU5 window; its old bounds are
irrelevant and must not be reused. Both tools enforce the same bounded
control-observation safety context as the authoritative gate: exactly one
matching visible EU5 window, confirmed foreground focus, no modal, no focused
text-entry field, and matching disposable test marker, reviewed game build,
and reviewed mod manifest.

### Movable EU5 Control panel protocol

Before any fixed read-only panel button is prepared:

1. Capture a new screenshot of the unique focused EU5 window.
2. Positively identify the visible `EU5 Control Debug` panel.
3. Positively observe that the debug console is closed
   (`consoleVisible=false`, `consoleClosed=true`).
4. Locate the exact enabled button label in that screenshot.
5. Use only the semantic visible-control locator from that observation.
6. Capture fresh post-action evidence and verify the expected debug record.

The finite read-only labels are `Emit ping`, `Emit player scope`,
`Emit state snapshot`, `Export nation summary`, `Export economy`,
`Export capital market`, `Export diplomacy`, and `Export military`.
No generic label, arbitrary text, console command, coordinate, or key macro is
accepted.

If the console is positively observed as visible, the only named dismissal
step is `dismiss_debug_console`: one reviewed `Backquote` key press. It cannot
be prepared when console visibility is false or unknown. After that key press,
capture a new screenshot and positively verify that the console is closed
before preparing a panel button. Never combine dismissal and clicking into one
macro, and never retry either step automatically.

## Current input status (2026-07-26)

The reviewed `agent-ctrl-fkeys.bindings` profile works when the user presses
`Ctrl+F2` and `Ctrl+F5` on the physical keyboard. In this test environment,
EU5 ignored both the direct Windows MCP shortcut path and the target-window
Computer Use keyboard path after each had identified and activated the unique
`eu5.exe` window. Treat both as **non-operational** for EU5 keyboard control
until an alternative input driver produces a visible, repeatable result.

Some target-window clicks were observed historically on one 1536x900 layout,
but that calibration is not a coordinate-free semantic route and did not pass
the required live-proof gate. The MCP therefore withholds the coordinates and
returns no click procedure.

| Candidate family | Current status |
|---|---|
| Top-level game navigation clicks | Disabled legacy viewport metadata only; `eu5_prepare_click_navigation` stores and returns no coordinates or dispatch. |
| Ctrl+function-key bindings | Disabled for programmatic input; physical-key observations do not prove Computer Use delivery. |
| EU5 Control panel opener | Disabled; no persistent visible opener exists. |
| Debug-console dismissal | Top-level MCP can prepare one named `Backquote` candidate only after the full safe observation and positive console-visible state; catalogue admission is still pending live proof. |
| EU5 Control panel buttons | Top-level MCP can prepare an exact-label candidate only after the full safe observation, a fresh screenshot, and positively closed console; catalogue admission is still pending live proof. |

### Verified inner route

From the Economy panel, the **Markets** tab opens the market overview. This is
a read-only route and is only valid after visually confirming that Economy is
open on the primary monitor.

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

## Operational invocation

There is currently no operational invocation. Catalogue lookup returns
disabled metadata only. It never returns a hotkey tool call, click coordinate,
or dispatch instruction. Admission requires a future coordinate-free route,
three clean live repetitions, and independent review.

## Experimental Win32 runner

`scripts/Invoke-EU5Navigation.ps1` remains an experimental diagnostic tool. It
may confirm Win32 focus and `SendInput`, but EU5 can still ignore that synthetic
input. Do not use it as the operational control path unless a visible UI check
confirms the result.

Use the fixed script path and one command name only for that diagnostic:

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
