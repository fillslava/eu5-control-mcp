# EU5 MCP design

## Boundary

The MCP service must treat EU5 as an external system. It may observe local
state and request UI actions, but it must not edit save files, game scripts,
or bindings to change a campaign.

## Tool families

| Family | Example | Default mode |
|---|---|---|
| State | `eu5.list_save_checkpoints` | Read-only |
| State | `eu5.get_country_snapshot` | Read-only, fixture-backed initially |
| Preview | `eu5.preview_action` | No UI input |
| Control | `eu5.execute_action` | Confirmation-gated |

## Action contract

Every action has an identifier, a scope, preconditions, a risk class, an
expected visible result, and a post-action verification. `execute_action`
must reject actions not previously previewed, actions whose evidence is stale,
and actions marked `critical` without an explicit confirmation token.

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
send a diplomatic action.
