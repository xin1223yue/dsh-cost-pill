/** Read balance through DSH's authenticated Host transport. */
const PATH = '/api/cost-pill.balance';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const CACHE_MS = 30000;
const CLIENT_VERSION = '0.2.1-rc.5';

export const inject = ['connection', 'credentials'];

export function apply(ctx) {
  let accountController;
  ctx.inject(['accountController'], (scope) => {
    scope.effect(() => {
      accountController = scope.accountController;
      return () => { accountController = undefined; };
    }, 'dsh-cost-pill: account controller');
  });

  let cache;
  let pending;
  ctx.connection.fetch.register({
    path: PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      let payload = cache?.expires > Date.now() ? cache.payload : undefined;
      if (payload === undefined) {
        pending ??= readFresh(accountController, ctx.credentials)
          .catch(() => ({ ok: false, reason: 'internal' }))
          .then((result) => {
            if (result.ok) cache = { expires: Date.now() + CACHE_MS, payload: result };
            return result;
          })
          .finally(() => { pending = undefined; });
        payload = await pending;
      }
      return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
    }
  });
}

/**
 * One uncached read, account first, API key second.
 * @param controller - optional DSH account controller.
 * @param credentials - DSH credentials provider.
 * @returns the wire payload.
 */
async function readFresh(controller, credentials) {
  const account = await readAccount(controller);
  if (account !== null) return { ok: true, source: 'account', ...account };

  const key = (await credentials.resolve('DEEPSEEK_API_KEY'))?.value;
  if (!key) return { ok: false, reason: 'no-grant-no-key' };

  let response;
  try {
    response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'http-' + response.status };

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    return { ok: false, reason: 'bad-json' };
  }
  const wallets = fromDeepSeek(body);
  if (wallets === null) return { ok: false, reason: 'no-wallet' };
  return { ok: true, source: 'api-key', ...wallets };
}

/**
 * Signed-in account balance through the shipped controller.
 * @param controller - optional DSH account controller.
 * @returns display figures, or null when no grant answered.
 */
async function readAccount(controller) {
  if (controller === undefined) return null;
  let balance;
  try {
    balance = await controller.getBalance({
      version: CLIENT_VERSION,
      locale: 'zh',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
    });
  } catch (error) {
    return null;
  }
  if (balance === undefined || balance === null || balance.status !== 'ready') return null;
  return pick(balance.value, balance.bonusWallets);
}

/**
 * Fold the controller's wallet arrays into display figures.
 * @param wallets - recharge wallets.
 * @param bonusWallets - granted wallets.
 * @returns figures, or null when nothing is readable.
 */
function pick(wallets, bonusWallets) {
  const recharge = sumBy(wallets, 'CNY');
  const bonus = sumBy(bonusWallets, 'CNY');
  const rechargeUsd = sumBy(wallets, 'USD');
  const bonusUsd = sumBy(bonusWallets, 'USD');
  if (recharge === 0 && bonus === 0 && rechargeUsd === 0 && bonusUsd === 0) {
    const sawAny = (Array.isArray(wallets) && wallets.length > 0) ||
      (Array.isArray(bonusWallets) && bonusWallets.length > 0);
    if (!sawAny) return null;
  }
  const currency = recharge === 0 && bonus === 0 && (rechargeUsd > 0 || bonusUsd > 0) ? 'USD' : 'CNY';
  const useRecharge = currency === 'USD' ? rechargeUsd : recharge;
  const useBonus = currency === 'USD' ? bonusUsd : bonus;
  return { currency, total: useRecharge + useBonus, recharge: useRecharge, bonus: useBonus };
}

/**
 * Sum one currency across wallets.
 * @param wallets - wallet list.
 * @param currency - currency to keep.
 * @returns the sum.
 */
function sumBy(wallets, currency) {
  if (!Array.isArray(wallets)) return 0;
  let total = 0;
  for (const wallet of wallets) {
    if (wallet === null || wallet === undefined || wallet.currency !== currency) continue;
    const value = Number(wallet.balance);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/**
 * Map the `/user/balance` response onto display figures.
 * @param body - parsed response body.
 * @returns figures, or null when no wallet is present.
 */
function fromDeepSeek(body) {
  const infos = body !== null && typeof body === 'object' && Array.isArray(body.balance_infos)
    ? body.balance_infos
    : [];
  if (infos.length === 0) return null;
  const info = infos.find((entry) => entry !== null && entry.currency === 'CNY') || infos[0];
  if (info === undefined || info === null) return null;
  const total = Number(info.total_balance);
  const recharge = Number(info.topped_up_balance);
  const bonus = Number(info.granted_balance);
  if (!Number.isFinite(total) && !Number.isFinite(recharge) && !Number.isFinite(bonus)) return null;
  return {
    currency: typeof info.currency === 'string' && info.currency !== '' ? info.currency : 'CNY',
    total: Number.isFinite(total) ? total : 0,
    recharge: Number.isFinite(recharge) ? recharge : 0,
    bonus: Number.isFinite(bonus) ? bonus : 0
  };
}

/** Pure helpers exposed for the offline harness. */
export const __internals = { fromDeepSeek, pick, sumBy };
