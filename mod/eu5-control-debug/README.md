# EU5 Control Debug

This is a debug-only mod scaffold for a disposable, non-Ironman test campaign.
The current test workstation has a reviewed copy installed in the Europa
Universalis V user mod directory. Installation remains a separate deployment
step and must never target a normal campaign playset.

The mod declares one static, country-scoped panel:
`eu5_control_debug_window` in `in_game/gui/eu5_control_debug.gui`. It has
eight buttons whose only actions are fixed scripted-GUI procedures:

- `emit_ping` writes one `bridge_health` record with `debug_log`.
- `emit_player_scope` writes one `player_scope` record with `debug_log`.
- `emit_state_snapshot` writes one `state_snapshot` record with `debug_log`.
- `emit_player_summary` writes a partial nation export plus typed facts.
- `emit_economy_snapshot` writes a partial economy export plus typed facts.
- `emit_markets_snapshot` writes a partial market export plus typed facts.
- `emit_diplomacy_snapshot` writes a partial diplomacy export plus typed facts.
- `emit_military_snapshot` writes a partial military export plus typed facts.

Every recognized record is a single line beginning with `EU5_CONTROL ` and a
JSON object using schema `eu5.control-log/v1`. It contains the fixed procedure,
mod version, `status: "acknowledged"`, and
`observationJoinRequired: true`.

Version 0.4.0 adds only read-only telemetry and panel-health presentation. The
locally generated EU5 1.3.11 script documentation and shipped game scripts
confirm the country-scope triggers used here: `at_war`, `is_subject`,
`monthly_balance`, `gold`, `has_markets`, `army_size`, `navy_size`, and
`can_raise_army_levies`. These yield categorical facts such as `atWar`,
`monthlyBalanceClass`, and `hasArmy`. Each fact is its own `telemetry_fact`
record so the consumer never has to parse localized prose.

EU5's generated effect documentation also explicitly permits `debug_log` to
resolve a localization key with `ROOT`, `SCOPE`, and `PREV`. Version 0.4.0 uses
nine fixed localization keys to expose real, read-only display strings:

- nation: `countryTag` and `gameDateDisplay`;
- economy: `estimatedMonthlyIncomeDisplay`,
  `estimatedTradeTaxIncomeDisplay`, `treasuryDisplay`, and
  `monthlyBalanceDisplay`;
- military: `armySizeDisplay`, `navySizeDisplay`, and `manpowerDisplay`.

The corresponding getters are present in the locally generated GUI data-type
catalogue and are used by shipped EU5 localization. These values remain
`currentObservations` only: they are localized display strings, not canonical
numbers, timestamps, or verified campaign identity. They must never populate
typed metrics, trends, or `currentState` without separate trusted evidence.

The generated documentation still does not expose a JSON-safe canonical
numeric or collection serializer for `debug_log`. Treasury and monthly balance
can therefore be emitted only as localized display strings; their canonical
numeric fields remain unavailable. Market lists, food, shortages, relations,
allies, and supply remain `value: null`, `availability: "unavailable"`, with a
machine-readable reason in this schema. EU5 does expose typed iterators for
future bounded row records, but those require a separate reviewed schema and
live proof. The mod must not invent syntax or present those values as observed.
Country name likewise remains unavailable.

Live testing against EU5 1.3.11 showed that putting
`[ROOT.GetNameWithNoTooltip]` or `[GetDateString]` directly inside a quoted
`debug_log` value causes a `pdx_data_localize Data error`; it does not produce a
usable record. Version 0.4.0 does not repeat that invalid form: it passes only
fixed localization keys, which is the documented effect syntax. The
script-effect API also documents no pause-state trigger. The external
collector must retain source and verification status and obtain pause state
from a fresh independent observation. The panel itself may show live
country/date and paused/running status because those functions are supported
in GUI expressions.

The panel visibly identifies the mod version, disposable test-session
restriction, bridge-loaded state, current country/date, and paused/running
state. It also says that the external monitor is authoritative for the last
procedure and result. The reviewed GUI API exposes no transient panel-local
value that can safely retain a procedure/result without mutating campaign
state, so the panel does not pretend to display a local acknowledgement. A
hidden one-shot GUI animation runs `emit_ping` when the panel is created; this
uses the same `trigger_on_create`/`on_finish` widget-state shape shipped in
`economy_lateralview.gui` and gives the external monitor a structured health
handshake without requiring a second click.

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

Creation is reliable in a `-debug_mode` test session. Once created, the panel
remains movable and all eight fixed controls remain directly reachable until
the widget is closed or the game session is replaced. A live EU5 1.3.11 test
proved that a top-level `window` does not handle the `on_start` callback
property: it rejects the window properties and leaves the visible child
buttons nonfunctional. Version 0.2.2 therefore has no window callback. Press
the fixed **Emit ping** button after visually verifying the panel to obtain the
health acknowledgement.

Version 0.2.3 also matches the shipped scripted-GUI registration shape: each
named entry contains only `effect = { ... }`. Live 0.2.2 testing proved that
the window and physical clicks worked but entries carrying the optional
`scope`, `is_shown`, and `is_valid` fields did not dispatch. Those fields have
been removed. The bridge now exposes exactly the eight fixed read-only
procedures listed above and no generic effect route.

EU5 1.3 does not expose a documented, narrow mod hook that can attach a new
top-level widget to an already loaded normal-game HUD without replacing a base
GUI file. This repository therefore does not claim automatic attachment in a
normal campaign and does not replace `ingame_topbar.gui`. The single exact
`GUI.CreateWidget` invocation above remains the safest reviewed opener. It is
an explicit debug-session bootstrap, not a generic console proxy, and the mod
does not provide or accept arbitrary console text. The creation step does not
grant access to arbitrary console commands.

This limitation was rechecked against the local EU5 1.3.11 exports. The
generated console catalogue documents `GUI.CreateWidget` only as a debug
console command, and the generated GUI data types expose widget destruction
but no equivalent create/attach function callable from a normal GUI
expression. The shipped five-line `gui/common_topbar.gui` is a hidden,
hard-coded placeholder and could theoretically be shadowed by a mod, but its
load lifecycle is undocumented. Replacing even that small base file would add
game-version and mod-conflict risk without runtime proof, so version 0.4.0
deliberately does not ship a `common_topbar.gui` override. That candidate
remains quarantined until a disposable-session rehearsal and independent
review prove attachment, removal, and compatibility.

After copying an updated mod build, fully restart EU5 so both the GUI and
`common/scripted_guis` database are rebuilt. Codex does not need a restart.

Do not install or enable this scaffold in a normal campaign. Any installation,
GUI attachment, or new diagnostic procedure requires separate review and
explicit authorization.
