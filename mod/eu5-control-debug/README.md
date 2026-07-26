# EU5 Control Debug

This is a workspace-only, debug-only mod scaffold. It is not installed,
copied, linked, or enabled in the Europa Universalis V user mod directory.

The mod declares one static, country-scoped panel:
`eu5_control_debug_window` in `in_game/gui/eu5_control_debug.gui`. It has
three buttons whose only actions are fixed scripted-GUI procedures:

- `emit_ping` writes `EU5 Control Debug: emit_ping` with `debug_log`.
- `emit_player_scope` writes `EU5 Control Debug: emit_player_scope` with
  `debug_log`.
- `emit_state_snapshot` writes `EU5 Control Debug: emit_state_snapshot` with
  `debug_log`.

The panel contains no text entry, arbitrary command route, console-command
function, or state-changing effect. The scripted-GUI file uses UTF-8 with BOM,
matching the live engine lexer requirement observed for
`common/scripted_guis/*.txt`.

If a separately reviewed debug session enables the mod, the panel can be
created using `GUI.CreateWidget(eu5_control_debug,eu5_control_debug_window)`.
That creation step is intentionally not automated by this repository and does
not grant access to arbitrary console commands.

Do not install or enable this scaffold in a campaign. Any installation, GUI
attachment, or new diagnostic procedure requires separate review and explicit
authorization.
