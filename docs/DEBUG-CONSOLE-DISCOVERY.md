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

This makes a debug-only EU5 mod a viable in-game execution layer: expose a
small fixed allowlist of diagnostic procedures through a scripted GUI, rather
than allowing arbitrary console text. The external MCP remains responsible for
reading saves/logs, choosing a named procedure, and requiring explicit policy
checks before any future state-changing procedure.

## Safety boundary

Do not use console commands that alter country control, territory, money,
armies, warfare, diplomacy, events, AI, laws, or the date in the normal
campaign. `-debug_mode` itself changes the checksum and disables achievement
conditions; remove it and all mods before returning to a clean campaign.
