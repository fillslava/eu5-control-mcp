# EU5 Control MCP

This repository starts with a deliberately narrow design:

1. **Read state first.** Local save metadata is inventoried without altering a
   save or requiring an EU5 process.
2. **Model proposed actions.** An action has a preview, risk class, evidence,
   and a confirmation requirement before an executor can receive it.
3. **Keep UI control separate.** A future Windows-MCP adapter may perform a
   verified UI workflow, but it must never write game files or bypass the gate.

## Initial milestones

- `0.1.x`: save inventory and structured action contracts; no live-game
  control.
- `0.2.x`: read-only parser for validated save fixtures.
- `0.3.x`: preview-only UI workflows for economy, diplomacy and military.
- `1.0.x`: confirmed, auditable control workflows after each is tested on a
  disposable campaign.

No actual save, personal binding file, credential, or game installation path
is committed to this repository.
