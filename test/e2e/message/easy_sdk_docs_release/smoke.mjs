import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { assert, sha256, validatePlan } from '../../../../docs-site/scripts/easy-sdk-sync/core.mjs';

const directory = resolve(process.env.WK_ARTIFACT_DIRECTORY);
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const plan = validatePlan(JSON.parse(await readFile(resolve(directory, 'plan.json'), 'utf8')));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert(source === plan.docsSource, 'Server checkout does not match the acceptance plan');
const apiURL = process.env.WK_API_URL, wsURL = process.env.WK_WS_URL;
assert(new URL(apiURL).hostname === '127.0.0.1' && new URL(wsURL).hostname === '127.0.0.1', 'Acceptance requires isolated loopback endpoints');
const bundle = await readFile(resolve(directory, 'consumer/tutorial.js'));
const identities = ['alice', 'bob'].map((name) => ({ uid: `docs-${name}-${randomUUID()}`, token: randomUUID(), session: randomUUID() }));
let stage = 'provision';
let browser;
const sockets = new Set();
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/api/im/bootstrap') {
    const identity = identities.find((item) => request.headers.cookie === `session=${item.session}`);
    response.setHeader('Content-Type', 'application/json');
    response.writeHead(identity ? 200 : 401);
    response.end(identity ? JSON.stringify({ uid: identity.uid, token: identity.token, websocketUrl: wsURL }) : '{}');
  } else if (request.url === '/tutorial.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(bundle);
  } else if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<button id="send-message" disabled>Send</button><pre id="received-message"></pre><script type="module" src="/tutorial.js"></script>');
  } else { response.writeHead(404); response.end(); }
});
// Hold one handshake open to exercise the tutorial's complete connection deadline.
server.on('upgrade', (_request, socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
async function http(path, body) {
  const response = await fetch(`${apiURL}${path}`, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  assert(response.ok, `Product HTTP ${path} failed`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
async function online(expected) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const entries = (await http('/user/onlinestatus', identities.map((item) => item.uid))) ?? [];
    if (identities.every((item, index) => entries.filter((entry) => entry.uid === item.uid && entry.online === 1).length === Number(expected[index]))) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Online routes did not converge');
}

try {
  for (const item of identities) await http('/user/token', { uid: item.uid, token: item.token, device_flag: 1, device_level: 1 });
  const route = await http('/route');
  assert(route.ws_addr === wsURL, 'Public route does not match the isolated Gateway');
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stalledURL = `${origin.replace('http:', 'ws:')}/stall`;
  stage = 'browserLaunch';
  browser = await chromium.launch({ channel: 'chromium', headless: true, chromiumSandbox: true });
  stage = 'connect';
  const pages = [];
  for (const identity of identities) {
    const context = await browser.newContext();
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', (socket) => {
      if ([wsURL, stalledURL].includes(socket.url())) socket.connectToServer();
      else socket.close();
    });
    await context.addCookies([{ name: 'session', value: identity.session, url: origin, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(origin);
    await page.waitForFunction(() => window.__easySDKTest && !document.querySelector('#send-message').disabled);
    pages.push(page);
  }
  await online([true, true]);
  stage = 'bidirectional';
  for (const sender of [0, 1]) {
    const receiver = 1 - sender, content = `message-${randomUUID()}`;
    await pages[sender].evaluate(({ uid, content }) => window.__easySDKTest.chat.sendText(uid, content), { uid: identities[receiver].uid, content });
    await pages[receiver].waitForFunction(({ uid, content }) => {
      try {
        const message = JSON.parse(document.querySelector('#received-message').textContent);
        return message.fromUid === uid && message.payload.content === content;
      } catch { return false; }
    }, { uid: identities[sender].uid, content });
  }
  stage = 'cleanup';
  await pages[1].evaluate(() => { window.__easySDKTest.chat.stop(); window.__easySDKTest.chat.stop(); });
  await online([true, false]);
  stage = 'reconnect';
  await pages[1].evaluate(async () => window.__easySDKTest.chat.start(await (await fetch('/api/im/bootstrap')).json()));
  await online([true, true]);
  const content = `reconnected-${randomUUID()}`;
  await pages[0].evaluate(({ uid, content }) => window.__easySDKTest.chat.sendText(uid, content), { uid: identities[1].uid, content });
  await pages[1].waitForFunction((content) => JSON.parse(document.querySelector('#received-message').textContent).payload.content === content, content);
  for (const page of pages) await page.evaluate(() => window.__easySDKTest.chat.stop());
  await online([false, false]);
  stage = 'connectTimeout';
  const timedOut = await pages[0].evaluate(async (websocketUrl) => {
    const client = new window.__easySDKTest.EasyChatClient(() => {});
    const bootstrap = await (await fetch('/api/im/bootstrap')).json();
    const started = performance.now();
    try { await client.start({ ...bootstrap, websocketUrl }); return false; }
    catch { return performance.now() - started >= 9000 && performance.now() - started < 15_000; }
    finally { client.stop(); }
  }, stalledURL);
  assert(timedOut, 'Tutorial did not bound the WebSocket handshake');
  await online([false, false]);
  stage = 'receipt';
  const zh = await readFile(resolve(root, 'docs-site/content/docs/sdk/easy/javascript/getting-started.mdx'));
  const en = await readFile(resolve(root, 'docs-site/content/docs/sdk/easy/javascript/getting-started.en.mdx'));
  const receipt = {
    schema: 'wukongim.easy-sdk-docs-receipt/v1', status: 'passed', planSha256: sha256(JSON.stringify(plan)),
    runId: process.env.GITHUB_RUN_ID ?? 'local', serverSource: source, version: plan.version, integrity: plan.integrity,
    tutorialSha256: sha256(Buffer.concat([zh, Buffer.from('\n'), en])),
    consumerLockSha256: sha256(await readFile(resolve(directory, 'consumer/package-lock.json'))),
    toolLockSha256: sha256(await readFile(new URL('package-lock.json', import.meta.url))),
    chromium: browser.version(), node: process.version,
    checks: { compiled: true, bidirectional: true, cleanup: true, reconnect: true, connectTimeout: true },
  };
  await writeFile(resolve(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log('Web EasySDK browser acceptance passed: compilation, bidirectional messages, cleanup, reconnect and connection deadline.');
} catch {
  // Browser assertions can carry credentials or payloads. Only publish the fixed stage.
  console.error(`Web EasySDK browser acceptance failed at stage: ${stage}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((done) => server.close(done));
}
