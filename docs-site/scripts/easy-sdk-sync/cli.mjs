import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assert, discover, manifestPath, proposalPaths, publish, repository, sdkRepository,
  sha256, updateChangelog, updateManifest, validatePlan, validateReceipt,
} from './core.mjs';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const [command, directory] = process.argv.slice(2);
assert(['discover', 'apply', 'seal', 'publish'].includes(command) && directory, 'Usage: cli.mjs discover|apply|seal|publish <artifact-directory>');
const artifact = resolve(directory);
await mkdir(artifact, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

async function request(url, options = {}, allowMissing = false) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (allowMissing && response.status === 404) return null;
  assert(response.ok, `Remote metadata request failed with HTTP ${response.status}`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= 2 * 1024 * 1024, 'Remote metadata exceeds its size limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

const api = (path, method = 'GET', body, allowMissing = false) => {
  assert(path.startsWith(`repos/${repository}/`) || path.startsWith(`repos/${sdkRepository}/`), 'Unexpected GitHub repository');
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  if (body) headers['Content-Type'] = 'application/json';
  return request(`https://api.github.com/${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }, allowMissing);
};
const read = (path) => readFile(resolve(root, path), 'utf8');
async function readArtifact(name) {
  const bytes = await readFile(resolve(artifact, name));
  assert(bytes.length < 64 * 1024, 'Acceptance artifact exceeds its size limit');
  return JSON.parse(bytes.toString());
}
async function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

if (command === 'discover') {
  const plan = await discover({ manifest: await read(manifestPath), docsSource: source, api,
    registry: (version) => request(`https://registry.npmjs.org/easyjssdk/${version}`),
    verifyCurrent: process.env.VERIFY_CURRENT === 'true',
  });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `decision=${plan.decision}\n`);
  if (plan.decision !== 'unchanged') await writeFile(resolve(artifact, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  await summary(`Web EasySDK discovery: ${plan.decision}${plan.version ? ` (${plan.version})` : ''}.`);
} else {
  const plan = validatePlan(await readArtifact('plan.json'));
  assert(plan.docsSource === source, 'Checkout does not match the discovered documentation source');
  if (command === 'apply') {
    await writeFile(resolve(root, manifestPath), updateManifest(await read(manifestPath), plan));
    if (plan.decision === 'upgrade') {
      await writeFile(resolve(root, 'CHANGELOG.md'), updateChangelog(await read('CHANGELOG.md'), plan));
    }
    execFileSync('bun', ['run', 'scripts/generate-navigation.ts', '--write'], { cwd: resolve(root, 'docs-site'), stdio: 'inherit' });
  } else {
    const receipt = await readArtifact('receipt.json');
    const runId = process.env.GITHUB_RUN_ID ?? 'local';
    validateReceipt(receipt, plan, runId);
    const files = Object.fromEntries(await Promise.all(proposalPaths.map(async (path) => [path, await read(path)])));
    if (command === 'seal') {
      // This command follows the successful full documentation gate in the credential-free job.
      const changed = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      assert(changed.every((path) => proposalPaths.includes(path)), 'Verification modified an unexpected tracked file');
      receipt.docsVerified = true;
      receipt.documents = Object.fromEntries(proposalPaths.map((path) => [path, sha256(files[path])]));
      await writeFile(resolve(artifact, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
      await summary(`Web EasySDK ${plan.version}: released-package browser acceptance and full documentation verification passed.`);
    } else {
      assert(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_REF === 'refs/heads/main', 'Publication requires this repository main branch');
      assert(['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME), 'This event cannot publish a proposal');
      assert(/^\d+$/.test(runId), 'Publication requires a GitHub Actions run');
      const result = await publish({ plan, receipt, runId, files, api });
      await summary(`Web EasySDK proposal: ${result.status}${result.url ? ` — ${result.url}` : ''}.`);
    }
  }
}
