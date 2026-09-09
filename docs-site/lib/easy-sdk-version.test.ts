import { describe, expect, test } from 'bun:test';
import {
  createEasySdkTokens, easySdkPlatforms, easySdkReleases,
  remarkEasySdkVersions, resolveEasySdkText,
} from './easy-sdk-version';

const root = new URL('../content/docs/sdk/easy/', import.meta.url);
const read = (name: string) => Bun.file(new URL(name, root)).text();

describe('EasySDK version selections', () => {
  test('rejects floating versions, prereleases, malformed pins and unknown tokens', () => {
    for (const version of ['latest', '^1.2.3', '1.02.3', 'v1.2.3', '1.2.3-rc.1']) {
      expect(() => createEasySdkTokens({ ...easySdkReleases, ios: { version } })).toThrow('exact stable version');
    }
    expect(() => createEasySdkTokens({
      ...easySdkReleases, csharp: { version: '1.2.3', sourceRevision: 'main' },
    })).toThrow('full commit SHA');
    expect(() => createEasySdkTokens({
      ...easySdkReleases, cpp: { ...easySdkReleases.cpp, registryBaseline: 'latest' },
    })).toThrow('full commit SHA');
    expect(() => createEasySdkTokens({
      ...easySdkReleases, cpp: { ...easySdkReleases.cpp, cmakeVersion: '0.1 REQUIRED' },
    })).toThrow('CMake requirement');
    expect(() => resolveEasySdkText('WK_EASYSDK_IOS_VERISON')).toThrow('Unknown EasySDK token');
  });

  test('transforms prose, code, links and MDX card attributes', () => {
    const tree = {
      children: [
        { value: 'Install WK_EASYSDK_PYTHON_VERSION' },
        { value: 'pip install wukong-easy-sdk==WK_EASYSDK_PYTHON_VERSION' },
        { url: 'https://pypi.org/project/wukong-easy-sdk/WK_EASYSDK_PYTHON_VERSION/', title: 'SDK WK_EASYSDK_PYTHON_TAG' },
        { attributes: [{ value: 'WK_EASYSDK_PYTHON_VERSION · Python' }] },
      ],
    };
    remarkEasySdkVersions()(tree);
    const version = easySdkReleases.python.version;
    expect(tree.children[0].value).toBe(`Install ${version}`);
    expect(tree.children[1].value).toBe(`pip install wukong-easy-sdk==${version}`);
    expect(tree.children[2].url).toBe(`https://pypi.org/project/wukong-easy-sdk/${version}/`);
    expect(tree.children[2].title).toBe(`SDK v${version}`);
    expect(tree.children[3].attributes?.[0].value).toBe(`${version} · Python`);
  });

  test('a version-only upgrade updates both locales without rewriting historical evidence', async () => {
    for (const platform of easySdkPlatforms) {
      const tokens = createEasySdkTokens({
        ...easySdkReleases,
        [platform]: { ...easySdkReleases[platform], version: '9.8.7' },
      });
      const prefix = `WK_EASYSDK_${platform.toUpperCase()}_`;
      for (const suffix of ['', '.en']) {
        const page = await read(`${platform}/getting-started${suffix}.mdx`);
        const overview = await read(`index${suffix}.mdx`);
        const examples = await read(`examples${suffix}.mdx`);
        expect(page).toContain(`${prefix}VERSION`);
        expect(overview).toContain(`description="${prefix}VERSION`);
        expect(resolveEasySdkText(page, tokens)).toContain('**9.8.7**');
        expect(resolveEasySdkText(overview, tokens)).toContain('`9.8.7`');
        for (const text of [page, overview, examples]) {
          expect(resolveEasySdkText(text, tokens)).not.toContain('WK_EASYSDK_');
          expect(text.split('---')[1]).not.toContain('WK_EASYSDK_');
        }
        const code = [...page.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]).join('\n');
        if (platform !== 'cpp') {
          expect(code).toContain(`${prefix}VERSION`);
          expect(resolveEasySdkText(code, tokens)).toContain('9.8.7');
        }
        if (platform === 'javascript') {
          expect(resolveEasySdkText(examples, tokens)).toContain('git checkout v9.8.7');
          expect(resolveEasySdkText(overview, tokens)).toContain('/releases/tag/v2.0.5');
        }
        if (platform === 'python' || platform === 'rust') {
          expect(resolveEasySdkText(examples, tokens)).toContain('git clone --branch v9.8.7');
        }
        if (platform === 'ios') expect(resolveEasySdkText(page, tokens)).toContain('`v1.1.1`');
      }
    }
  });

  test('C++ source, registry and tool pins are independent of the package version', () => {
    const tokens = createEasySdkTokens({
      ...easySdkReleases,
      cpp: { ...easySdkReleases.cpp, version: '0.2.0', registryBaseline: 'a'.repeat(40) },
    });
    expect(tokens.WK_EASYSDK_CPP_TAG).toBe('v0.2.0');
    expect(tokens.WK_EASYSDK_CPP_SOURCE_REF).toBe(easySdkReleases.cpp.sourceRevision!);
    expect(tokens.WK_EASYSDK_CPP_REGISTRY_BASELINE).toBe('a'.repeat(40));
    expect(tokens.WK_EASYSDK_CPP_VCPKG_BASELINE).toBe(easySdkReleases.cpp.vcpkgBaseline);
  });

  test('Chinese and English reference the same current metadata', async () => {
    for (const name of ['index', 'examples', ...easySdkPlatforms.map((p) => `${p}/getting-started`)]) {
      const tokens = (s: string) => [...new Set(s.match(/WK_EASYSDK_[A-Z0-9_]+/g))].sort();
      expect(tokens(await read(`${name}.mdx`))).toEqual(tokens(await read(`${name}.en.mdx`)));
    }
  });
});
