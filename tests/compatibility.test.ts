/**
 * Package-metadata regression guard for the 0.9.2 DSH 0.2.2-rc.5 compatibility fix.
 *
 * 0.9.2 realigned the declared DSH support that had silently drifted: the
 * `dsh.compatibility.dshReleases` map, the pinned devDependencies (the SDK
 * packages the host half imports and the client host packages the Web half
 * injects), and the peerDependencies ranges. None of those values is visible at
 * runtime, so a drift is not caught by the behavioural tests; this file pins
 * the whole declared contract against the root `package.json`.
 *
 * The two intentional deviations are asserted too, with the reason next to
 * them, so they cannot be mistaken for the drift this guard exists to prevent.
 *
 * When the devDependency pins or the compat map are updated for a new host
 * cohort, update this file in the same change: it is written to fail first.
 * The guard never reads the installed host or the network; the host version on
 * a given machine is not part of the package contract and is not asserted.
 * @module tests/compatibility
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** The package this guard protects; also identifies the repository root. */
const PACKAGE_NAME = 'dsh-plugin-dayflow';

/** The DSH release cohort 0.9.2 was verified against and pins in devDependencies. */
const DSH_RELEASE = '0.2.2-rc.5';

/** The oldest DSH release still declared compatible, and the peer floor for every host package. */
const DSH_PEER_RANGE = '^0.2.0-rc.2';

/** SDK packages the host half imports; pinned so local types match the tested release. */
const DSH_SDK_DEV_DEPENDENCIES = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-util-values',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const;

/** Client host packages the Web half injects; pinned as devDependencies for the same reason. */
const CLIENT_HOST_PEER_DEV_DEPENDENCIES = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
] as const;

/** Every DSH package the plugin declares as a peer dependency. */
const DSH_PEER_DEPENDENCIES = [...DSH_SDK_DEV_DEPENDENCIES, ...CLIENT_HOST_PEER_DEV_DEPENDENCIES] as const;

/** The compat map entries 0.9.2 deliberately keeps; older cohort members stay advertised. */
const COMPATIBLE_DSH_RELEASES = ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.2-rc.5'] as const;

/** The subset of `package.json` this guard reads. */
interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dsh?: {
    client?: { inject?: string[] };
    compatibility?: { dshReleases?: Record<string, string> };
  };
}

/**
 * Read the repository's `package.json`, starting from this file's directory.
 *
 * Under `npm test` this file runs from `.test-build/tests/`, two levels below
 * the root; the upward walk keeps the guard runnable when the test build is
 * emitted elsewhere, and falls back to the working directory `npm test` sets.
 */
function readManifest(): PackageManifest {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as PackageManifest;
      if (parsed.name === PACKAGE_NAME) return parsed;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const fallback = join(process.cwd(), 'package.json');
  const parsed = JSON.parse(readFileSync(fallback, 'utf8')) as PackageManifest;
  assert.equal(parsed.name, PACKAGE_NAME, `${fallback} is not the ${PACKAGE_NAME} manifest`);
  return parsed;
}

// One case on purpose: this is a single metadata contract, and the assertion
// messages name the exact field so a failure points at the drifted value. A new
// case here would also inflate the suite count every release has to reconcile.
test('the package manifest keeps the 0.9.2 DSH 0.2.2-rc.5 compatibility contract', () => {
  const manifest = readManifest();
  const dependencies = manifest.dependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  const peerDependencies = manifest.peerDependencies ?? {};

  // 1. The compat map advertises the releases the plugin was actually exercised
  //    against. 0.9.2 added 0.2.2-rc.5 while keeping the two older entries.
  const dshReleases = manifest.dsh?.compatibility?.dshReleases ?? {};
  for (const release of COMPATIBLE_DSH_RELEASES) {
    assert.equal(
      dshReleases[release],
      'compatible',
      `dsh.compatibility.dshReleases[${release}] must be 'compatible'`,
    );
  }

  // 2. The seven SDK packages the host half imports are pinned to the tested
  //    release so local type-checking sees the same API the host will load.
  for (const packageName of DSH_SDK_DEV_DEPENDENCIES) {
    assert.equal(
      devDependencies[packageName],
      DSH_RELEASE,
      `devDependencies[${packageName}] must pin ${DSH_RELEASE}, the release 0.9.2 was tested against`,
    );
  }

  // 3. The three client host packages the Web half injects are pinned too; the
  //    inject list and the devDependency set must not drift apart.
  for (const packageName of CLIENT_HOST_PEER_DEV_DEPENDENCIES) {
    assert.equal(
      devDependencies[packageName],
      DSH_RELEASE,
      `devDependencies[${packageName}] must pin ${DSH_RELEASE} so the Web half is built against the tested host`,
    );
  }
  assert.deepEqual(
    manifest.dsh?.client?.inject,
    [...CLIENT_HOST_PEER_DEV_DEPENDENCIES],
    'dsh.client.inject must list exactly the three pinned client host packages',
  );

  // 4. Deliberate deviations, kept on purpose:
  //    - cordis 4.1.0 is the newest compatible line; ^4.0.4 stays the peer floor
  //      because 4.0.4 hosts are still supported.
  //    - schemastery: the host bundle ships 3.19.0, but host admission does not
  //      validate it; declaring the conservative ~3.18.4 peer and a 3.18.5 devDep
  //      is intentional, not drift. Do not "fix" this by widening the peer.
  assert.equal(
    devDependencies['@deepseek-ai/cordis'],
    '4.1.0',
    'devDependencies[@deepseek-ai/cordis] must stay at the 4.1.0 line',
  );
  assert.equal(
    devDependencies['@deepseek-ai/schemastery'],
    '3.18.5',
    'devDependencies[@deepseek-ai/schemastery] must stay 3.18.5 (deliberate conservative pin)',
  );
  assert.equal(
    peerDependencies['@deepseek-ai/schemastery'],
    '~3.18.4',
    'peerDependencies[@deepseek-ai/schemastery] must stay ~3.18.4 (deliberate conservative declaration)',
  );

  // 5. Every DSH peer keeps the oldest still-compatible floor: the set is
  //    asserted whole so a silently removed peer is a failure too.
  const declaredDshPeers = Object.keys(peerDependencies)
    .filter((packageName) => packageName.startsWith('@deepseek-ai/dsh-'))
    .sort();
  assert.deepEqual(
    declaredDshPeers,
    [...DSH_PEER_DEPENDENCIES].sort(),
    'peerDependencies must declare exactly the expected ten @deepseek-ai/dsh-* packages (seven SDK + three client host)',
  );
  for (const packageName of DSH_PEER_DEPENDENCIES) {
    assert.equal(
      peerDependencies[packageName],
      DSH_PEER_RANGE,
      `peerDependencies[${packageName}] must stay ${DSH_PEER_RANGE}`,
    );
  }
  assert.equal(
    peerDependencies['@deepseek-ai/cordis'],
    '^4.0.4',
    'peerDependencies[@deepseek-ai/cordis] must stay ^4.0.4',
  );

  // 6. Zero runtime dependencies: the plugin loads only what the host provides.
  assert.equal(
    Object.keys(dependencies).length,
    0,
    'dependencies must stay empty: the plugin declares no runtime dependency',
  );

  // 7. The removed attachment package must not reappear in any dependency kind.
  const sections: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['dependencies', dependencies],
    ['devDependencies', devDependencies],
    ['peerDependencies', peerDependencies],
  ];
  for (const [sectionName, section] of sections) {
    for (const packageName of Object.keys(section)) {
      assert.ok(
        !packageName.includes('dsh-attachment'),
        `${sectionName} must not depend on ${packageName}: the attachment package was dropped in 0.9.2`,
      );
    }
  }

  // 8. Version is a plain semver string. It is deliberately not compared to a
  //    tag: a release bump must not make this guard fail.
  assert.match(
    manifest.version ?? '',
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'version must be a semver string',
  );
});
