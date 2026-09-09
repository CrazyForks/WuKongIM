import { describe, expect, test } from 'bun:test';
import {
  discover, manifestPath, proposalPaths, publish, sha256, updateManifest,
  upgradeDecision, validateReceipt,
} from '../scripts/easy-sdk-sync/core.mjs';

const docsSource = 'a'.repeat(40), sdkSource = 'b'.repeat(40);
const manifest = '{"javascript":{"version":"2.0.5"},"ios":{"version":"1.1.1"}}\n';
function plan(decision = 'upgrade') {
  return { schema: 'wukongim.easy-sdk-docs-plan/v1', decision, previousVersion: '2.0.5',
    version: decision === 'upgrade' ? '2.0.6' : '2.0.5', docsSource, sdkSource,
    manifestSha256: sha256(manifest), integrity: `sha512-${'A'.repeat(86)}==`,
    tarball: `https://registry.npmjs.org/easyjssdk/-/easyjssdk-${decision === 'upgrade' ? '2.0.6' : '2.0.5'}.tgz`, publishRunId: 123 };
}
const files = Object.fromEntries(proposalPaths.map((path) => [path, `expected ${path}`]));
function receipt(selection = plan()) {
  return { schema: 'wukongim.easy-sdk-docs-receipt/v1', status: 'passed',
    planSha256: sha256(JSON.stringify(selection)), runId: '456', serverSource: docsSource,
    version: selection.version, integrity: selection.integrity, node: 'v24.3.0', chromium: '140.0.0.0',
    tutorialSha256: 'c'.repeat(64), consumerLockSha256: 'd'.repeat(64), toolLockSha256: 'e'.repeat(64),
    checks: { compiled: true, bidirectional: true, cleanup: true, reconnect: true, connectTimeout: true },
    docsVerified: true, documents: Object.fromEntries(proposalPaths.map((path) => [path, sha256(files[path])])) };
}
function discovery(overrides = {}) {
  const selection = plan();
  return { manifest, docsSource,
    registry: async () => ({ name: 'easyjssdk', version: selection.version, gitHead: sdkSource,
      dist: { integrity: selection.integrity, tarball: selection.tarball } }),
    api: async (path) => {
      if (path.includes('/pulls?')) return [];
      if (path.includes('/git/ref/')) return { object: { type: 'commit', sha: sdkSource } };
      if (path.includes('/compare/')) return { status: 'ahead' };
      return { workflow_runs: [{ id: 123, conclusion: 'success', event: 'push', head_sha: sdkSource,
        head_branch: 'v2.0.6', head_repository: { full_name: 'WuKongIM/WuKongEasySDK-JS' }, path: '.github/workflows/publish-npm.yml' }] };
    }, ...overrides };
}

describe('Web SDK release-to-documentation proposal', () => {
  test('bounds compatibility, rejects prereleases, and never downgrades', () => {
    expect(upgradeDecision('2.0.5', '2.0.4')).toBe('unchanged');
    expect(upgradeDecision('2.0.5', '2.0.5')).toBe('unchanged');
    expect(upgradeDecision('2.0.5', '2.0.5', true)).toBe('verify');
    expect(upgradeDecision('2.0.5', '2.1.0')).toBe('upgrade');
    for (const candidate of ['3.0.0', '2.0.6-rc.1', 'latest', '2.01.0']) {
      expect(() => upgradeDecision('2.0.5', candidate)).toThrow();
    }
    expect(() => upgradeDecision('0.1.0', '0.2.0')).toThrow('compatibility');
  });

  test('requires matching npm, tag, main ancestry and successful publisher identities', async () => {
    expect(await discover(discovery())).toEqual(plan());
    const normal = discovery();
    for (const [target, replacement] of [
      ['/git/ref/', { object: { type: 'commit', sha: docsSource } }],
      ['/compare/', { status: 'diverged' }],
      ['/actions/', { workflow_runs: [] }],
      ['/actions/', { workflow_runs: [{ id: 123, conclusion: 'success', event: 'pull_request', head_sha: sdkSource }] }],
    ]) {
      await expect(discover(discovery({ api: (path) => path.includes(target) ? replacement : normal.api(path) }))).rejects.toThrow();
    }
  });

  test('skips an existing open or closed version proposal before expensive verification', async () => {
    const api = async (path) => {
      expect(path).toContain('/pulls?state=all');
      return [{ state: 'closed' }];
    };
    expect(await discover(discovery({ api }))).toEqual({ decision: 'unchanged', reason: 'proposal_exists' });
  });

  test('edits only the Web selection and refuses stale manifests', () => {
    const changed = updateManifest(manifest, plan());
    expect(JSON.parse(changed)).toEqual({ javascript: { version: '2.0.6' }, ios: { version: '1.1.1' } });
    expect(() => updateManifest(manifest + '\n', plan())).toThrow('changed');
    expect(updateManifest(manifest, plan('verify'))).toBe(manifest);
  });

  test('rejects failed, wrong-run, wrong-package or incomplete receipts', () => {
    for (const patch of [{ status: 'failed' }, { runId: '457' }, { integrity: 'wrong' },
      { checks: { ...receipt().checks, cleanup: false } }, { planSha256: 'f'.repeat(64) }]) {
      expect(() => validateReceipt({ ...receipt(), ...patch }, plan(), '456')).toThrow();
    }
  });

  test('requires the full docs gate and matching document hashes before any write', async () => {
    for (const modified of [{ ...receipt(), docsVerified: false }, { ...receipt(), documents: {} }]) {
      await expect(publish({ plan: plan(), receipt: modified, runId: '456', files,
        api: () => { throw new Error('API must not be called'); } })).rejects.toThrow();
    }
    await expect(publish({ plan: plan('verify'), receipt: receipt(plan('verify')), runId: '456', files,
      api: () => { throw new Error('API must not be called'); } })).rejects.toThrow('verification-only');
  });

  test('leaves a changed main or an existing proposal untouched', async () => {
    expect(await publish({ plan: plan(), receipt: receipt(), runId: '456', files,
      api: async (_path, method = 'GET') => { expect(method).toBe('GET'); return { object: { sha: sdkSource } }; },
    })).toEqual({ status: 'base_changed' });
  });

  test('creates only the three expected files on a dedicated branch, without force or merge', async () => {
    const calls = [];
    const api = async (path, method = 'GET', body) => {
      calls.push({ path, method, body });
      if (path.endsWith('/git/ref/heads/main')) return { object: { sha: docsSource } };
      if (path.includes('/pulls?')) return [];
      if (path.endsWith(`/git/commits/${docsSource}`)) return { tree: { sha: 'base-tree' } };
      if (path.endsWith('/git/trees')) return { sha: 'candidate-tree' };
      if (path.endsWith('/git/commits')) return { sha: 'candidate-commit' };
      if (path.includes('/git/ref/heads/codex/')) return null;
      if (path.endsWith('/pulls')) return { html_url: 'https://github.com/WuKongIM/WuKongIM/pull/1234' };
      return {};
    };
    expect((await publish({ plan: plan(), receipt: receipt(), runId: '456', files, api })).status).toBe('created');
    expect(calls.find((c) => c.path.endsWith('/git/trees')).body.tree.map((item) => item.path)).toEqual(proposalPaths);
    expect(calls.find((c) => c.path.endsWith('/git/refs')).body).toEqual({ ref: 'refs/heads/codex/easy-sdk-web-2.0.6', sha: 'candidate-commit' });
    expect(calls.find((c) => c.path.endsWith('/pulls')).body.body).toContain('actions/runs/456');
    expect(calls.every((c) => ['GET', 'POST'].includes(c.method) && !c.path.endsWith('/merge'))).toBe(true);
    expect(Object.keys(files)).toContain(manifestPath);
  });
});
