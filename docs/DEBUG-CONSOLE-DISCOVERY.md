# EU5 Debug Console Discovery

Verified from a disposable Holland test campaign running with Steam launch
option `-debug_mode`.

## Debug-only diagnostics

The following console commands were present in the game's generated
`console.txt` and are suitable for discovery or diagnostics. They do not
directly change country, army, money, diplomacy, or time.

| Command | Verified behavior |
| --- | --- |
| `helplog` | Writes the installed-build console command catalogue. |
| `help <command>` | Prints documentation for one console command. |
| `script_docs` | Generates effects, triggers, event targets, modifiers, on-actions, and localization documentation. |
| `dump_data_types` | Dumps registered data types. |
| `log_viewer` / `log_status` | Opens diagnostic log UI. |
| `data_types_explorer` | Opens the data-types explorer. |
| `screenshot` | Captures a game screenshot. |
| `measure_frame_time start` / `stop` | Writes frame timing data to the debug log. |
| `io_stats` | Toggles I/O statistics. |

Generated sources on this machine are intentionally user-local and must not be
committed: `Documents/Paradox Interactive/Europa Universalis V/console.txt`,
`docs/*.log`, and `logs/data_types/*.txt`.

## Key implementation finding

The generated GUI data types document these functions:

- `ExecuteConsoleCommand(Arg0)`: execute one console command.
- `ExecuteConsoleCommands(Arg0)`: execute `;`-separated commands and stop on
  the first failing command.
- `ExecuteConsoleCommandsForced(Arg0)`: continue after a failing command.

`ScriptedGui` also exposes `Execute`, `IsShown`, and `IsValid`.

This supports a fixed diagnostic panel in a separately approved disposable
debug session: expose only named `debug_log` procedures through a scripted GUI,
rather than allowing arbitrary console text. The current workspace panel has
exactly `emit_ping`, `emit_player_scope`, and `emit_state_snapshot`; none changes
game state. The external MCP may inventory local evidence and record a proposed
action lifecycle, but it cannot execute UI input, invoke a console command, or
turn a debug procedure into normal-campaign control.

## Safety boundary

Do not use console commands that alter country control, territory, money,
armies, warfare, diplomacy, events, AI, laws, or the date in the normal
campaign. `-debug_mode` itself changes the checksum and disables achievement
conditions; remove it and all mods before returning to a clean campaign.

The current test workstation has a reviewed installed copy of the debug panel,
but it is not enabled or attached automatically. Its presence is not
authorization to run it, and it must never be used as an execution route in a
normal campaign.
