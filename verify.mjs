/*
 * Offline verification for the browser half.
 *
 * The deployment ships React inside the frontend bundle (the module table hands
 * `react` to plugins at runtime), so no `react` package exists on disk. This
 * harness therefore loads client.js exactly as the ModuleLoader does (window
 * handshake + lazy factory) and renders the registered component with a
 * minimal element renderer that implements the hook surface the pill uses
 * (useState / useMemo / useRef / useEffect).
 *
 * Run:  node verify.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/* ---- 0. Minimal React ------------------------------------------------ */
const stateSlots = [];
let stateCursor = 0;

const React = {
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {});
    const flat = children.flat(Infinity).filter((child) => child !== undefined);
    if (flat.length === 1) merged.children = flat[0];
    else if (flat.length > 1) merged.children = flat;
    return { type, props: merged };
  },
  useState(initial) {
    const slot = stateCursor;
    stateCursor += 1;
    if (!(slot in stateSlots)) stateSlots[slot] = initial;
    return [stateSlots[slot], (next) => { stateSlots[slot] = typeof next === 'function' ? next(stateSlots[slot]) : next; }];
  },
  useMemo(factory) {
    return factory();
  },
  useRef(initial) {
    return { current: initial === undefined ? null : initial };
  },
  useEffect(effect) {
    void effect;
    return undefined;
  },
  useCallback(fn) {
    return fn;
  }
};

const ReactDOM = {
  createPortal(node) {
    return node;
  }
};

/** Render one element tree to markup, calling function components. */
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  if (typeof node === 'string' || typeof node === 'number') return escape(String(node));

  const { type, props } = node;
  if (typeof type === 'function') {
    stateCursor = 0; // a fresh render pass owns the hook order
    return render(type(props));
  }
  const attrs = Object.entries(props || {})
    .filter(([key, value]) => key !== 'children' && /^[a-zA-Z-]+$/.test(key) && value !== undefined && value !== null && value !== false)
    .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
    .join('');
  const body = render(props === undefined ? undefined : props.children);
  return `<${type}${attrs}>${body}</${type}>`;
}

function escape(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- 1. ModuleLoader handshake --------------------------------------- */
const source = readFileSync(join(here, 'client.js'), 'utf8');
let captured = null;
new Function('window', source)({
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    }
  }
});

assert(captured !== null, 'bundle did not call window.__ModuleLoader__.load');
assert(captured.id === 'dsh-cost-pill', `bundle id is ${captured.id}`);

const moduleExports = captured.factory((specifier) => {
  if (specifier === 'react') return React;
  if (specifier === 'react-dom') return ReactDOM;
  throw new Error(`unexpected module request: ${specifier}`);
});

assert(typeof moduleExports.apply === 'function', 'apply missing');
assert(Array.isArray(moduleExports.inject), 'inject missing');

/* ---- 2. Registration through a slots stub ---------------------------- */
const registrations = [];
let injectedCss = null;

/* Minimal document so the stylesheet path runs and its text can be asserted. */
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: {
    appendChild(tag) {
      injectedCss = tag.textContent;
    }
  }
};

moduleExports.apply({
  effect(callback) {
    const dispose = callback();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  slots: {
    inject(name, callback) {
      return callback();
    },
    register(options, component) {
      registrations.push({ slot: options.name, options, component });
      return () => {};
    }
  }
});

assert(registrations.length === 2, `expected 2 registrations, got ${registrations.length}`);

const dock = registrations.find((entry) => entry.slot === 'conversation.composer.dock');
const tail = registrations.find((entry) => entry.slot === 'conversation.chat.assistant-actions');
assert(dock !== undefined, 'no composer dock registration');
assert(tail !== undefined, 'no turn-footer registration');
assert(dock.options.id === 'cost' && dock.options.order === 2, `dock cell ${JSON.stringify(dock.options)}`);
assert(tail.options.id === 'cost', `turn cell id ${tail.options.id}`);
assert(typeof tail.options.order === 'number' && tail.options.order > 0, 'turn cell has no order');

/* The dialog material must blur the composer behind it (turn-2 regression). */
assert(injectedCss !== null, 'stylesheet not injected');
assert(injectedCss.includes('backdrop-filter:var(--dsw-menu-backdrop-filter,blur('),
  'panel lost its backdrop blur');
assert(injectedCss.includes('-webkit-backdrop-filter'), 'no -webkit backdrop-filter');
assert(injectedCss.includes('--dsw-elevation-stroke-color'), 'panel lost the native stroke');
assert(!injectedCss.includes('z-index:2147483000'), 'panel kept the ad-hoc z-index');
assert(injectedCss.includes('.dcp-turn{'), 'turn-footer chip has no style');

const CostPill = dock.component;
const TurnCost = tail.component;
const internals = moduleExports.__internals;

/* ---- 3. Pricing table behaviour -------------------------------------- */
const peakInstant = Date.parse('2026-11-06T15:20:00+08:00'); // 14:00-18:00 Beijing
const offPeakInstant = Date.parse('2026-11-06T20:20:00+08:00');
const legacyInstant = Date.parse('2026-06-01T10:00:00+08:00');

assert(internals.isPeak(peakInstant) === true, 'peak window not detected');
assert(internals.isPeak(offPeakInstant) === false, 'off-peak window misdetected');

const peakPrice = internals.priceFor('deepseek-v4-pro', peakInstant);
assert(peakPrice.input === 9 && peakPrice.cacheRead === 0.3 && peakPrice.output === 27,
  `peak pro price ${JSON.stringify(peakPrice)}`);

const offPeakPrice = internals.priceFor('DeepSeek-V4-Pro', offPeakInstant);
assert(offPeakPrice.input === 4.5 && offPeakPrice.output === 13.5,
  `off-peak pro price ${JSON.stringify(offPeakPrice)}`);

const flashPrice = internals.priceFor('deepseek-flash', peakInstant);
assert(flashPrice.input === 3 && flashPrice.cacheRead === 0.1 && flashPrice.output === 9,
  `peak flash price ${JSON.stringify(flashPrice)}`);

const legacyPrice = internals.priceFor('deepseek-v4-flash', legacyInstant);
assert(legacyPrice.input === 1 && legacyPrice.output === 2,
  `legacy flash price ${JSON.stringify(legacyPrice)}`);

/* ---- 4. Bill folding ------------------------------------------------- */
function turnLocation(time, usage, messageId) {
  return {
    turn: 1,
    start: { time },
    data: {
      get(key) {
        return key === 'turn-tail'
          ? {
              turn: 1,
              seq: 1,
              time,
              closing: messageId === undefined ? null : { finalNode: { messageId } },
              tokenUsage: usage
            }
          : undefined;
      }
    }
  };
}

const usage = {
  uncachedInputTokens: 1200,
  cacheReadTokens: 1400000,
  cacheWriteTokens: 0,
  outputTokens: 34000,
  routes: [{ provider: 'deepseek', model: 'deepseek-v4-pro' }]
};
const turns = new Map([[1, turnLocation(peakInstant, usage, 'msg-1')]]);

const exact = internals.billOf(turns, usage, 'deepseek-flash', peakInstant);
const expectedExact = (1200 / 1e6) * 9 + (1400000 / 1e6) * 0.3 + (34000 / 1e6) * 27;
assert(Math.abs(exact.cost - expectedExact) < 1e-9, `exact cost ${exact.cost} != ${expectedExact}`);
assert(exact.estimated === false, 'fully attributed bill marked estimated');
assert(exact.model === 'deepseek-v4-pro', `billed model ${exact.model}`);

/* Paged window: the projection covers more than the loaded Turns. */
const wider = { ...usage, cacheReadTokens: usage.cacheReadTokens + 1000000 };
const padded = internals.billOf(turns, wider, 'deepseek-v4-pro', peakInstant);
assert(padded.estimated === true, 'residual history not flagged');
assert(padded.tokens > exact.tokens, 'residual tokens not added');

/* Reopening a historical conversation during the off-peak window must NOT
   reprice the unloaded history at tonight's rate. */
const reopened = internals.billOf(turns, wider, 'deepseek-v4-pro', offPeakInstant);
const reopenedExpected = expectedExact + 1 * 0.3; // +1M cache tokens at the loaded Turn's peak rate
assert(Math.abs(reopened.cost - reopenedExpected) < 1e-9,
  `reopened cost ${reopened.cost} != ${reopenedExpected}`);
assert(reopened.estimatedAt === peakInstant, 'residual anchored on the wrong instant');
assert(reopened.estimatedBlended === true, 'residual did not use the blended rate');

/* ---- 4b. Reopen at night, then keep talking --------------------------- */
const dayPeak = Date.parse('2026-11-05T15:00:00+08:00'); // peak reply
const nightAfter = Date.parse('2026-11-06T22:00:00+08:00'); // new reply, off-peak

const dayUsage = {
  uncachedInputTokens: 100000,
  cacheReadTokens: 2000000,
  cacheWriteTokens: 0,
  outputTokens: 10000,
  routes: [{ provider: 'deepseek', model: 'deepseek-v4-pro' }]
};
const nightUsage = {
  uncachedInputTokens: 50000,
  cacheReadTokens: 1000000,
  cacheWriteTokens: 0,
  outputTokens: 5000,
  routes: [{ provider: 'deepseek', model: 'deepseek-v4-pro' }]
};
const dayCost = 0.1 * 9 + 2 * 0.3 + 0.01 * 27; // 1.77 at peak
const nightCost = 0.05 * 4.5 + 1 * 0.15 + 0.005 * 13.5; // 0.4425 off-peak

const bothTurns = new Map([
  [1, { turn: 1, start: { time: dayPeak }, data: { get: (k) => (k === 'turn-tail' ? { time: dayPeak, tokenUsage: dayUsage } : undefined) } }],
  [2, { turn: 2, start: { time: nightAfter }, data: { get: (k) => (k === 'turn-tail' ? { time: nightAfter, tokenUsage: nightUsage } : undefined) } }]
]);
const wholeLog = {
  uncachedInputTokens: dayUsage.uncachedInputTokens + nightUsage.uncachedInputTokens,
  cacheReadTokens: dayUsage.cacheReadTokens + nightUsage.cacheReadTokens,
  cacheWriteTokens: 0,
  outputTokens: dayUsage.outputTokens + nightUsage.outputTokens
};

const mixed = internals.billOf(bothTurns, wholeLog, 'deepseek-v4-pro', nightAfter);
assert(mixed.estimated === false, 'fully loaded mixed-period bill marked estimated');
assert(mixed.turns === 2, `expected 2 priced turns, got ${mixed.turns}`);
assert(Math.abs(mixed.cost - (dayCost + nightCost)) < 1e-9,
  `mixed cost ${mixed.cost} != ${dayCost + nightCost} (day peak + night off-peak)`);

/* The same session after the window slid past the old Turn: only the night
   Turn stays loaded, the day reply becomes residual and rides the blended rate. */
const slid = internals.billOf(new Map([[2, bothTurns.get(2)]]), wholeLog, 'deepseek-v4-pro', nightAfter);
assert(slid.estimated === true, 'slid window did not flag the estimate');
assert(slid.estimatedBlended === true, 'slid window did not blend');
const slidExpected = nightCost + 0.1 * 4.5 + 2 * 0.15 + 0.01 * 13.5;
assert(Math.abs(slid.cost - slidExpected) < 1e-9, `slid cost ${slid.cost} != ${slidExpected}`);

/* Cold session: no Turn rows at all, projection only. */
const cold = internals.billOf(undefined, usage, 'deepseek-v4-pro', peakInstant);
assert(cold.estimated === true && Math.abs(cold.cost - expectedExact) < 1e-9, `cold bill ${cold.cost}`);

/* ---- 5. Render the registered component ------------------------------ */
function renderPill(props) {
  stateSlots.length = 0;
  return render(React.createElement(CostPill, props));
}

const html = renderPill({
  sessionId: 'session-fixture',
  useChat: (selector) => selector({ timeline: { turns } }),
  useProjection: (key) => (key === 'tokenUsage' ? usage : undefined),
  useSession: () => ({ sessionId: 'session-fixture' })
});

assert(html.includes('data-composer-stat="cost"'), 'pill marker missing');
assert(html.includes('¥1.35'), `expected ¥1.35 in markup, got: ${html}`);
assert(html.includes('dcp-pill'), 'pill class missing');

/* Empty conversation renders nothing at all. */
const blank = renderPill({
  sessionId: 'session-fixture',
  useChat: (selector) => selector({ timeline: { turns: new Map() } }),
  useProjection: () => undefined
});
assert(blank === '', `blank session rendered: ${blank}`);

/* Without the chat half the projection still prices the session. */
const projectionOnly = renderPill({
  sessionId: 'session-fixture',
  useProjection: (key) => (key === 'tokenUsage' ? usage : undefined)
});
assert(projectionOnly.includes('≈'), 'projection-only render lost the estimate marker');

/* An off-peak turn bills at half of peak. */
const offPeak = internals.billOf(
  new Map([[1, turnLocation(offPeakInstant, usage)]]),
  usage,
  'deepseek-flash',
  offPeakInstant
);
assert(Math.abs(offPeak.cost - expectedExact / 2) < 1e-9, `off-peak cost ${offPeak.cost}`);

/* ---- 6. Per-Turn chip ------------------------------------------------- */
const perTurn = internals.billForMessage(turns, 'msg-1', 'deepseek-flash');
assert(perTurn !== null, 'per-Turn bill not found by message id');
assert(Math.abs(perTurn.cost - expectedExact) < 1e-9, `per-Turn cost ${perTurn.cost}`);
assert(perTurn.estimated === false, 'per-Turn bill marked estimated');
assert(perTurn.turns === 1, `per-Turn count ${perTurn.turns}`);
assert(perTurn.peak === true, 'per-Turn period not resolved');
assert(perTurn.cacheHit === 100, `per-Turn cache hit ${perTurn.cacheHit}`);

assert(internals.billForMessage(turns, 'msg-unknown', 'deepseek-flash') === null,
  'unknown message id produced a bill');
assert(internals.billForMessage(undefined, 'msg-1', 'deepseek-flash') === null,
  'missing Turn window produced a bill');
const noUsage = new Map([[1, turnLocation(peakInstant, undefined, 'msg-2')]]);
assert(internals.billForMessage(noUsage, 'msg-2', 'deepseek-flash') === null,
  'Turn without provider usage was priced anyway');

function renderTurn(props) {
  stateSlots.length = 0;
  return render(React.createElement(TurnCost, props));
}

const turnHtml = renderTurn({
  messageId: 'msg-1',
  sessionId: 'session-fixture',
  useChat: (selector) => selector({ timeline: { turns } })
});
assert(turnHtml.includes('data-turn-cost'), 'turn chip marker missing');
assert(turnHtml.includes('¥1.35'), `turn chip lost its amount: ${turnHtml}`);
assert(turnHtml.includes('class="dcp-turn"') || turnHtml.includes('className="dcp-turn"'),
  'turn chip class missing');

const turnHtmlUnknown = renderTurn({
  messageId: 'msg-unknown',
  sessionId: 'session-fixture',
  useChat: (selector) => selector({ timeline: { turns } })
});
assert(turnHtmlUnknown === '', `unknown Turn rendered: ${turnHtmlUnknown}`);

const turnHtmlNoChat = renderTurn({ messageId: 'msg-1', sessionId: 'session-fixture' });
assert(turnHtmlNoChat === '', `Turn chip rendered without the chat kit: ${turnHtmlNoChat}`);

console.log('OK');
console.log('  peak    : ' + internals.money(exact.cost) + '  (deepseek-v4-pro, ' + exact.turns + ' turn)');
console.log('  off-peak: ' + internals.money(offPeak.cost));
console.log('  cold    : ' + internals.money(cold.cost) + ' (projection only, ≈)');
console.log('  per-turn: ' + internals.money(perTurn.cost) + '  (exact, ' + perTurn.cacheHit + '% cache)');
console.log('  pill    : ' + html);
console.log('  turn    : ' + turnHtml);

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
}
