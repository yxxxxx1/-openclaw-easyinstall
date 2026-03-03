# OpenClaw Windows Native MVP Spec

## Confirmed scope

- Windows native installer flow (no WSL2)
- Minimal info UI for non-technical users
- Install location can be changed by user
- Admin prompt shown only when required
- AI setup is mandatory before chat
- Uninstall is required and defaults to preserving user data

## End-to-end journey

1. Installer: Start -> Install Path -> Installing -> Completed
2. First launch: Boot checks
3. Mandatory AI setup: provider + API key + default model
4. Enter console: chat, channels, settings
5. Uninstall from settings: optional data removal checkbox (default unchecked)

## UX constraints

- Hide technical details (runtime, port, checksum, mirrors)
- Keep one primary action per screen
- Human-readable errors with retry actions

## Current implementation status

- Implemented as an interactive prototype in `src/App.tsx` with Ant Design + Framer Motion
- Includes all major screens and key transitions
- Includes conditional admin modal and uninstall default policy
