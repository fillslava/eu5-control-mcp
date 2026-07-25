# EU5 Control MCP

This repository starts with a deliberately narrow design:

1. **Read state first.** Local save metadata is inventoried without altering a
   save or requiring an EU5 process.
2. **Model proposed actions.** An action has a preview, risk class, evidence,
   and a confirmation requirement before an executor can receive it.
3. **Keep UI control separate.** A future Windows-MCP adapter may perform a
   verified UI workflow, but it must never write game files or bypass the gate.

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

For a non-standard save directory, supply its absolute path and repeat it as
`confirmedSaveDirectory`. Subfolders are excluded unless explicitly requested.

## Initial milestones

- `0.1.x`: save inventory and structured action contracts; no live-game
  control.
- `0.2.x`: read-only parser for validated save fixtures.
- `0.3.x`: preview-only UI workflows for economy, diplomacy and military.
- `1.0.x`: confirmed, auditable control workflows after each is tested on a
  disposable campaign.

No actual save, personal binding file, credential, or game installation path
is committed to this repository.
