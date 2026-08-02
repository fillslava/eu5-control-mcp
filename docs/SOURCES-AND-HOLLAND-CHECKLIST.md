# EUV sources and Holland test checklist

Network access was intentionally not used during preparation. The links below
are a compact source queue, not a claim that their current content or URLs were
live-verified on 2026-07-25.

## Source manifest

| Priority | Source | Use | Trust note |
|---|---|---|---|
| 1 | [Europa Universalis V official site](https://www.paradoxinteractive.com/games/europa-universalis-v/about) | Current product scope and official announcements. | Publisher source; verify version-specific details in current patch notes. |
| 2 | [Europa Universalis V forum](https://forum.paradoxplaza.com/forum/forums/europa-universalis-v.1296/) | Developer diaries, patch notes, and official clarifications. | Prefer posts by Paradox staff; record publication date and game version. |
| 3 | [Europa Universalis V Wiki](https://eu5.paradoxwikis.com/) | Rule lookup, terminology, country pages, and cross-references. | Community-maintained; confirm consequential rules against the running version and in-game tooltips. |
| 4 | [EU5 community on Reddit](https://www.reddit.com/r/EU5/) | Discover edge cases and player-tested tactics. | Anecdotal; never use a single post as authority for a rule. |

For every rule used in the run log, record: source URL, page/post title,
publication or revision date if visible, applicable game version, and the exact
in-game observation that confirms or contradicts it.

## Holland test-run checklist

### Before any UI control

- [ ] Human supervisor states the run objective, time/turn limit, and stop word.
- [ ] Record game version, checksum if visible, DLC, mods, difficulty, and
      whether achievements/ironman/cloud saves are active.
- [ ] Confirm Holland and the intended test save by visible country, date, and
      save name; do not infer from filename alone.
- [ ] Human confirms the save folder path separately if the checkpoint helper
      will be used. The helper is not pointed at the game installation.
- [ ] Run the local helper only if requested; keep its JSON output in the
      project, never in the save folder.
- [ ] Confirm the game is paused and the supervisor can immediately intervene.
- [ ] Review the boundaries and mandatory-confirmation list in
      `ORCHESTRATION-PROTOCOL.md`.

### Baseline observation as Holland

- [ ] Record date, pause state, treasury/income, alerts, diplomatic status,
      subjects/allies/rivals, active wars, military readiness, stability or
      unrest indicators, and current research/institution progress as visibly
      presented.
- [ ] Record Holland's immediate neighbors and current diplomatic attitudes
      without assuming historical relationships or mechanics.
- [ ] List unknowns that could change the first decision.
- [ ] Choose one measurable, reversible first objective; do not optimize several
      systems at once in the initial test.

### Each supervised turn

- [ ] Observer packet is current and marks unknown values.
- [ ] Strategist proposes no more than three bounded actions.
- [ ] Critic challenges rules, downside, and opportunity cost.
- [ ] Safety Gate approves the exact next action or requests human confirmation.
- [ ] Executor performs one atomic action.
- [ ] Observer verifies the expected visible result before another action.
- [ ] Log elapsed time, action, approval, expected result, actual result, and
      any uncertainty.

### Stop and close

- [ ] Stop on an unexpected dialog, unplanned unpause, state mismatch, observer
      uncertainty, or supervisor command.
- [ ] Leave the game paused when possible without adding another risky action.
- [ ] Do not create, overwrite, rename, move, upload, or delete a save.
- [ ] Record the final visible state and any unresolved decision.
- [ ] Compare the run log with the objective and identify one protocol change
      before another test.
