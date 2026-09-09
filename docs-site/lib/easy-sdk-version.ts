import releases from './easy-sdk-releases.json';

export const easySdkPlatforms = [
  'ios', 'android', 'flutter', 'javascript', 'rust', 'csharp', 'cpp', 'python',
] as const;
export type EasySdkPlatform = (typeof easySdkPlatforms)[number];

type SdkRelease = Readonly<{
  version: string;
  /** Optional immutable source pin; otherwise examples use the release tag. */
  sourceRevision?: string;
}>;

export type EasySdkReleases = Readonly<Record<EasySdkPlatform, SdkRelease> & {
  cpp: SdkRelease & Readonly<{
    /** Registry, tool, and SDK source revisions have independent ownership. */
    registryBaseline: string;
    vcpkgBaseline: string;
    cmakeVersion: string;
  }>;
}>;

/** The reviewed tutorial selections, not a claim about the latest registry versions. */
export const easySdkReleases: EasySdkReleases = releases;

/** Build deterministic substitutions without fetching mutable release metadata. */
export function createEasySdkTokens(selected: EasySdkReleases): Readonly<Record<string, string>> {
  const tokens: Record<string, string> = {};
  const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  const revisionPattern = /^[a-f0-9]{40}$/;
  if (Object.keys(selected).sort().join() !== [...easySdkPlatforms].sort().join()) {
    throw new Error('EasySDK releases must select exactly the eight supported platforms');
  }
  for (const platform of easySdkPlatforms) {
    const release = selected[platform];
    if (!versionPattern.test(release.version)) {
      throw new Error(`EasySDK ${platform}: expected an exact stable version`);
    }
    if (release.sourceRevision !== undefined && !revisionPattern.test(release.sourceRevision)) {
      throw new Error(`EasySDK ${platform}: sourceRevision must be a full commit SHA`);
    }
    const prefix = `WK_EASYSDK_${platform.toUpperCase()}_`;
    tokens[`${prefix}VERSION`] = release.version;
    tokens[`${prefix}TAG`] = `v${release.version}`;
    tokens[`${prefix}SOURCE_REF`] = release.sourceRevision ?? `v${release.version}`;
  }
  for (const [field, token] of [
    ['registryBaseline', 'REGISTRY_BASELINE'], ['vcpkgBaseline', 'VCPKG_BASELINE'],
  ] as const) {
    if (!revisionPattern.test(selected.cpp[field])) {
      throw new Error(`EasySDK cpp: ${field} must be a full commit SHA`);
    }
    tokens[`WK_EASYSDK_CPP_${token}`] = selected.cpp[field];
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/.test(selected.cpp.cmakeVersion)) {
    throw new Error('EasySDK cpp: cmakeVersion must be an exact numeric CMake requirement');
  }
  tokens.WK_EASYSDK_CPP_CMAKE_VERSION = selected.cpp.cmakeVersion;
  return Object.freeze(tokens);
}

const currentTokens = createEasySdkTokens(easySdkReleases);

/** Resolve only declared tokens; a typo must fail the build instead of reaching readers. */
export function resolveEasySdkText(
  text: string,
  tokens: Readonly<Record<string, string>> = currentTokens,
): string {
  return text.replace(/WK_EASYSDK_[A-Z0-9_]+/g, (token) => {
    if (!Object.hasOwn(tokens, token)) throw new Error(`Unknown EasySDK token: ${token}`);
    return tokens[token];
  });
}

type MarkdownNode = {
  value?: unknown;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
  attributes?: MarkdownNode[];
};

/** Resolve prose, code, links, and literal MDX attributes before rendering and indexing. */
export function remarkEasySdkVersions() {
  function replace(node: MarkdownNode): void {
    for (const key of ['value', 'url', 'title'] as const) {
      const value = node[key];
      if (typeof value === 'string') node[key] = resolveEasySdkText(value);
    }
    for (const child of node.children ?? []) replace(child);
    for (const attribute of node.attributes ?? []) replace(attribute);
  }
  return replace;
}
