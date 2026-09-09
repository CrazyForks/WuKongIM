import { createHash } from 'node:crypto';

export const repository = 'WuKongIM/WuKongIM';
export const sdkRepository = 'WuKongIM/WuKongEasySDK-JS';
export const manifestPath = 'docs-site/lib/easy-sdk-releases.json';
export const proposalPaths = [manifestPath, 'docs-site/NAVIGATION.md', 'CHANGELOG.md'];
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function versionParts(version) {
  assert(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Expected an exact stable SDK version');
  const parts = version.split('.').map(Number);
  assert(parts.every(Number.isSafeInteger), 'SDK version exceeds numeric bounds');
  return parts;
}

/** Never downgrade or automatically cross a major-version compatibility boundary. */
export function upgradeDecision(current, candidate, verifyCurrent = false) {
  const a = versionParts(current), b = versionParts(candidate);
  const comparison = b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  if (comparison <= 0) return comparison === 0 && verifyCurrent ? 'verify' : 'unchanged';
  assert(a[0] === b[0] && (a[0] !== 0 || a[1] === b[1]), 'SDK compatibility boundary changed; review the tutorial manually');
  return 'upgrade';
}

export function validatePlan(plan) {
  assert(plan.schema === 'wukongim.easy-sdk-docs-plan/v1', 'Invalid SDK plan schema');
  versionParts(plan.version); versionParts(plan.previousVersion);
  assert(['upgrade', 'verify'].includes(plan.decision), 'Invalid SDK plan decision');
  assert(upgradeDecision(plan.previousVersion, plan.version, true) === plan.decision, 'Inconsistent SDK plan decision');
  for (const key of ['docsSource', 'sdkSource']) assert(/^[a-f0-9]{40}$/.test(plan[key]), `Invalid ${key}`);
  assert(/^[a-f0-9]{64}$/.test(plan.manifestSha256), 'Invalid manifest digest');
  assert(plan.tarball === `https://registry.npmjs.org/easyjssdk/-/easyjssdk-${plan.version}.tgz`, 'Unexpected npm tarball');
  assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(plan.integrity), 'Missing npm SHA-512 integrity');
  assert(Number.isSafeInteger(plan.publishRunId) && plan.publishRunId > 0, 'Invalid npm publication run');
  return plan;
}

/** Bind the npm artifact to a successful tag publication and source reachable from main. */
export async function discover({ manifest, docsSource, api, registry, verifyCurrent = false }) {
  const selection = JSON.parse(manifest).javascript;
  assert(!selection.sourceRevision, 'Web source override requires manual review before automatic upgrades');
  const metadata = await registry(verifyCurrent ? selection.version : 'latest');
  assert(metadata.name === 'easyjssdk', 'Unexpected npm package');
  const decision = upgradeDecision(selection.version, metadata.version, verifyCurrent);
  if (decision === 'unchanged') return { decision };
  const version = metadata.version;
  if (decision === 'upgrade') {
    const existing = await api(`repos/${repository}/pulls?state=all&head=WuKongIM:codex/easy-sdk-web-${version}&base=main&per_page=100`);
    if (existing.length) return { decision: 'unchanged', reason: 'proposal_exists' };
  }
  const prefix = `repos/${sdkRepository}`;
  let ref = await api(`${prefix}/git/ref/tags/v${version}`);
  for (let depth = 0; ref.object?.type === 'tag' && depth < 3; depth++) {
    assert(/^[a-f0-9]{40}$/.test(ref.object.sha), 'Invalid annotated tag SHA');
    ref = await api(`${prefix}/git/tags/${ref.object.sha}`);
  }
  assert(ref.object?.type === 'commit' && ref.object.sha === metadata.gitHead, 'npm source does not match the release tag');
  const source = metadata.gitHead;
  assert(/^[a-f0-9]{40}$/.test(source), 'Invalid SDK source SHA');
  const comparison = await api(`${prefix}/compare/${source}...main`);
  assert(['ahead', 'identical'].includes(comparison.status), 'SDK tag is not reachable from main');
  const runs = await api(`${prefix}/actions/workflows/publish-npm.yml/runs?event=push&status=success&head_sha=${source}&per_page=100`);
  const run = runs.workflow_runs?.find((item) => item.conclusion === 'success'
    && item.event === 'push' && item.head_sha === source && item.head_branch === `v${version}`
    && item.head_repository?.full_name === sdkRepository && item.path === '.github/workflows/publish-npm.yml');
  assert(run, 'No successful npm tag publication for this SDK artifact');
  return validatePlan({
    schema: 'wukongim.easy-sdk-docs-plan/v1', decision, previousVersion: selection.version,
    version, docsSource, sdkSource: source, manifestSha256: sha256(manifest),
    integrity: metadata.dist?.integrity, tarball: metadata.dist?.tarball, publishRunId: run.id,
  });
}

/** Make only the reviewed manifest edit; generated navigation and Changelog follow separately. */
export function updateManifest(text, plan) {
  validatePlan(plan);
  assert(sha256(text) === plan.manifestSha256, 'Manifest changed since discovery');
  const data = JSON.parse(text);
  assert(data.javascript.version === plan.previousVersion, 'Current SDK version changed');
  // Preserve formatting and every other platform, including independent source pins.
  const pattern = /("javascript"\s*:\s*\{\s*"version"\s*:\s*")[^"]+("\s*\})/;
  assert(pattern.test(text), 'Unexpected Web manifest shape');
  return text.replace(pattern, `$1${plan.version}$2`);
}

export function updateChangelog(text, plan) {
  assert(text.includes('## [Unreleased]\n'), 'Missing Unreleased Changelog section');
  const entry = `- Update the Web EasySDK tutorial to npm ${plan.version} after package compilation, Chromium bidirectional messaging and cleanup checks. / Web EasySDK 教程升级到 npm ${plan.version}，通过发布包编译、Chromium 双向收发与连接清理验证。`;
  return text.replace('## [Unreleased]\n', `## [Unreleased]\n\n${entry}\n`);
}

export function validateReceipt(receipt, plan, runId) {
  validatePlan(plan);
  assert(receipt.schema === 'wukongim.easy-sdk-docs-receipt/v1' && receipt.status === 'passed', 'SDK acceptance did not pass');
  assert(receipt.planSha256 === sha256(JSON.stringify(plan)), 'Receipt belongs to another plan');
  assert(receipt.runId === runId && receipt.serverSource === plan.docsSource, 'Receipt belongs to another run or server');
  assert(receipt.version === plan.version && receipt.integrity === plan.integrity, 'Receipt package identity mismatch');
  for (const check of ['compiled', 'bidirectional', 'cleanup', 'reconnect', 'connectTimeout']) {
    assert(receipt.checks?.[check] === true, `SDK acceptance missing ${check}`);
  }
  for (const key of ['tutorialSha256', 'consumerLockSha256', 'toolLockSha256']) assert(/^[a-f0-9]{64}$/.test(receipt[key]), `Missing ${key}`);
  assert(typeof receipt.chromium === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(receipt.chromium), 'Missing Chromium identity');
  assert(typeof receipt.node === 'string' && /^v\d+\.\d+\.\d+$/.test(receipt.node), 'Missing Node identity');
}

/** Publish a fixed three-file proposal without executing artifact-supplied code or force-pushing. */
export async function publish({ plan, receipt, runId, files, api }) {
  validateReceipt(receipt, plan, runId);
  assert(plan.decision === 'upgrade', 'A verification-only run cannot create a PR');
  assert(Object.keys(files).sort().join() === [...proposalPaths].sort().join(), 'Unexpected proposal paths');
  assert(receipt.docsVerified === true, 'Documentation verification did not pass');
  for (const path of proposalPaths) assert(receipt.documents?.[path] === sha256(files[path]), 'Verified documentation differs from the proposed files');
  const prefix = `repos/${repository}`;
  const main = await api(`${prefix}/git/ref/heads/main`);
  if (main.object.sha !== plan.docsSource) return { status: 'base_changed' };
  const branch = `codex/easy-sdk-web-${plan.version}`;
  const existing = await api(`${prefix}/pulls?state=all&head=WuKongIM:${branch}&base=main&per_page=100`);
  if (existing.length) return { status: 'existing', url: existing[0].html_url };
  const base = await api(`${prefix}/git/commits/${plan.docsSource}`);
  const tree = await api(`${prefix}/git/trees`, 'POST', {
    base_tree: base.tree.sha,
    tree: proposalPaths.map((path) => ({ path, mode: '100644', type: 'blob', content: files[path] })),
  });
  const commit = await api(`${prefix}/git/commits`, 'POST', {
    message: `docs: update Web EasySDK to ${plan.version}`, tree: tree.sha, parents: [plan.docsSource],
  });
  // A prior interrupted run may own the branch. Recover only the identical proposal tree and base.
  const ref = await api(`${prefix}/git/ref/heads/${branch}`, 'GET', undefined, true);
  if (ref) {
    const prior = await api(`${prefix}/git/commits/${ref.object.sha}`);
    assert(prior.tree.sha === tree.sha && prior.parents.length === 1 && prior.parents[0].sha === plan.docsSource,
      'Existing SDK branch differs; preserve it for human review');
  } else {
    await api(`${prefix}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  const body = [
    `Update Web EasySDK from ${plan.previousVersion} to ${plan.version}.`,
    `The released npm artifact passed the tutorial TypeScript build and Chromium connection, bidirectional messaging, disconnect cleanup, reconnect, and bounded connection-timeout checks against a real 256-hash-slot single-node cluster. The full documentation verification gate passed before this PR was created.`,
    `SDK source: ${plan.sdkSource}\nServer/docs source: ${plan.docsSource}\nNpm integrity: ${plan.integrity}`,
    `Tutorial SHA-256: ${receipt.tutorialSha256}\nConsumer lock SHA-256: ${receipt.consumerLockSha256}\nTool lock SHA-256: ${receipt.toolLockSha256}\nNode: ${receipt.node}\nChromium: ${receipt.chromium}`,
    `[Acceptance and artifacts](https://github.com/${repository}/actions/runs/${runId}) · [npm publication](https://github.com/${sdkRepository}/actions/runs/${plan.publishRunId})`,
    'Scope: online messaging on Chromium and a single-node cluster. This does not certify multi-node recovery, other browsers, or historical soak matrices. Review and merge this PR to publish documentation. GitHub may require approval before running PR-triggered workflows for a GITHUB_TOKEN-created PR.',
  ].join('\n\n');
  const pr = await api(`${prefix}/pulls`, 'POST', { title: `docs: update Web EasySDK to ${plan.version}`, head: branch, base: 'main', body });
  return { status: 'created', url: pr.html_url };
}
