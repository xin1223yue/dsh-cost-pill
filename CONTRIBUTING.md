# Contributing

Thanks for looking. This plugin is deliberately small: one browser bundle, one
empty host half, one verification script.

## Ground rules

- **No build step.** `client.js` is hand-written in the ModuleLoader format
  (`window.__ModuleLoader__.load({ id, factory })`) and is loaded as-is. Keep it
  that way; a bundler would add a toolchain for ~30 KB of code.
- **No runtime dependencies.** `react` and `react-dom` come from the browser
  platform module table. Adding a package to `dependencies` needs a very good
  reason.
- **No network, no Host service, no credentials.** The plugin must stay a pure
  client-side reading of data the page already holds.
- **Precision over coverage.** If a number cannot be derived from
  provider-reported buckets, show nothing or mark it `≈`. Never invent one.

## Where the numbers come from

| Value | Source |
| --- | --- |
| per-turn buckets | `turn-tail.tokenUsage` (`uncachedInputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`) |
| billed model | `turn-tail.tokenUsage.routes[].model` |
| billing instant | `TurnLocation.start.time` (`turn/start`) |
| whole-log totals | the `tokenUsage` projection |

## Before opening a PR

```sh
node verify.mjs
```

It must exit 0. Add assertions for any behaviour you change — the suite is the
only regression net this project has, and it runs in CI on every push.

If you touch the dialog or the chips, also re-render the docs figures:

```sh
chrome --headless=new --force-device-scale-factor=2 --window-size=980,470 \
  --screenshot=docs/demo.png docs/demo.html
```

## Scope

Pricing lives in `client.js` (`V4_PEAK` / `V4_OFFPEAK` / `V4_BASE` /
`POLICY_SWITCH`). A new model family is a one-line branch in `familyOf()`.
Slots are named in `apply()`; if a future dsh renames them, update both the
registration and the table in the README.
