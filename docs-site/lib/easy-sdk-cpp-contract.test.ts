import { easySdkReleases, resolveEasySdkText } from './easy-sdk-version';
import { describe, expect, test } from 'bun:test';
import { getNavigationEntry, getIndexedNavigationEntries } from './navigation';

const root = new URL('../content/docs/sdk/easy/', import.meta.url);
const release = easySdkReleases.cpp;
const revision = release.sourceRevision ?? `v${release.version}`;
const repository = 'https://github.com/WuKongIM/WuKongEasySDK-CPP';

describe('C++ EasySDK vcpkg and source tutorial', () => {
  test('publishes both locales with independent SDK source and vcpkg registry pins', async () => {
    for (const [locale, suffix] of [['zh', ''], ['en', '.en']] as const) {
      const page = resolveEasySdkText(await Bun.file(new URL(`cpp/getting-started${suffix}.mdx`, root)).text());
      const overview = resolveEasySdkText(await Bun.file(new URL(`index${suffix}.mdx`, root)).text());
      const examples = resolveEasySdkText(await Bun.file(new URL(`examples${suffix}.mdx`, root)).text());
      expect(getNavigationEntry(locale, 'sdk', ['easy', 'cpp', 'getting-started'])?.status).toBe('published');
      expect(getIndexedNavigationEntries(locale).map((entry) => entry.url)).toContain(`/${locale}/sdk/easy/cpp/getting-started`);
      for (const content of [page, overview, examples]) {
        if (content === page || content === overview) expect(content).toContain(repository);
        expect(content).not.toContain('CPP_SOURCE_REV');
        if (content !== examples) expect(content).toContain(release.version);
      }
      for (const content of [overview, examples]) {
        expect(content).toContain(`/${locale}/sdk/easy/cpp/getting-started`);
      }
      expect(page).toContain(revision);
      expect(page).toContain(`${repository}/releases/tag/v${release.version}`);
      for (const platform of ['linux-x64-gcc13.zip', 'macos-arm64-appleclang.zip', 'windows-x64-msvc143-md.zip']) {
        expect(page).toContain(platform);
      }
      for (const contract of ['wukong-sdk.cmake', 'SHA256SUMS', 'BUILD_INFO.json', '/MDd', 'WKIM_CA_FILE']) {
        expect(page).toContain(contract);
      }
      expect(page).not.toMatch(/没有预编译 SDK 压缩包|no prebuilt SDK archive/);
      expect(page).toMatch(/(?:不属于|不是)微软默认目录|not Microsoft[’']s curated catalog/);
      const manifests = [...page.matchAll(/```json\n([\s\S]*?)\n```/g)]
        .map((match) => JSON.parse(match[1]));
      expect(manifests[0]).toEqual({ dependencies: ['wukong-easy-sdk'] });
      expect(manifests[1]).toEqual({
        'default-registry': {
          kind: 'git', repository: 'https://github.com/microsoft/vcpkg',
          baseline: release.vcpkgBaseline,
        },
        registries: [{
          kind: 'git', repository: `${repository}.git`,
          baseline: release.registryBaseline,
          packages: ['wukong-easy-sdk'],
        }],
      });
      expect(page).toContain(`find_package(WuKongEasySDK ${release.cmakeVersion} CONFIG REQUIRED)`);
      expect(page).toContain(`git checkout ${revision}`);
      expect(page).toContain('WuKongEasySDK::WuKongEasySDK');
      expect(page).toContain('CMAKE_TOOLCHAIN_FILE');
      expect(page).toContain('ctest --test-dir build');
      expect(page).toContain('im.connect().get()');
      expect(page).toContain('im.send(');
      expect(page).toContain('im.off(messageListener)');
      expect(page).toContain('im.disconnect().get()');
      expect(page).toContain('im.destroy().get()');
      expect(page).toContain('ErrorCode::QueueFull');
      expect(page).toContain('result: null');
      expect(page).toContain('Options::caFile');
      expect(page).toContain('clientMsgNo');
      expect(page).toMatch(/不能在回调中等待 SDK future|must never wait on an SDK future/);
      expect(page).toMatch(/APP `0`.*WEB `1`.*PC\/Desktop `2`/);
      expect(page).toContain(`/${locale}/guide/integration/authentication`);
      expect(page).toContain(`/${locale}/guide/integration/messaging`);
    }
  });
});
