# EUV agent navigation binding candidate

Do not import this profile until a human has reviewed it in the game's
**Input Bindings** UI. The verified candidate was copied, without overwriting
anything, to:
`C:\Users\slava\Documents\Paradox Interactive\Europa Universalis V\user_bindings\agent-navigation-2026-07-25.bindings`.
The game UI was not used and the original `user.bindings` was not changed.

## Files

- `original-user.bindings.backup` is a byte-for-byte backup of the live
  `user.bindings` observed on 2026-07-25. SHA-256:
  `b70e703a5e2c278556b6ef7753813494b06dbc3721399084be9d5e1d7acfb9d3`.
- `agent-navigation.bindings` is the import candidate. It retains the original
  `max_zoom_out` binding exactly and adds only view, panel, search, camera-focus,
  and map-mode actions. Its SHA-256, matching the copied profile, is
  `8de0b8f6745481e16708f198f62459870cd60a8867267dbf15acb9e997bc45ac`.

The live source was read from:
`C:\Users\slava\Documents\Paradox Interactive\Europa Universalis V\user_bindings\user.bindings`.
It was not modified.

## Added bindings

| Chord | Input action | Visible purpose |
|---|---|---|
| `Ctrl+Alt+J` | `close_window_left` | Close left panel |
| `Ctrl+Alt+K` | `close_window_right` | Close right panel |
| `Ctrl+Alt+B` | `previous_window` | Previous window |
| `Ctrl+Alt+N` | `next_window` | Next window |
| `Ctrl+Alt+X` | `toggle_window_collapse` | Collapse or expand the current window |
| `Ctrl+Alt+G` | `top_left_1` | Government tab |
| `Ctrl+Alt+E` | `top_left_2` | Economy tab |
| `Ctrl+Alt+P` | `top_left_3` | Production tab |
| `Ctrl+Alt+S` | `top_left_4` | Society tab |
| `Ctrl+Alt+U` | `top_left_5` | Diplomacy tab |
| `Ctrl+Alt+H` | `top_left_6` | Military tab |
| `Ctrl+Alt+Y` | `top_left_7` | Geography tab |
| `Ctrl+Alt+A` | `top_left_8` | Advances tab |
| `Ctrl+Alt+T` | `toggle_alert_stash` | Show or hide alert menu |
| `Ctrl+Alt+Q` | `find_province` | Open province search |
| `Ctrl+Alt+C` | `go_to_capital` | Center camera on capital |
| `Ctrl+Alt+V` | `mapmode_menu` | Show or hide map-mode menu |
| `Ctrl+Alt+1` … `Ctrl+Alt+0` | `mapmode_slot_1` … `mapmode_slot_10` | Select map-mode slots 1–10 |
| `Ctrl+Alt+O` | `mapmode_slot_11` | Select map-mode slot 11 |
| `Ctrl+Alt+W` | `mapmode_slot_12` | Select map-mode slot 12 |

All 29 added chords were absent from the live user profile and the installed
gameplay `default.profile`. They avoid Windows' documented `Ctrl+Alt+Delete`,
`Ctrl+Alt+Tab`, and Magnifier chords (`F`, `I`, `L`, `D`, `M`, `R`, arrows,
Space, and Minus), as well as function keys, Tab, Delete, Windows-key chords,
mouse buttons, and locale-dependent punctuation.

## Explicit exclusions

The candidate contains no action for saving/loading, console, quit, confirmation,
pause or speed, diplomacy changes, unit or military operations, economy changes,
construction, laws, automation, control groups, macros, deletion, screenshots,
reporting, or developer tools. Opening the Economy, Diplomacy, Military, and
other tabs is navigation only; actions inside those panels remain unbound.

## Evidence and source quality

1. **Primary local evidence:** installed
   `game\loading_screen\input_profile\default.profile` defines every included
   action name and its English localization identifies the visible purpose.
2. **Primary local syntax evidence:** installed
   `clausewitz\loading_screen\input_profile\map_editor.bindings` uses repeated
   `modifier=ctrl` and `modifier=alt` fields in one binding. Other installed
   samples and the live profile use the same flat `binding={...}` structure.
3. **Official system evidence:** Microsoft documents reserved Windows and
   Magnifier shortcuts:
   <https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec>
   and <https://support.microsoft.com/en-us/help/13810>. Microsoft's shortcut
   design guidance also notes the AltGr risk of `Ctrl+Alt`:
   <https://learn.microsoft.com/en-us/windows/win32/uxguide/inter-keyboard>.
4. **Community corroboration:** an EUV Steam discussion shows `version=4`,
   `input_action`, and mouse binding syntax and describes loading a `.bindings`
   profile through Settings:
   <https://steamcommunity.com/app/3450310/discussions/0/667222425710138732/>.
   Another discussion reports that the `.bindings` extension matters:
   <https://steamcommunity.com/app/3450310/discussions/0/802331493180481241/>.

## Validation before import

- [ ] Confirm the backup hash above still matches the live source before review.
- [ ] Confirm the copied profile hash still matches the candidate hash above.
- [ ] In **Input Bindings**, verify each exact action exists and each proposed
      chord is unbound; never clear or replace a binding.
- [ ] Check the active Windows keyboard layout. `Ctrl+Alt` can act as AltGr on
      some layouts even when it is not a Windows-reserved shortcut.
- [ ] Check GPU tools, accessibility tools, overlays, and remote-control software
      for global conflicts not covered by Microsoft's standard shortcut list.
- [ ] Import only through the game's **Load Profile** UI; do not copy over the
      original `user.bindings`.
- [ ] Test one chord at a time while paused. Verify only the expected view or
      camera focus changes and no date, resource, relation, unit, queue, save,
      dialog confirmation, or speed changes.
- [ ] Stop and unload the candidate if the game reports a conflict, drops an
      existing binding, or interprets any command differently.

## Remaining ambiguity

The candidate is structurally validated against installed version-4 samples,
but preparation did not ask the running game to parse it. Profile-load behavior
has community reports of dropped or reset bindings across some game versions.
Import therefore remains a supervised UI step, and the live file must be
re-hashed first in case it changed while the game remained open.
