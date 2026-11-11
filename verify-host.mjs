/*
 * Offline verification for the Host half.
 *
 * Exercise route registration, the two balance sources and their wallet mapping.
 *
 * Run:  node verify-host.mjs
 */
import { apply, inject, __internals } from './index.js';

const { fromDeepSeek, pick, sumBy } = __internals;

/* ---- account controller wallets --------------------------------------- */
const account = pick(
  [{ currency: 'CNY', balance: '180.00' }],
  [{ currency: 'CNY', balance: '17.66' }]
);
assert(account !== null, 'account wallets produced nothing');
assert(account.currency === 'CNY', `currency ${account.currency}`);
assert(Math.abs(account.total - 197.66) < 1e-9, `total ${account.total}`);
assert(Math.abs(account.recharge - 180) < 1e-9, `recharge ${account.recharge}`);
assert(Math.abs(account.bonus - 17.66) < 1e-9, `bonus ${account.bonus}`);

assert(pick([], []) === null, 'empty wallets produced a summary');
assert(pick(undefined, undefined) === null, 'missing wallets produced a summary');
assert(sumBy([{ currency: 'CNY', balance: 'x' }, { currency: 'CNY', balance: '2' }], 'CNY') === 2,
  'non-numeric wallet leaked into the sum');

const usd = pick([{ currency: 'USD', balance: '12.30' }], []);
assert(usd !== null && usd.currency === 'USD' && Math.abs(usd.total - 12.3) < 1e-9, 'usd wallets misread');

/* ---- DeepSeek /user/balance ------------------------------------------- */
const api = fromDeepSeek({
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }
  ]
});
assert(api !== null, 'api payload produced nothing');
assert(Math.abs(api.total - 110) < 1e-9, `api total ${api.total}`);
assert(Math.abs(api.recharge - 100) < 1e-9, `api recharge ${api.recharge}`);
assert(Math.abs(api.bonus - 10) < 1e-9, `api bonus ${api.bonus}`);

/* USD accounts and the absent-wallet paths. */
const apiUsd = fromDeepSeek({
  balance_infos: [{ currency: 'USD', total_balance: '5.5', granted_balance: '0', topped_up_balance: '5.5' }]
});
assert(apiUsd.currency === 'USD', `api currency ${apiUsd.currency}`);
assert(fromDeepSeek({ balance_infos: [] }) === null, 'empty infos accepted');
assert(fromDeepSeek(null) === null, 'null body accepted');
assert(fromDeepSeek({ balance_infos: [{ currency: 'CNY' }] }) === null, 'unparsable amounts accepted');

/* ---- Host registration and account/API key fallback ------------------ */
function register(controller) {
  let route;
  const services = {
    connection: { fetch: { register(value) { route = value; } } },
    credentials: {
      async resolve(ref) {
        assert(ref === 'DEEPSEEK_API_KEY', 'wrong credential reference');
        return { value: 'test-key' };
      }
    }
  };
  const ctx = Object.fromEntries(inject.map((name) => [name, services[name]]));
  ctx.inject = (deps, callback) => {
    assert(deps.length === 1 && deps[0] === 'accountController', 'wrong account injection');
    if (controller) callback({ accountController: controller, effect: (effect) => effect() });
  };
  apply(ctx);
  assert(route?.path === '/api/cost-pill.balance', 'balance route not registered');
  assert(route.methods.join() === 'GET' && route.requestBody === 'buffered', 'wrong route options');
  return route;
}

const signedIn = register({
  async getBalance() {
    return { status: 'ready', value: [{ currency: 'CNY', balance: '18.00' }], bonusWallets: [] };
  }
});
const accountResult = await (await signedIn.fetch()).json();
assert(accountResult.source === 'account' && accountResult.total === 18, 'signed-in route failed');

const apiKeyOnly = register();
const realFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert(url === 'https://api.deepseek.com/user/balance', 'unexpected balance URL');
    assert(options.headers.Authorization === 'Bearer test-key', 'credential not sent to DeepSeek');
    return Response.json({
      balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }]
    });
  };
  const responses = await Promise.all([apiKeyOnly.fetch(), apiKeyOnly.fetch()]);
  for (const response of responses) {
    assert(response.headers.get('cache-control') === 'no-store', 'response is browser-cacheable');
    const body = await response.json();
    assert(body.ok && body.source === 'api-key' && body.total === 0, 'API key fallback lost zero balance');
  }
  assert(calls === 1, 'concurrent polls made multiple upstream requests');

  const recovering = register();
  const workingFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  assert((await (await recovering.fetch()).json()).reason === 'http-503', 'lost upstream HTTP status');
  globalThis.fetch = workingFetch;
  assert((await (await recovering.fetch()).json()).ok, 'a temporary failure was cached');
} finally {
  globalThis.fetch = realFetch;
}

console.log('OK');
console.log('  account: ' + account.total.toFixed(2) + ' (recharge ' + account.recharge.toFixed(2) +
  ' + bonus ' + account.bonus.toFixed(2) + ')');
console.log('  api-key: ' + api.total.toFixed(2) + ' (recharge ' + api.recharge.toFixed(2) +
  ' + bonus ' + api.bonus.toFixed(2) + ')');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL: ' + message);
    process.exit(1);
  }
}
