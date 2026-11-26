#!/usr/bin/env node
/**
 * Phase 1 capture-engine smoke: run the real engine three times against the real
 * screen, into a throwaway journal, then print what landed and delete it.
 *
 * This is a local manual check, not part of `npm test`: it needs the real Screen
 * Recording permission and it writes a journal. Everything it writes lives under
 * one `mkdtemp` directory (journal, frames, compiled helper), so the plugin's
 * real journal under `$DSH_HOME/dayflow` is never touched, and the directory is
 * removed before the process exits.
 *
 *   npm run build
 *   node scripts/native-engine-smoke.mjs
 *   # or point the script at a compiled engine elsewhere:
 *   DAYFLOW_ENGINE_MODULE=/tmp/build/capture/engine.js node scripts/native-engine-smoke.mjs
 *
 * Exit codes: 0 success, 1 a failed assertion, 2 no Screen Recording permission,
 * 3 the screen was locked or asleep for the whole run.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRAME_COUNT = 3;
const FRAME_INTERVAL_MS = 2000;
const SETTINGS_PATH = 'System Settings → Privacy & Security → Screen Recording';

/** Wait without a busy loop. */
function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Load the compiled engine and its siblings.
 *
 * `lib/` is the published layout; `DAYFLOW_ENGINE_MODULE` points at a compiled
 * `capture/engine.js` from another build directory (the build itself is not run
 * here, because a running `tsc` would race the repository's own build).
 */
async function loadModules() {
  const override = process.env.DAYFLOW_ENGINE_MODULE?.trim();
  if (override !== undefined && override !== '') {
    const enginePath = resolve(override);
    const captureDirectory = dirname(enginePath);
    const libraryDirectory = dirname(captureDirectory);
    const load = (path) => import(pathToFileURL(path).href);
    return {
      enginePath,
      engine: await load(enginePath),
      provider: await load(join(captureDirectory, 'provider.js')),
      config: await load(join(libraryDirectory, 'config.js')),
      journal: await load(join(libraryDirectory, 'journal.js')),
    };
  }

  try {
    const enginePath = fileURLToPath(new URL('../lib/capture/engine.js', import.meta.url));
    return {
      enginePath,
      engine: await import('../lib/capture/engine.js'),
      provider: await import('../lib/capture/provider.js'),
      config: await import('../lib/config.js'),
      journal: await import('../lib/journal.js'),
    };
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error(
      'The capture engine is not built. Run `npm run build` first, or set ' +
        'DAYFLOW_ENGINE_MODULE to a compiled capture/engine.js.',
      { cause: error },
    );
  }
}

/** Count JPEGs under a directory, recursively. */
async function countFrames(directory) {
  if (!existsSync(directory)) return 0;
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await countFrames(path);
    else if (entry.name.endsWith('.jpg')) count += 1;
  }
  return count;
}

/** Every row of a table, as objects. */
function rows(db, sql) {
  return db.prepare(sql).all();
}

async function main() {
  const { enginePath, engine, provider: providerModule, config: configModule, journal: journalModule } = await loadModules();
  const root = await mkdtemp(join(tmpdir(), 'dayflow-engine-smoke-'));
  try {
    const journalPath = join(root, 'journal.sqlite');
    const framesDirectory = join(root, 'frames');
    const provider = providerModule.createNativeCaptureProvider({ helperDirectory: join(root, 'helper') });
    const helperAvailable = await provider.helperAvailable();
    const permission = await provider.permission();

    console.log(`platform: ${process.platform} (Node ${process.version})`);
    console.log(`engine: ${enginePath}`);
    console.log(`helper: ${helperAvailable ? 'available' : 'unavailable (screencapture only)'}`);
    console.log(`permission: ${permission}`);
    console.log(`journal: ${journalPath}`);
    console.log(`frames: ${framesDirectory}`);

    if (permission !== 'granted') {
      console.error('');
      console.error(`Screen Recording permission is ${permission}.`);
      console.error(`Grant it in ${SETTINGS_PATH}, then run this script again.`);
      console.error('The terminal or the app running this script needs the permission.');
      return 2;
    }

    // The three ticks are driven by hand with a 2s gap; `intervalSeconds` only
    // has to satisfy the profile schema (5-600) because `start()` is not used.
    const resolved = configModule.resolveConfig({
      capture: {
        enabled: true,
        intervalSeconds: 5,
        idleSeconds: 0,
        maxFramesPerDay: 100,
        keepFramesDays: 1,
        dedupeDistance: 4,
        retentionCheckMinutes: 60,
      },
    });
    const captureEngine = new engine.CaptureEngine({
      journalPath,
      provider,
      config: resolved,
      framesDirectory,
      logger: (event, detail) => console.log(`  log ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}`),
    });

    const outcomes = [];
    for (let index = 1; index <= FRAME_COUNT; index += 1) {
      if (index > 1) await sleep(FRAME_INTERVAL_MS);
      const outcome = await captureEngine.captureOnce();
      outcomes.push(outcome);
      const status = captureEngine.status();
      console.log(
        `tick ${index}/${FRAME_COUNT}: outcome=${outcome} framesToday=${status.framesToday} ` +
          `lastFrameAt=${status.lastFrameAt === undefined ? 'none' : new Date(status.lastFrameAt).toISOString()}` +
          `${status.lastSkipReason ? ` reason=${status.lastSkipReason}` : ''}`,
      );
    }

    if (!outcomes.includes('stored')) {
      if (outcomes.every((outcome) => outcome === 'locked')) {
        // The gate is working; the machine just has nothing to show it.
        console.error('');
        console.error('The screen is locked or asleep, so every tick was skipped.');
        console.error(`Unlock ${process.env.HOSTNAME ?? 'this Mac'} and run the smoke again.`);
        return 3;
      }
      console.error(`FAIL: no tick stored a frame (outcomes: ${outcomes.join(', ')})`);
      return 1;
    }

    // Read the throwaway journal back with the same migrated connection the
    // plugin uses, so the printed rows are the real contract, not engine memory.
    const db = journalModule.openJournal(journalPath);
    try {
      const screenshots = rows(db, 'SELECT id, source_key, captured_at, file_path, file_size, idle_seconds_at_capture, frame_index FROM screenshots ORDER BY id');
      console.log(`screenshots rows: ${screenshots.length}`);
      for (const row of screenshots) {
        console.log(
          `  #${row.id} key=${row.source_key} captured_at=${row.captured_at} bytes=${row.file_size} ` +
            `frame_index=${row.frame_index} file=${row.file_path}`,
        );
      }
      const states = rows(db, 'SELECT key, value FROM capture_state ORDER BY key');
      console.log(`capture_state entries: ${states.length}`);
      for (const state of states) console.log(`  ${state.key}=${state.value}`);
    } finally {
      db.close();
    }

    console.log(`frames on disk: ${await countFrames(framesDirectory)}`);
    console.log(`SMOKE OK: ${outcomes.filter((outcome) => outcome === 'stored').length}/${FRAME_COUNT} ticks stored a frame.`);
    return 0;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    console.log(`removed ${root}`);
  }
}

/** The label printed for a module load failure. */
function moduleLabel() {
  return process.env.DAYFLOW_ENGINE_MODULE?.trim() || fileURLToPath(new URL('../lib/capture/engine.js', import.meta.url));
}

const exitCode = await main().catch((error) => {
  console.error(`SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`engine module: ${moduleLabel()}`);
  return 1;
});
process.exitCode = exitCode;
