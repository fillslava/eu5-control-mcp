# EU5 Control Debug

This directory is a workspace-only, debug-only mod scaffold. It is not
installed, copied, linked, or enabled in the Europa Universalis V user mod
directory.

The scaffold currently defines one country-scoped scripted GUI proof:
`eu5_control_debug_diagnostic`. Its visibility and validity triggers are
unconditional, while its effect block is deliberately empty. It cannot change
money, armies, diplomacy, the date, AI behavior, or any other game state.

There is no GUI layout or scripted-widget mapping in this scaffold. Therefore,
the scripted GUI is not attached to or visible through any in-game window or
button. The `is_shown` trigger only proves that the definition's visibility
condition is true if a future, separately reviewed GUI integration supplies a
country root scope.

Do not install or enable this scaffold in a campaign. Any future installation,
GUI attachment, or state-changing diagnostic requires separate review and
explicit authorization.
