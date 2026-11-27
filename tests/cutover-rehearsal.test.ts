/**
 * The Phase 4 cutover rehearsal script, exercised as a black box.
 *
 * `scripts/cutover-rehearsal.mjs` is a fixture dry run, not a unit under test in
 * the usual sense: it has no exported functions and its whole point is that the
 * built plugin runs end to end against a throwaway journal. So this case spawns
 * it the way `npm run rehearsal` does and asserts the outcome the checklist
 * promises: exit 0, every check PASS, and the temp directory removed.
 *
 * The script loads `lib/`. This case skips when the build output is missing, so
 * a type-check-only run does not turn into a build; `npm test` builds first, so
 * CI always runs it. It is not part of the real-capture smoke scripts (those
 * need Screen Recording permission and are deliberately manual): this one has no
 * screen, network, or real-profile dependency.
 * @module tests/cutover-rehearsal
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from the compiled test file to the repository root.
 *
 * The test compiles into `.test-build/tests/`, so the script is two levels up;
 * the walk keeps the case runnable from any output directory (and falls back to
 * the working directory, which `npm test` sets to the repository root).
 */
function findRepositoryRoot(start: string): string {
  let directory = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'scripts', 'cutover-rehearsal.mjs'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return process.cwd();
}

const repositoryRoot = findRepositoryRoot(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repositoryRoot, 'scripts', 'cutover-rehearsal.mjs');
const buildPresent = existsSync(join(repositoryRoot, 'lib', 'index.js'));

test(
  'the cutover rehearsal script passes every fixture check and cleans up',
  { skip: buildPresent ? false : 'lib/ is not built (run `npm run build`)' },
  () => {
    const environment = { ...process.env };
    delete environment.DAYFLOW_REHEARSAL_LIB;
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: 'utf8',
      timeout: 120_000,
      env: environment,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, 0, `the rehearsal exited ${String(result.status)}\n${output}`);
    assert.match(output, /REHEARSAL PASS: \d+\/\d+ checks passed/, 'the rehearsal did not print its pass line');
    assert.doesNotMatch(output, /\bFAIL\b/, 'the rehearsal reported a failed check');
    assert.match(
      output,
      /removed .*dayflow-cutover-rehearsal-/,
      'the rehearsal did not clean up its temp directory',
    );
  },
);
