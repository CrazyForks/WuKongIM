import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { assert, validatePlan } from '../../../../docs-site/scripts/easy-sdk-sync/core.mjs';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const tools = fileURLToPath(new URL('.', import.meta.url));
const directory = resolve(process.argv[2]);
const plan = validatePlan(JSON.parse(await readFile(resolve(directory, 'plan.json'), 'utf8')));
const consumer = resolve(directory, 'consumer');
await mkdir(consumer, { recursive: true });
await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ name: 'easy-sdk-docs-consumer', private: true,
  type: 'module', version: '1.0.0', dependencies: { easyjssdk: plan.version } }));
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], { cwd: consumer, stdio: 'pipe', timeout: 120_000 });
const lock = JSON.parse(await readFile(resolve(consumer, 'package-lock.json'), 'utf8'));
const sdk = lock.packages['node_modules/easyjssdk'];
assert(sdk.version === plan.version && sdk.integrity === plan.integrity && sdk.resolved === plan.tarball, 'Consumer lock does not match the selected npm artifact');
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], { cwd: consumer, stdio: 'pipe', timeout: 120_000 });

const tutorial = async (suffix) => readFile(resolve(root, `docs-site/content/docs/sdk/easy/javascript/getting-started${suffix}.mdx`), 'utf8');
const [zh, en] = await Promise.all([tutorial(''), tutorial('.en')]);
const code = (text) => [...text.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((match) => match[1]);
assert(code(zh).length === 3 && JSON.stringify(code(zh)) === JSON.stringify(code(en)), 'Bilingual tutorial code differs; review the examples before upgrading');
const source = `${code(zh).join('\n')}\nObject.assign(window, { __easySDKTest: { chat, EasyChatClient } });\n`;
await writeFile(resolve(consumer, 'tutorial.ts'), source);
await writeFile(resolve(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], strict: true,
  skipLibCheck: false, noEmit: true, types: [],
}, files: ['tutorial.ts'] }));
execFileSync(process.execPath, [resolve(tools, 'node_modules/typescript/bin/tsc'), '--project', resolve(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'inherit', timeout: 60_000 });
await build({ absWorkingDir: consumer, entryPoints: ['tutorial.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: resolve(consumer, 'tutorial.js'), logLevel: 'error' });
console.log(`Compiled both Web tutorial locales against easyjssdk ${plan.version}.`);
