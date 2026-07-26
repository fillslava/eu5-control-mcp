# EU5 Control Debug

This is a debug-only mod scaffold for a disposable, non-Ironman test campaign.
The current test workstation has a reviewed copy installed in the Europa
Universalis V user mod directory. Installation remains a separate deployment
step and must never target a normal campaign playset.

The mod declares one static, country-scoped panel:
`eu5_control_debug_window` in `in_game/gui/eu5_control_debug.gui`. It has
three buttons whose only actions are fixed scripted-GUI procedures:

- `emit_ping` writes one `bridge_health` record with `debug_log`.
- `emit_player_scope` writes one `player_scope` record with `debug_log`.
- `emit_state_snapshot` writes one `state_snapshot` record with `debug_log`.

Every recognized record is a single line beginning with `EU5_CONTROL ` and a
JSON object using schema `eu5.control-log/v1`. It contains the fixed procedure,
mod version, `status: "acknowledged"`, and
`observationJoinRequired: true`.

Live testing against EU5 1.3.11 showed that putting
`[ROOT.GetNameWithNoTooltip]` or `[GetDateString]` inside `debug_log` causes a
`pdx_data_localize Data error`; it does not produce a usable record. The
script-effect API also documents no pause-state trigger. Those dynamic fields
are therefore not emitted by the mod. The external collector must join the
fixed acknowledgement to a fresh screenshot/save observation for country,
date, and pause state, retaining the source and verification status. The panel
itself may show live country/date and paused/running status because those
functions are supported in GUI expressions; the visible text is not claimed
as structured telemetry.

The panel contains no text entry, arbitrary command route, console-command
function, or state-changing effect. It uses the native EU5 1.3 GUI syntax and
the scripted-GUI file uses UTF-8 with BOM, matching the live engine lexer
requirement observed for `common/scripted_guis/*.txt`.

After a separately reviewed debug session enables the mod, the verified panel
invocation sequence is:

1. Focus the unique `eu5.exe` window.
2. Press `Alt+C`, the layout-stable alternate console binding in the shipped
   `loading_screen/input_profile/default.profile`.
3. Enter
   `GUI.CreateWidget gui/eu5_control_debug.gui eu5_control_debug_window`.
4. Visually verify the `EU5 Control Debug` panel before pressing a button.

Creation is reliable in a `-debug_mode` test session. A live EU5 1.3.11 test
proved that a top-level `window` does not handle the `on_start` callback
property: it rejects the window properties and leaves the visible child
buttons nonfunctional. Version 0.2.2 therefore has no window callback. Press
the fixed **Emit ping** button after visually verifying the panel to obtain the
health acknowledgement.

Version 0.2.3 also matches the shipped scripted-GUI registration shape: each
named entry contains only `effect = { ... }`. Live 0.2.2 testing proved that
the window and physical clicks worked but entries carrying the optional
`scope`, `is_shown`, and `is_valid` fields did not dispatch. Those fields have
been removed. The bridge still exposes only the same three fixed effects.

EU5 1.3 does not expose a documented, narrow mod hook that can attach a new
top-level widget to an already loaded normal-game HUD without replacing a base
GUI file. This repository therefore does not claim automatic attachment in a
normal campaign and does not replace `ingame_topbar.gui`. The creation step
does not grant access to arbitrary console commands.

After copying an updated mod build, fully restart EU5 so both the GUI and
`common/scripted_guis` database are rebuilt. Codex does not need a restart.

Do not install or enable this scaffold in a normal campaign. Any installation,
GUI attachment, or new diagnostic procedure requires separate review and
explicit authorization.
