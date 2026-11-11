# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-11-11

### Added

- Display the DeepSeek balance in the sidebar footer. The expanded sidebar shows
  the amount, and the tooltip shows the recharge and granted balances.
- Read the signed-in DeepSeek account first. If its balance is unavailable, use
  the DeepSeek API key resolved by DSH’s credentials service.
- Cover the authenticated route, account and API-key paths, and transient
  failure recovery in the offline verification suite.

### Fixed

- Declare the Host dependencies so DSH activates the plugin and registers
  the balance endpoint on its authenticated connection.
- Retry a transient balance read after two seconds. Successful Host responses
  are cached for 30 seconds, and failed reads can be retried immediately.

## [1.1.0] — 2026-11-06

### Added

- Per-turn cost chip in the completed-turn footer (`conversation.chat.assistant-actions`),
  priced from that turn's own `tokenUsage` and `turn/start` instant.
- Shared popover shell for both dialogs (outside-click, Escape, viewport clamping).

### Fixed

- The bill dialog had no backdrop blur, so the composer text underneath bled
  through the translucent menu surface. It now wears the shipped stat-dialog
  material, with a fallback blur value.
- Unloaded history was priced at "now"; reopening a daytime conversation during
  the off-peak window re-billed it at the night rate. It now rides the blended
  rate the priced turns actually paid.

## [1.0.0] — 2026-11-06

### Added

- Composer stats-line cell (`conversation.composer.dock`) showing the live spend
  of the open conversation in CNY.
- Per-reply pricing with the official DeepSeek table, including the 2026-08-17
  peak/off-peak policy (peak 09:00–12:00 and 14:00–18:00 Beijing).
- Offline verification suite (`node verify.mjs`) with a minimal renderer, so the
  suite runs without any dependency install.
- Cross-platform installer (`install.mjs`, plus `.ps1` / `.cmd` / `.sh` wrappers)
  and a Windows restart helper.
