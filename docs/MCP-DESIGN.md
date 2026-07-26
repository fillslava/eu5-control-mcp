# EU5 MCP design

## Boundary

The base MCP service must treat EU5 as an external system. It may observe
local state and prepare or validate finite UI procedures, but it never sends
input. It must not edit save files, game scripts, or bindings to change a
campaign.

The workspace-only `mod/eu5-control-debug` scaffold is a separately bounded
test artifact. It is neither installed nor attached to a game GUI and contains
only an effect-free diagnostic definition. It does not relax the base MCP
boundary. Any installation, GUI attachment, console invocation, or externally
driven in-game action needs its own reviewed design and explicit approval.

## Tool families

| Family | Example | Default mode |
|---|---|---|
| State | `eu5.list_save_checkpoints` | Read-only |
| State | `eu5.get_country_snapshot` | Read-only, fixture-backed initially |
| Preview | `eu5.preview_action` | No UI input |
| Preparation | `eu5.prepare_navigation_command` | Returns an allowlisted direct Windows MCP procedure |
| Validation | `eu5.issue_navigation_command` | Validates fresh UI evidence and returns a procedure; no UI input |

## Action contract

Every action has an identifier, a scope, preconditions, a risk class, an
expected visible result, and a post-action verification. The custom MCP rejects
stale evidence and returns only catalogued preparation procedures. Any direct
Windows MCP call is made by an external coordinator, outside this service, and
must be followed by fresh visible verification.

## Risk classes

- `read_only`: observe data or open a panel.
- `reversible`: close a panel, focus a location, select a map mode.
- `consequential`: recruitment, construction, diplomatic offers, economic
  slider changes and time advancement.
- `critical`: declaration of war, peace terms, loans, bankruptcy, subject or
  government changes, save/load/exit.

## First live workflows

1. Open and snapshot the economy panel.
2. Open the army panel and report recruitment prerequisites.
3. Open diplomacy and preview an improve-relations target.

The first live workflow must not spend resources, move units, advance time, or
send a diplomatic action. This service only prepares or validates the
procedure; it does not execute the workflow.

## Debug-export candidates

In a debug-mode test session, the game console has observed export-oriented
commands for market capacity, market analysis, goods by market, diplomacy
statistics, and economy statistics. They are candidates for future read-only
workflows only. Before exposing one through MCP, verify its exact generated
file path and contents in a disposable test save, then parse the fixed output
without writing to it. No console command is treated as safe merely because it
appears in a command catalogue.
