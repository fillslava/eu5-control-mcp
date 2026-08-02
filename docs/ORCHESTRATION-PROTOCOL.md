# EUV supervised test-run protocol

Purpose: run a bounded Europa Universalis V test as Holland while keeping one
human supervisor in control of consequential decisions. This document prepares
the workflow only; it does not authorize starting or controlling the game.

## Non-negotiable boundaries

- Never modify game installation files, mods, configuration, or saves.
- Never delete, move, upload, rename, overwrite, or create a save on the
  supervisor's behalf.
- Never use console commands, cheats, account features, cloud sync, or external
  communication.
- Execute only one approved UI action at a time. Stop if the visible result
  differs from the expected result.
- The human supervisor can pause or terminate the run at any time.

## Local save checkpoint reference

On this Windows installation, EU5 save files are in the standard Paradox user
directory:

`C:\Users\slava\Documents\Paradox Interactive\Europa Universalis V\save games`

Use `eu5_list_save_checkpoints` before and after a test segment. Supply this
same absolute path as both `saveDirectory` and `confirmedSaveDirectory`; the
MCP returns metadata and SHA-256 only, never writes to the folder. Do not add
this machine-specific path to the public repository.

## Roles

| Role | Responsibility | Must not |
|---|---|---|
| Observer | Report visible state and uncertainty in a structured state packet. | Click, type, infer hidden values, or recommend actions. |
| Strategist | Propose up to three ranked actions with intent, expected result, and reversibility. | Execute actions or conceal assumptions. |
| Critic | Challenge the proposal for rule errors, opportunity cost, and failure modes. | Approve or execute its preferred action. |
| Safety Gate | Return `APPROVE`, `HUMAN_CONFIRM`, or `REJECT` against the boundaries and current evidence. | Strategize or waive a boundary. |
| Executor | Perform exactly one approved action and report the visible result. | Expand, repeat, or reinterpret an approval. |

One agent may implement several roles, but role outputs remain separate and the
Safety Gate must run after the Critic.

## Turn contract

1. **Observe:** produce `{paused, date, screen, key_values, alerts, uncertainty}`.
   Unknown information is `unknown`, never guessed.
2. **Propose:** each candidate is
   `{action, intent, expected_visible_result, reversible, stop_condition}`.
3. **Critique:** list rule uncertainty, strategic downside, and the safest
   alternative, then select `support`, `revise`, or `oppose`.
4. **Gate:** evaluate the exact action and return:
   - `APPROVE` for routine, reversible, bounded actions;
   - `HUMAN_CONFIRM` for consequential or ambiguous actions;
   - `REJECT` for any boundary violation or inadequate observation.
5. **Execute:** perform one atomic action only. Do not continue through a new
   dialog or changed screen.
6. **Verify:** Observer compares actual versus expected state. A mismatch ends
   the turn and keeps the game paused when possible.

Approval expires after one action, any screen change, any new dialog, or sixty
seconds, whichever happens first.

## Proposed agent navigation keybindings

The reviewed convention uses three-key `Ctrl+Alt+<key>` chords only for
commands whose sole effect is opening, focusing, closing, or searching a view.
The exact import candidate and complete mapping are documented in
`profiles/README.md`. Its groups are:

| Chords | Navigation targets |
|---|---|
| `Ctrl+Alt+J/K/B/N/X` | Close left/right panel, previous/next window, collapse window |
| `Ctrl+Alt+G/E/P/S/U/H/Y/A` | Government, Economy, Production, Society, Diplomacy, Military, Geography, and Advances tabs |
| `Ctrl+Alt+T/Q/C/V` | Alerts, province search, capital camera focus, and map-mode menu |
| `Ctrl+Alt+1` … `Ctrl+Alt+0`, then `O/W` | Map-mode slots 1–12 |

Do not substitute a similarly named command. Never map agent chords to commands
that change country state, diplomacy, armies, economy, construction, saving or
loading, the console, game speed, pause state, or confirmations. Also exclude
Enter, Escape, Space, `+`/`-`, function keys, Windows-key chords, mouse buttons,
macros, sequences, and any command that behaves differently by context. The
layout also excludes Windows/Magnifier `Ctrl+Alt` shortcuts, including Delete,
Tab, `F`, `I`, `L`, `D`, `M`, `R`, and arrow keys.

### Input Bindings validation

- [ ] A human pauses the test and opens the game's **Input Bindings** UI.
- [ ] Record the exact command label, current assignment, and game version.
- [ ] Confirm the command is navigation-only: `open`, `show`, `focus`, `find`,
      or `close`; reject ambiguous labels and toggles with possible side effects.
- [ ] Confirm both the command and proposed chord are shown as unbound, with no
      duplicate or conflict warning. Never replace or clear an existing binding.
- [ ] Map one chord at a time, then test it on the paused disposable test state.
- [ ] Verify only the intended view changed and no date, resource, unit, order,
      relation, queue, dialog confirmation, save state, or speed changed.
- [ ] Remove the proposed mapping and stop if the observed effect differs from
      the recorded command description.

## Mandatory human confirmation

Require explicit confirmation for declarations of war, peace terms, calls to
arms, loans or bankruptcy-related choices, subject release, major diplomatic
commitments, government/religion/tag-changing decisions, destructive dismissal
dialogs, and every save or exit operation. When game rules or consequences are
uncertain, treat the action as consequential.

## Immediate stop conditions

Stop without further UI input when observation is unreliable, an unexpected
dialog appears, the game unpauses unexpectedly, the selected country/save is
uncertain, a proposed action could affect files or online services, or the
supervisor says `STOP`. Report the last verified state, the unexpected state,
and whether any action was completed.

## Verified local control runbook (2026-07-25)

This section records an observed setup result for the supervised test campaign.
It does not widen the boundaries above.

1. Start Codex after Windows-MCP is available, then launch EU5 and load the
   intended non-Ironman test save.
2. Keep the campaign paused. Confirm the country header reads **Holland** and
   record the visible date before any test.
3. In EU5, open `Escape -> Settings -> Input Bindings`. Enter
   `agent.bindings` in the profile field and choose **Load Profile**. Do not
   infer success solely from the field text: verify a live command.
   In the Russian UI this path is `Escape -> Настройки -> Привязка клавиш`;
   the profile filename is unchanged.
4. Focus the EU5 window, then send `Ctrl+Alt+Q`. The expected effect is the
   Finder opening. Close it without selecting a result.
5. Send `Ctrl+Alt+C`. The expected effect is a camera pan to the controlled
   country's capital area. This is a camera-only navigation action; it does
   not advance time or change country state.
6. If either test differs from expectation, stop UI input, keep the game
   paused, and return to Input Bindings. The most likely cause is that the
   profile was not actually loaded.
7. Before a test run, take a supervisor-approved checkpoint. For a time
   advance, use the minimum speed, advance only a few days, pause, inspect all
   alerts and modal windows, and stop immediately for any decision.

Observed limitation: the Windows-MCP window inventory may not reliably label
the EU5 window. Focus through a harmless in-game UI element before sending a
shortcut, and verify the visible result after every command.

### Timing calibration result

On the Holland test save, a one-second unpause at the then-current speed
advanced roughly ten in-game days. The campaign was paused again immediately;
only a routine notification appeared and no decision window opened. Treat this
as a failed one-day calibration, not as a safe default. Before any future time
test, explicitly set the in-game speed to the minimum and verify its visible
indicator before unpausing; otherwise do not advance time automatically.

### Verified Russian-UI navigation

The following bindings were observed working on the paused Holland test save
after loading `agent.bindings`:

| Chord | Russian panel/result | Safe use |
|---|---|---|
| `Ctrl+Alt+C` | camera pan to the controlled country's capital area | regain map orientation |
| `Ctrl+Alt+Q` | Finder | search only; do not select an action from a result panel |
| `Ctrl+Alt+E` | `Экономика` | read balance, income, expenses, loans and maintenance |
| `Ctrl+Alt+U` | `Дипломатия` | read relations, known powers and organizations |
| `Ctrl+Alt+H` | `Военное дело` | read armies, navies, manpower and supply information |

These commands are navigation/read-only shortcuts, not approval to change a
slider, create a relation, issue an order, recruit, or unpause the game.

### Live Holland test observations (1337-05-14)

- A short unpaused interval advanced the calendar from late April to 14 May.
  The game paused on a notification that a rival or major power had changed
  its stance toward Holland. Treat this class of notification as an
  inspect-first checkpoint, not as an automatic response.
- The construction flow was found from a selected city: select the city, open
  its infrastructure/building slots, select a proposed building, then choose
  a city project before the build action becomes available. The UI showed a
  proposed Scriptorium with a nominal 365-day build time and a 41.3 cost, but
  no project was selected and no construction was started.
- `Ctrl+Alt+C` reliably returned the camera to the controlled-country area
  during recovery. It does not itself close an open panel.

### Follow-up live run (1337-08-01)

- The game can advance substantially faster than intended if it is not
  explicitly re-paused after dismissing a modal. In this run, it reached
  1 August and produced routine stance and disease-outbreak notifications,
  followed by the informational Hundred Years' War historical event.
- The stance and Hundred Years' War notices had acknowledgement/navigation
  controls only; no diplomatic commitment was taken. The outbreak notice was
  acknowledged and its location inspected, without a policy change.
- Economy remained positive at roughly +7 monthly in the visible economy
  panel. The Army tab reported no available army units for Holland, so any
  offensive test must begin with recruitment and force/supply verification,
  rather than assuming an existing army is ready.
