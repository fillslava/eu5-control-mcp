# EU5 Control MCP

This repository starts with a deliberately narrow design:

1. **Read state first.** Local save metadata is inventoried without altering a
   save or requiring an EU5 process.
2. **Model proposed actions.** An action has a preview, risk class, evidence,
   and a confirmation requirement before an external controller can receive it.
3. **Keep UI control separate.** This MCP prepares and validates finite direct
   Windows MCP procedures, but it never sends keyboard or mouse input.
4. **Keep diagnostic mode separate.** The optional debug-mod path is a
   separately reviewed, disposable-session diagnostic only; it is never a
   normal-campaign control path.

## Current runnable tools

Install dependencies with `npm install`, then run the stdio MCP server with
`npm start`.

Copy `.env.example` to a local `.env` and set `EU5_SAVE_DIRECTORY` if your
save folder differs from the standard Windows location. `.env` is ignored by
Git and is never committed.

- `eu5_list_save_checkpoints` inventories the standard save folder for the
  current Windows user by default: `Documents\\Paradox Interactive\\Europa
  Universalis V\\save games`. It reports only relative filenames, size,
  modification time and SHA-256; it never parses or changes a save.
- `eu5_preview_action` validates a proposed action contract. It never sends
  keyboard or mouse input to EU5.
- `eu5_prepare_navigation_command` returns a finite, tested hotkey procedure
  for a coordinator to send through its direct Windows MCP session. Version 0.1
  contains camera, panel, alert and search navigation only.
- `eu5_issue_navigation_command` accepts a UI observation that is at most two
  seconds old and confirms the game is paused, modal-free and not in a text
  field before returning a direct Windows MCP procedure. Despite the legacy
  tool name, it validates and returns the procedure; it does not issue input.
- `eu5_observe_checkpoint` returns the newest save's name, size and timestamp
  without hashing or parsing every save file. Use it as a fast checkpoint;
  use the full inventory before and after consequential actions.
- `eu5_declare_action`, `eu5_authorize_action`, `eu5_dispatch_action`,
  `eu5_record_action_outcome`, and `eu5_verify_action_outcome` record a bounded
  action lifecycle in a local JSONL ledger. Authorization accepts only a
  one-use, HMAC-signed external/manual approval artifact generated in a trusted
  local shell by `scripts/approve-euv-action.js`, using
  `EU5_CONTROL_APPROVAL_SECRET`; the MCP never creates approvals or exposes the
  secret. `APPROVE_ONCE` is not accepted. Dispatch remains preparation only:
  `uiInputExecuted` is always `false` and a separately supervised external
  executor is required.

For a non-standard save directory, supply its absolute path and repeat it as
`confirmedSaveDirectory`. Subfolders are excluded unless explicitly requested.

The MCP deliberately does not expose save/load, speed, construction, military
orders, diplomacy confirmation, or war macros. Those require a separate
confirmation-gated workflow with a verified visible result.

## Two-mode protocol

**Normal campaign mode** permits only the read, preview, navigation-preparation,
and action-lifecycle records described above. The MCP cannot execute UI input,
run console text, or turn a prepared dispatch into an in-game action.

**Debug diagnostic mode** is restricted to a separately approved disposable
session. Its `eu5-control-debug` panel has exactly three fixed,
read-only log procedures (`emit_ping`, `emit_player_scope`, and
`emit_state_snapshot`); it has no text entry or arbitrary-console route. The
current test workstation has a reviewed installed copy, but the panel is not
enabled or attached automatically. Do not enable the debug mode or mod in a
normal campaign.

## Read-only baseline manifest

`scripts/euv-baseline-manifest.js` builds an in-memory JSON baseline from
explicit, user-confirmed absolute save and debug-mod directories. It inventories
only `.eu5` save files, hashes opaque file bytes, inventories the mod, and
redacts both absolute roots from its output; it does not parse saves or write a
manifest. `scripts/verify-euv-baseline.js` rebuilds the same evidence and
compares build/test markers, mod identity, and file hashes without running a
build or tests.

Keep any resulting evidence local. These scripts require a disposable-session
save root and a separately reviewed mod root; they are not a normal-campaign
execution mechanism.

## Action outcome evidence

An outcome must include the external executor's actual visible result plus an
evidence reference and SHA-256. Verification compares that actual result with
the declared expected result. A mismatch produces `verification_failed` and
requires a stop. In v1, a match is recorded as `attested_untrusted`: evidence
supplied through MCP is an attestation, and no adapter allowlist changes that
classification. MCP cannot emit `verified` from that evidence. `verified`
requires a future independently authenticated verifier.

## Direct Windows MCP handoff

The custom MCP has no Windows MCP client and no input-execution tool. It returns
an allowlisted `Shortcut` procedure only after applying its local validation
rules. A coordinator may then use its own direct Windows MCP session to focus
**Europa Universalis V**, send the exact procedure, capture a fresh UI
observation, and verify the expected panel or camera result. The procedure is
never evidence that input was sent or accepted.

## Initial milestones

- `0.1.x`: save inventory and structured action contracts; no live-game
  control.
- `0.2.x`: read-only parser for validated save fixtures.
- `0.3.x`: preparation-only UI workflows for economy, diplomacy and military.
- `1.0.x`: confirmed, auditable control workflows after each is tested on a
  disposable campaign.

No actual save, personal binding file, credential, or game installation path
is committed to this repository.
