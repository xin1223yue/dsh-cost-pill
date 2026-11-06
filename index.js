/**
 * Host half of the cost-pill bundle. The browser half owns every read and every
 * pixel: it consumes the session's `tokenUsage` projection and the per-turn
 * usage carried by `turn-tail` chat rows, so the Host contributes no service,
 * no Remote namespace and no tool.
 */
export function apply() {}
