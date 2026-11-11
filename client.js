/*
 * dsh-cost-pill — browser half.
 *
 * Three readouts, one plugin:
 *
 *   1. `conversation.composer.dock`        — what this conversation cost (CNY).
 *   2. `conversation.chat.assistant-actions` — what each completed Turn cost.
 *   3. `sidebar.footer.action`             — the DeepSeek account balance beside
 *      Settings at the sidebar foot: compact glyph on the 56px rail, `¥197.66`
 *      once the sidebar is wide.
 *
 * Cost data path (no Host service, no session-log replay):
 *   - `useChat(s => s.timeline.turns)`  -> per-Turn `turn-tail` rows carrying
 *     exact provider usage plus `routes[].model` attribution and the Turn's
 *     start time, so every reply is priced with the table in force at the
 *     moment it was billed (including the 2026-08-17 peak/off-peak policy).
 *   - `useProjection('tokenUsage')`     -> durable whole-log bucket totals. Any
 *     tokens the loaded Turn window does not cover are priced at the blended
 *     rate of the priced Turns and flagged as an estimate.
 *
 * Balance data path: the plugin's authenticated Host route reads the signed-in
 * account or the configured DeepSeek API key.
 *
 * Bundle format: the ModuleLoader handshake the Client module table expects.
 * `react`, `react-dom` and the UI primitives come from the frozen platform
 * table; nothing else is required, so `dsh.client.external` stays empty.
 */
window.__ModuleLoader__.load({
  id: 'dsh-cost-pill',
  factory(require) {
    var React = require('react');
    var ReactDOM = require('react-dom');

    /* The primitives table is frozen with the shell, but a build without it
       must only cost us the tooltip, never the plugin itself. */
    var primitives = null;
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    } catch (error) {
      primitives = null;
    }

    var CSS_TAG = 'dsh-cost-pill/plugin.css';

    /* ------------------------------------------------------------------ *
     * DeepSeek official pricing, CNY per 1M tokens.
     *
     * 2026-05-22: V4 price cut (flash 1 / 0.02 / 2, pro 3 / 0.025 / 6).
     * 2026-08-17: peak/off-peak. Peak = 09:00-12:00 and 14:00-18:00 Beijing,
     *             off-peak is half of peak.
     * `cacheWrite` is not billed separately by the provider, so cache-write
     * tokens are priced with the uncached-input rate.
     * ------------------------------------------------------------------ */
    var POLICY_SWITCH = Date.parse('2026-08-17T00:00:00+08:00');

    var V4_BASE = {
      flash: { input: 1, cacheRead: 0.02, output: 2 },
      pro: { input: 3, cacheRead: 0.025, output: 6 }
    };
    var V4_PEAK = {
      flash: { input: 3, cacheRead: 0.1, output: 9 },
      pro: { input: 9, cacheRead: 0.3, output: 27 }
    };
    var V4_OFFPEAK = {
      flash: { input: 1.5, cacheRead: 0.05, output: 4.5 },
      pro: { input: 4.5, cacheRead: 0.15, output: 13.5 }
    };
    /* Pre-V4 catalogue, kept so a stray legacy route still prices sanely. */
    var LEGACY = {
      chat: { input: 2, cacheRead: 0.5, output: 8 },
      reasoner: { input: 4, cacheRead: 1, output: 16 }
    };

    /** Route family of one provider model id. */
    function familyOf(model) {
      var id = typeof model === 'string' ? model.toLowerCase() : '';
      if (id.indexOf('pro') !== -1) return 'pro';
      if (id.indexOf('reason') !== -1) return 'reasoner';
      if (id.indexOf('chat') !== -1 && id.indexOf('v4') === -1) return 'chat';
      return 'flash';
    }

    /** Local clock hour in Asia/Shanghai (falls back to the host zone). */
    function beijingHour(ms) {
      var parts;
      try {
        parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          hour12: false
        }).formatToParts(new Date(ms));
      } catch (error) {
        return new Date(ms).getHours();
      }
      for (var i = 0; i < parts.length; i += 1) {
        if (parts[i].type === 'hour') return Number(parts[i].value) % 24;
      }
      return new Date(ms).getHours();
    }

    /** Whether one instant sits in a DeepSeek peak window. */
    function isPeak(ms) {
      var hour = beijingHour(ms);
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
    }

    /** Price row for one model at one instant. */
    function priceFor(model, ms) {
      var family = familyOf(model);
      if (family === 'chat' || family === 'reasoner') return LEGACY[family];
      if (ms < POLICY_SWITCH) return V4_BASE[family];
      return isPeak(ms) ? V4_PEAK[family] : V4_OFFPEAK[family];
    }

    /** Money for one bucket set, priced at one instant. */
    function priceBuckets(buckets, model, ms) {
      var price = priceFor(model, ms);
      return {
        price: price,
        inputCost: (buckets.input / 1e6) * price.input,
        cacheCost: (buckets.cacheRead / 1e6) * price.cacheRead,
        outputCost: (buckets.output / 1e6) * price.output
      };
    }

    /* ------------------------------------------------------------------ *
     * Accounting
     * ------------------------------------------------------------------ */

    /** Usage buckets of one Turn, normalised. */
    function bucketsOf(usage) {
      var cacheWrite = usage.cacheWriteTokens || 0;
      return {
        input: (usage.uncachedInputTokens || 0) + cacheWrite,
        cacheRead: usage.cacheReadTokens || 0,
        output: usage.outputTokens || 0
      };
    }

    /** Billed model of one Turn: the last attributed route, else the fallback. */
    function modelOf(usage, fallback) {
      var routes = usage && usage.routes;
      if (Array.isArray(routes) && routes.length > 0) {
        for (var i = routes.length - 1; i >= 0; i -= 1) {
          if (routes[i] && typeof routes[i].model === 'string') return routes[i].model;
        }
      }
      return fallback;
    }

    /** Money with enough precision for fractions of a fen. */
    function money(value) {
      if (!isFinite(value) || value <= 0) return '¥0.00';
      if (value < 0.001) return '¥' + value.toFixed(4);
      if (value < 0.1) return '¥' + value.toFixed(3);
      return '¥' + value.toFixed(2);
    }

    /** Compact token count, matching the shipped pills' scale words. */
    function tokens(value) {
      if (!isFinite(value) || value <= 0) return '0';
      if (value >= 1e8) return (value / 1e8).toFixed(2) + '亿';
      if (value >= 1e4) return (value / 1e4).toFixed(1) + '万';
      return String(Math.round(value));
    }

    /* ------------------------------------------------------------------ *
     * Account balance (recharge wallet + granted bonus wallet)
     * ------------------------------------------------------------------ */

    /** Two decimals, thousands separators, currency glyph. */
    function formatMoney(currency, amount) {
      var symbol = currency === 'USD' ? '$' : '¥';
      var value = typeof amount === 'number' && isFinite(amount) ? amount : 0;
      if (Math.abs(value) < 0.005) value = 0;
      var parts = value.toFixed(2).split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return symbol + parts.join('.');
    }

    /**
     * Validate the Host's balance payload.
     * @param body - parsed `/api/cost-pill.balance` response.
     * @returns display figures, or null when the Host reported no readable wallet.
     */
    function normalizeBalance(body) {
      if (body === undefined || body === null || body.ok !== true) return null;
      var total = Number(body.total);
      if (!isFinite(total)) return null;
      var recharge = Number(body.recharge);
      var bonus = Number(body.bonus);
      return {
        currency: body.currency === 'USD' ? 'USD' : 'CNY',
        total: total,
        recharge: isFinite(recharge) ? recharge : 0,
        bonus: isFinite(bonus) ? bonus : 0
      };
    }

    /**
     * Fold one conversation into a bill.
     * @param turns - Turn locations of the loaded window, or undefined.
     * @param usage - durable `tokenUsage` projection of the whole log, or undefined.
     * @param fallbackModel - model id used when a reply carries no attribution.
     * @param now - pricing instant for the residual estimate.
     * @returns total, per-bucket money, token totals and an estimate flag.
     */
    function billOf(turns, usage, fallbackModel, now) {
      var bill = {
        input: 0,
        cacheRead: 0,
        output: 0,
        tokens: 0,
        cost: 0,
        inputCost: 0,
        cacheCost: 0,
        outputCost: 0,
        turns: 0,
        model: null,
        estimated: false,
        estimatedTokens: 0,
        estimatedAt: null,
        estimatedBlended: false
      };

      var earliest = Infinity;

      if (turns && typeof turns.forEach === 'function') {
        turns.forEach(function (location) {
          if (!location || !location.data || typeof location.data.get !== 'function') return;
          var tail = location.data.get('turn-tail');
          var turnUsage = tail && tail.tokenUsage;
          if (!turnUsage) return;
          var buckets = bucketsOf(turnUsage);
          var model = modelOf(turnUsage, fallbackModel);
          var time = (location.start && location.start.time) || (tail && tail.time) || now;
          var price = priceFor(model, time);
          if (time < earliest) earliest = time;
          bill.input += buckets.input;
          bill.cacheRead += buckets.cacheRead;
          bill.output += buckets.output;
          bill.inputCost += (buckets.input / 1e6) * price.input;
          bill.cacheCost += (buckets.cacheRead / 1e6) * price.cacheRead;
          bill.outputCost += (buckets.output / 1e6) * price.output;
          bill.turns += 1;
          bill.model = model;
        });
      }

      bill.tokens = bill.input + bill.cacheRead + bill.output;
      bill.cost = bill.inputCost + bill.cacheCost + bill.outputCost;

      if (usage) {
        var whole = bucketsOf(usage);
        var wholeTokens = whole.input + whole.cacheRead + whole.output;
        var restInput = whole.input - bill.input;
        var restCache = whole.cacheRead - bill.cacheRead;
        var restOutput = whole.output - bill.output;
        if (restInput + restCache + restOutput > 0) {
          /*
           * Tokens outside the loaded window happened BEFORE the oldest visible
           * Turn, and we cannot know which of them fell in a peak window. Two
           * candidates were available:
           *
           *   - "now": wrong by construction. Reopen a daytime conversation at
           *     night and every hidden token is re-billed at the night rate.
           *   - the oldest visible Turn's instant: one sample of the period.
           *
           * Neither survives a long session that spans several periods, so the
           * residual is priced with the blended rate the loaded Turns actually
           * paid (cost per token, per bucket). That is self-calibrating: it
           * carries the session's real period mix and model mix, and it stays
           * stable when the window slides. A session with no loaded Turn at all
           * falls back to the current model's price at the current instant.
           */
          var blended = {
            input: bill.input > 0 ? bill.inputCost / bill.input : null,
            cacheRead: bill.cacheRead > 0 ? bill.cacheCost / bill.cacheRead : null,
            output: bill.output > 0 ? bill.outputCost / bill.output : null
          };
          var at = earliest === Infinity ? now : earliest;
          var fallbackPrice = priceFor(bill.model || fallbackModel, at);
          var rate = {
            input: blended.input !== null ? blended.input : fallbackPrice.input / 1e6,
            cacheRead: blended.cacheRead !== null ? blended.cacheRead : fallbackPrice.cacheRead / 1e6,
            output: blended.output !== null ? blended.output : fallbackPrice.output / 1e6
          };
          bill.inputCost += restInput * rate.input;
          bill.cacheCost += restCache * rate.cacheRead;
          bill.outputCost += restOutput * rate.output;
          bill.input += restInput;
          bill.cacheRead += restCache;
          bill.output += restOutput;
          bill.cost = bill.inputCost + bill.cacheCost + bill.outputCost;
          bill.tokens = bill.input + bill.cacheRead + bill.output;
          bill.estimatedTokens = restInput + restCache + restOutput;
          bill.estimated = true;
          bill.estimatedAt = at;
          bill.estimatedBlended = blended.input !== null || blended.cacheRead !== null || blended.output !== null;
        }
        if (bill.model === null && wholeTokens > 0) bill.model = fallbackModel;
      }

      return bill;
    }

    /**
     * Exact bill of ONE completed Turn, addressed by its durable message id.
     *
     * A Turn's `tokenUsage` is provider-reported and, per the chat contract,
     * present only when the loaded evidence for that Turn is complete. When it
     * is absent this returns null and the caller renders nothing: an unpriced
     * receipt is better than an invented one.
     *
     * @param turns - Turn locations of the loaded window.
     * @param messageId - closing assistant message id of the Turn.
     * @param fallbackModel - model id used when the Turn carries no attribution.
     * @returns the Turn's bill, or null.
     */
    function billForMessage(turns, messageId, fallbackModel) {
      if (turns === undefined || turns === null || typeof turns.forEach !== 'function') return null;
      if (typeof messageId !== 'string') return null;
      var found = null;
      turns.forEach(function (location) {
        if (found !== null || location === undefined || location === null) return;
        if (location.data === undefined || location.data === null) return;
        if (typeof location.data.get !== 'function') return;
        var tail = location.data.get('turn-tail');
        var closing = tail === undefined || tail === null ? null : tail.closing;
        var finalNode = closing === undefined || closing === null ? null : closing.finalNode;
        if (finalNode === undefined || finalNode === null) return;
        if (finalNode.messageId !== messageId) return;
        var usage = tail.tokenUsage;
        if (usage === undefined || usage === null) return;
        var time = (location.start && location.start.time) || tail.time || Date.now();
        var buckets = bucketsOf(usage);
        var model = modelOf(usage, fallbackModel);
        var priced = priceBuckets(buckets, model, time);
        var promptSide = buckets.input + buckets.cacheRead;
        found = {
          turns: 1,
          model: model,
          input: buckets.input,
          cacheRead: buckets.cacheRead,
          output: buckets.output,
          tokens: promptSide + buckets.output,
          inputCost: priced.inputCost,
          cacheCost: priced.cacheCost,
          outputCost: priced.outputCost,
          cost: priced.inputCost + priced.cacheCost + priced.outputCost,
          price: priced.price,
          time: time,
          peak: isPeak(time),
          cacheHit: promptSide > 0 ? Math.round((buckets.cacheRead / promptSide) * 100) : null,
          estimated: false,
          estimatedTokens: 0,
          estimatedAt: null,
          estimatedBlended: false
        };
      });
      return found;
    }

    /* ------------------------------------------------------------------ *
     * Presentation
     * ------------------------------------------------------------------ */

    var CSS = [
      /* The three shipped pills' metrics, so the cell sits flush in the row. */
      '.dcp-anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}',
      '.dcp-pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;',
      'color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;',
      'line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;',
      'padding:1px 8px;display:inline-flex;cursor:pointer}',
      '.dcp-pill svg{flex:none;width:14px;height:14px}',
      '.dcp-pill:hover,.dcp-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary)}',
      '.dcp-label{text-overflow:ellipsis;min-width:0;overflow:hidden}',
      /* The completed-Turn footer chip: same text run as 用量 N tok, no chrome
         until hovered, so the action row keeps one visual weight. */
      '.dcp-turn-anchor{display:inline-flex;align-items:center;min-width:0}',
      '.dcp-turn{font:inherit;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;',
      'color:var(--dsw-alias-label-tertiary);background:0 0;border:0;border-radius:var(--dsw-radius-sm);',
      'padding:1px 6px;margin:0;cursor:pointer;white-space:nowrap}',
      '.dcp-turn:hover,.dcp-turn[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary)}',
      /* The shipped stat-dialog material: translucent menu surface over a real
         backdrop blur, so the composer text underneath never bleeds through. */
      '.dcp-panel{position:fixed;z-index:1100;transform:translateX(-50%);box-sizing:border-box;',
      'width:max-content;min-width:min(268px,100vw - 24px);max-width:min(360px,100vw - 24px);',
      'padding:14px 16px 13px;border-radius:var(--dsw-radius-lg);border:0;cursor:default;',
      'background:var(--dsw-specific-menu);',
      'backdrop-filter:var(--dsw-menu-backdrop-filter,blur(20px) saturate(180%));',
      '-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(20px) saturate(180%));',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;',
      'font-variant-numeric:tabular-nums;font-family:inherit}',
      '.dcp-title{display:flex;align-items:baseline;justify-content:space-between;gap:16px;',
      'color:var(--dsw-alias-label-primary);font-weight:500;margin-bottom:8px}',
      '.dcp-title-value{font-variant-numeric:tabular-nums;font-weight:600}',
      '.dcp-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.dcp-details{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;',
      'margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.dcp-details dt,.dcp-details dd{min-width:0;margin:0}',
      '.dcp-details dd{color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap}',
      '.dcp-foot{margin-top:10px;padding-top:9px;border-top:.5px solid var(--dsw-alias-border-l2);',
      'color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}',
      '.dcp-foot em{font-style:normal;color:var(--dsw-alias-label-secondary)}',
      /* Sidebar-foot balance: one quiet key/value row that matches the
         sidebar's own text rhythm instead of inventing a widget. */
      '.dcp-bal{box-sizing:border-box;width:100%;height:28px;padding:0 6px;margin:0;border:0;',
      'border-radius:var(--dsw-radius-sm);background:0 0;display:flex;align-items:center;',
      'justify-content:space-between;gap:8px;font:inherit;color:var(--dsw-alias-label-secondary);',
      'cursor:default;white-space:nowrap}',
      '.dcp-bal[data-rail="true"]{width:28px;padding:0;justify-content:center}',
      '.dcp-bal-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;',
      'letter-spacing:.04em}',
      '.dcp-bal-value{font-size:12px;line-height:1;font-weight:500;font-variant-numeric:tabular-nums;',
      'letter-spacing:.01em;color:var(--dsw-alias-label-secondary)}',
      '.dcp-bal[data-state="empty"] .dcp-bal-value,',
      '.dcp-bal[data-state="error"] .dcp-bal-value{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.dcp-bal-sym{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-right:2px}',
      '.dcp-bal[data-rail="true"] .dcp-bal-sym{font-size:13px;margin-right:0}'
    ].join('');

    /** Install the stylesheet once per page; returns its disposer. */
    function installStyle() {
      if (typeof document === 'undefined') return function () {};
      if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) {
        return function () {};
      }
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-cost-pill';
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function () {
        tag.remove();
      };
    }

    /** The ¥ glyph, drawn inline so no icon package is required. */
    function CoinIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': true },
        React.createElement('circle', {
          cx: 8,
          cy: 8,
          r: 6.4,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3
        }),
        React.createElement('path', {
          d: 'M5.3 5.2 8 8.4l2.7-3.2M8 8.4v3.1M6.1 9.1h3.8M6.1 10.7h3.8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      );
    }

    /** Beijing wall-clock label of one instant, e.g. `11/06 14:05`. */
    function stamp(ms) {
      var value = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(value));
      } catch (error) {
        var date = new Date(value);
        function pad(n) {
          return n < 10 ? '0' + n : String(n);
        }
        return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' +
          pad(date.getHours()) + ':' + pad(date.getMinutes());
      }
    }

    /**
     * The dock cell: one pill plus its own dialogs.
     * Standard slot kit supplies `useChat`, `useProjection` and `sessionId`.
     */
    function CostPill(props) {
      var useChat = typeof props.useChat === 'function' ? props.useChat : null;
      var useProjection = typeof props.useProjection === 'function' ? props.useProjection : null;

      var turns = useChat !== null ? useChat(selectTurns) : undefined;
      var usage = useProjection !== null ? useProjection('tokenUsage') : undefined;

      var pop = usePopover();
      var open = pop.open;

      var bill = React.useMemo(function () {
        return billOf(turns, usage, 'deepseek-flash', Date.now());
      }, [turns, usage]);

      if (bill.tokens <= 0) return null;

      var label = (bill.estimated ? '≈' : '') + money(bill.cost);
      var peak = isPeak(Date.now());
      var showPrice = priceFor(bill.model || 'deepseek-flash', Date.now());

      var panel = open && pop.pos !== null
        ? ReactDOM.createPortal(
            Dialog({
              panelRef: pop.panelRef,
              label: '本次对话花费',
              pos: pop.pos,
              children: [
                BillRows({ bill: bill, title: '本次对话花费', amount: label }),
                React.createElement(
                  'div',
                  { key: 'foot', className: 'dcp-foot' },
                  React.createElement(
                    'div',
                    null,
                    '已计价 ' + String(bill.turns) + ' 轮 · 合计 ' + tokens(bill.tokens) + ' tokens'
                  ),
                  React.createElement(
                    'div',
                    null,
                    '当前时段' + (peak ? '高峰' : '空闲') +
                      '（09:00–12:00 / 14:00–18:00 为高峰，北京时间）· 输入 ' + String(showPrice.input) +
                      ' / 缓存 ' + String(showPrice.cacheRead) +
                      ' / 输出 ' + String(showPrice.output) + ' 元每百万 tokens'
                  ),
                  bill.estimated
                    ? React.createElement(
                        'div',
                        null,
                        React.createElement('em', null, '≈'), ' 其中 ' + tokens(bill.estimatedTokens) +
                          ' tokens 早于已加载窗口，' +
                          (bill.estimatedBlended
                            ? '按已计价轮次的实际均价估算'
                            : '按 ' + stamp(bill.estimatedAt) + ' 的时段估算')
                      )
                    : React.createElement(
                        'div',
                        null,
                        '每条回复按它发生时刻的价格计价，高峰 / 空闲自动切换'
                      )
                )
              ]
            }),
            document.body
          )
        : null;

      return React.createElement(
        'span',
        { className: 'dcp-anchor' },
        React.createElement(
          'button',
          {
            ref: pop.btnRef,
            type: 'button',
            className: 'dcp-pill',
            'data-composer-stat': 'cost',
            'aria-haspopup': 'dialog',
            'aria-expanded': pop.open,
            'aria-label': '本次对话花费 ' + money(bill.cost),
            title: '本次对话花费（点击查看明细）',
            onClick: pop.toggle
          },
          React.createElement(CoinIcon, null),
          React.createElement('span', { className: 'dcp-label' }, label)
        ),
        panel
      );
    }

    /**
     * Shared anchored-popover state: outside-pointerdown and Escape close it,
     * the anchor's rect places it, and the panel never clips off-screen.
     * @returns open state, position, toggle, and the two refs.
     */
    function usePopover() {
      var openState = React.useState(false);
      var posState = React.useState(null);
      var btnRef = React.useRef(null);
      var panelRef = React.useRef(null);
      var open = openState[0];
      var setOpen = openState[1];
      var pos = posState[0];
      var setPos = posState[1];

      React.useEffect(function () {
        if (!open) return undefined;
        function onPointerDown(event) {
          var panel = panelRef.current;
          var button = btnRef.current;
          if (panel !== null && panel.contains(event.target)) return;
          if (button !== null && button.contains(event.target)) return;
          setOpen(false);
        }
        function onKeyDown(event) {
          if (event.key === 'Escape') setOpen(false);
        }
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return function () {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      function toggle() {
        var next = !open;
        if (next && btnRef.current !== null) {
          var rect = btnRef.current.getBoundingClientRect();
          var half = 184; // half of the panel's max width, so it never clips off-screen
          setPos({
            left: Math.round(
              Math.min(Math.max(rect.left + rect.width / 2, half), Math.max(half, window.innerWidth - half))
            ),
            bottom: Math.round(window.innerHeight - rect.top + 8)
          });
        }
        setOpen(next);
      }

      return { open: open, pos: pos, toggle: toggle, btnRef: btnRef, panelRef: panelRef };
    }

    /** The dialog shell both entries share: native material plus anchored placement. */
    function Dialog(props) {
      return React.createElement(
        'div',
        {
          ref: props.panelRef,
          className: 'dcp-panel',
          role: 'dialog',
          'aria-label': props.label,
          style: { left: props.pos.left + 'px', bottom: props.pos.bottom + 'px' }
        },
        props.children
      );
    }

    /** Title + rule + the three billed buckets; shared by both dialogs. */
    function BillRows(props) {
      var bill = props.bill;
      return [
        React.createElement(
          'div',
          { key: 'title', className: 'dcp-title' },
          React.createElement('span', null, props.title),
          React.createElement('span', { className: 'dcp-title-value' }, props.amount)
        ),
        React.createElement('div', { key: 'rule', className: 'dcp-rule' }),
        React.createElement(
          'dl',
          { key: 'rows', className: 'dcp-details' },
          React.createElement('dt', null, '输入（未命中 + 缓存写入）'),
          React.createElement('dd', null, tokens(bill.input) + ' · ' + money(bill.inputCost)),
          React.createElement('dt', null, '缓存命中'),
          React.createElement('dd', null, tokens(bill.cacheRead) + ' · ' + money(bill.cacheCost)),
          React.createElement('dt', null, '输出'),
          React.createElement('dd', null, tokens(bill.output) + ' · ' + money(bill.outputCost))
        )
      ];
    }

    /**
     * Per-Turn chip in the completed-Turn footer row (right beside 用量 N tok).
     *
     * Exact by construction: the chip only renders for a Turn whose
     * provider-reported `tokenUsage` is present, and prices it at that Turn's
     * own `turn/start` instant. A Turn with incomplete evidence shows nothing.
     */
    function TurnCost(props) {
      var useChat = typeof props.useChat === 'function' ? props.useChat : null;
      var turns = useChat !== null ? useChat(selectTurns) : undefined;
      var pop = usePopover();

      var bill = React.useMemo(function () {
        return billForMessage(turns, props.messageId, 'deepseek-flash');
      }, [turns, props.messageId]);

      if (bill === null || bill.tokens <= 0) return null;

      var label = money(bill.cost);
      var panel = pop.open && pop.pos !== null
        ? ReactDOM.createPortal(
            Dialog({
              panelRef: pop.panelRef,
              label: '本轮花费',
              pos: pop.pos,
              children: [
                BillRows({ bill: bill, title: '本轮花费', amount: label }),
                React.createElement(
                  'div',
                  { key: 'foot', className: 'dcp-foot' },
                  React.createElement(
                    'div',
                    null,
                    '模型 ' + bill.model + ' · ' + stamp(bill.time) +
                      ' · ' + (bill.peak ? '高峰' : '空闲') + '时段'
                  ),
                  React.createElement(
                    'div',
                    null,
                    '输入 ' + String(bill.price.input) + ' / 缓存 ' + String(bill.price.cacheRead) +
                      ' / 输出 ' + String(bill.price.output) + ' 元每百万 tokens'
                  ),
                  bill.cacheHit !== null
                    ? React.createElement('div', null, '缓存命中 ' + String(bill.cacheHit) + '%')
                    : null
                )
              ]
            }),
            document.body
          )
        : null;

      return React.createElement(
        'span',
        { className: 'dcp-turn-anchor' },
        React.createElement(
          'button',
          {
            ref: pop.btnRef,
            type: 'button',
            className: 'dcp-turn',
            'data-turn-cost': money(bill.cost),
            'aria-haspopup': 'dialog',
            'aria-expanded': pop.open,
            'aria-label': '本轮花费 ' + label,
            title: '本轮花费（点击查看明细）',
            onClick: pop.toggle
          },
          label
        ),
        panel
      );
    }

    /**
     * Presentational footer cell: one quiet key/value row — `余额` on the left
     * of the sidebar's own 11px label scale, the figure on the right in the
     * 12px value scale. No chrome, no border, no hover: it is a readout, not a
     * control, so it must not compete with the avatar and Settings beneath it.
     *
     * Unknown states degrade to a tertiary dash rather than a diagnostic glyph.
     */
    function BalanceCell(props) {
      var state = props.state;
      if (state === undefined || state === null || state.kind === 'pending') return null;
      var wide = props.wide === true;
      var ok = state.kind === 'ok';
      var summary = ok ? state.summary : null;
      var symbol = ok && summary.currency === 'USD' ? '$' : '¥';
      var amount = ok ? formatMoney(summary.currency, summary.total) : '';

      var value = ok
        ? [
            React.createElement('span', { key: 'sym', className: 'dcp-bal-sym' }, symbol),
            amount.slice(symbol.length)
          ]
        : '—';

      var children = wide
        ? [
            React.createElement('span', { key: 'label', className: 'dcp-bal-label' }, '余额'),
            React.createElement('span', { key: 'value', className: 'dcp-bal-value' }, value)
          ]
        : React.createElement('span', { className: 'dcp-bal-sym' }, symbol);

      var button = React.createElement(
        'button',
        {
          type: 'button',
          className: 'dcp-bal',
          'data-rail': wide ? 'false' : 'true',
          'data-state': state.kind,
          'data-balance': ok ? amount : '',
          'aria-label': ok ? '账户余额 ' + amount : '账户余额暂不可用'
        },
        children
      );

      var tip = ok
        ? '充值 ' + formatMoney(summary.currency, summary.recharge) +
          ' · 赠送 ' + formatMoney(summary.currency, summary.bonus)
        : state.reason === 'no-grant-no-key'
          ? '没有账号登录，也没有可用的 DEEPSEEK_API_KEY'
          : '余额读取失败（' + (state.reason || 'unknown') + '）';
      if (primitives !== null && typeof primitives.Tooltip === 'function') {
        return React.createElement(primitives.Tooltip, { label: tip, side: 'top', delayMs: 240 }, button);
      }
      return React.createElement('span', { title: tip }, button);
    }

    /** Poll the authenticated Host route while the sidebar is mounted. */
    function SidebarBalance(props) {
      var stateData = React.useState({ kind: 'pending' });
      var state = stateData[0];
      var setState = stateData[1];

      React.useEffect(function () {
        var disposed = false;
        var loading = false;
        var retryTimer = null;
        var request = new AbortController();

        async function load(retry = true) {
          if (disposed || loading || retryTimer !== null) return;
          loading = true;
          var next;
          try {
            var response = await fetch('./api/cost-pill.balance', {
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
              signal: request.signal
            });
            if (response.ok) {
              var body = await response.json().catch(function () { return null; });
              var summary = normalizeBalance(body);
              next = summary !== null ? { kind: 'ok', summary: summary } : {
                kind: 'empty', reason: body && body.reason || 'bad-json'
              };
            } else {
              next = { kind: 'error', reason: 'http-' + response.status };
            }
          } catch (error) {
            next = { kind: 'error', reason: 'network' };
          } finally {
            loading = false;
          }
          if (disposed) return;
          if (retry && /^(?:network|bad-json|internal|http-(?:408|429|5\d\d))$/.test(next.reason)) {
            retryTimer = setTimeout(function () {
              retryTimer = null;
              load(false);
            }, 2000);
            return;
          }
          setState(next);
        }

        function onVisible() {
          if (document.hidden !== true) load();
        }

        load();
        var interval = setInterval(load, 60000);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return function () {
          disposed = true;
          request.abort();
          clearInterval(interval);
          clearTimeout(retryTimer);
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('focus', onVisible);
        };
      }, []);

      return React.createElement(BalanceCell, { state: state, wide: props.wide === true });
    }

    /** Selector: the Turn locations that carry per-Turn usage. */
    function selectTurns(snapshot) {
      if (snapshot === undefined || snapshot === null) return undefined;
      return snapshot.timeline !== undefined && snapshot.timeline !== null
        ? snapshot.timeline.turns
        : undefined;
    }

    /** Required service: the UI slot registry. */
    var inject = ['slots'];

    /**
     * Register the composer-stats cell, per-Turn footer chip and sidebar balance.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(installStyle, 'dsh-cost-pill: stylesheet');
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'cost',
            order: 2
          },
          CostPill
        );
      });
      ctx.slots.inject('conversation.chat.assistant-actions', function () {
        return ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: 'cost',
            /* After the shipped copy/feedback actions, before the usage badge. */
            order: 60
          },
          TurnCost
        );
      });
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'balance',
            order: 10
          },
          SidebarBalance
        );
      });
    }

    return {
      inject: inject,
      apply: apply,
      /* Exported for the offline render harness; the loader ignores extra keys. */
      __internals: {
        priceFor: priceFor,
        isPeak: isPeak,
        billOf: billOf,
        billForMessage: billForMessage,
        normalizeBalance: normalizeBalance,
        formatMoney: formatMoney,
        money: money,
        CostPill: CostPill,
        TurnCost: TurnCost,
        BalanceCell: BalanceCell
      }
    };
  }
});
