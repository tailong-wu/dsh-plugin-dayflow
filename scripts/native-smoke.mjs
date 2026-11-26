#!/usr/bin/env node
/**
 * Catch three real frames from this Mac and print what the native provider saw.
 *
 * This is the Phase 0/1 feasibility smoke, not part of `npm test`: it needs the
 * real Screen Recording permission and actually reads the screen. It writes no
 * journal and touches no owned store; every frame lives in a temporary
 * directory that the provider removes before `capture()` resolves, so the run
 * ends by confirming nothing was left behind. It also prints the helper's
 * lock/display state and each frame's dHash, so the two inputs the Phase 1
 * capture engine skips and dedupes on are visible without reading a journal.
 *
 *   node scripts/native-smoke.mjs
 *
 * The provider loads from `lib/capture/provider.js` after `npm run build`, or
 * straight from `src/capture/provider.ts` on a Node version that strips
 * TypeScript types (23.6+, or 22.18+).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FRAME_COUNT = 3;
const FRAME_INTERVAL_MS = 2000;
const SETTINGS_PATH = 'System Settings → Privacy & Security → Screen Recording';

/** Load the provider from the build output, else from the TypeScript source. */
async function loadProvider() {
  try {
    return await import('../lib/capture/provider.js');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    try {
      return await import('../src/capture/provider.ts');
    } catch (typedError) {
      throw new Error(
        'Cannot load the capture provider: run `npm run build` first, or use a Node ' +
          'version that can import the TypeScript source directly (23.6+/22.18+).',
        { cause: typedError },
      );
    }
  }
}

/** Wait without a busy loop. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The macOS marketing version, for the banner. */
function macOsVersion() {
  try {
    return execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Temporary frame and probe directories a broken provider would leak. */
function leftoverFrames() {
  try {
    return readdirSync(tmpdir()).filter(
      (name) =>
        name.startsWith('dayflow-capture-frame-') || name.startsWith('dayflow-capture-probe-'),
    );
  } catch {
    return [];
  }
}

const { createNativeCaptureProvider } = await loadProvider();
const provider = createNativeCaptureProvider();

const helperAvailable = await provider.helperAvailable();
const permission = await provider.permission();

console.log(`platform: ${process.platform} ${macOsVersion()} (Node ${process.version})`);
console.log(`helper: ${helperAvailable ? 'available' : 'unavailable (screencapture only)'}`);
console.log(`permission: ${permission}`);

if (permission !== 'granted') {
  console.error('');
  console.error(`Screen Recording permission is ${permission}.`);
  console.error(`Grant it in ${SETTINGS_PATH}, then run this script again.`);
  console.error('The terminal or the DeepSeek Harness app running this script needs the permission.');
  process.exit(2);
}

const state = await provider.state?.();
if (state) {
  const app = state.app ? JSON.stringify(state.app) : 'unknown';
  console.log(
    `state: locked=${state.locked}, displayAsleep=${state.displayAsleep}, ` +
      `idleSeconds=${state.idleSeconds ?? 'unknown'}, app=${app}`,
  );
}
if (state?.locked === true || state?.displayAsleep === true) {
  console.log('screen is locked or the display is asleep; skipping frame capture.');
}

let captured = 0;
if (!state?.locked && !state?.displayAsleep) {
  for (let index = 1; index <= FRAME_COUNT; index += 1) {
    if (index > 1) await sleep(FRAME_INTERVAL_MS);
    const frame = await provider.capture();
    captured += 1;
    const app = frame.app ? JSON.stringify(frame.app) : 'unknown';
    console.log(
      `frame ${index}/${FRAME_COUNT}: ${frame.width}x${frame.height}, ` +
        `${frame.jpeg.byteLength} bytes, capturedAt=${new Date(frame.capturedAt).toISOString()}, ` +
        `app=${app}, idleSeconds=${frame.idleSeconds ?? 'unknown'}, ` +
        `hash=${frame.hash ?? 'none (screencapture fallback)'}`,
    );
  }
}

await provider.dispose?.();

const leftover = leftoverFrames();
if (leftover.length > 0) {
  console.error(`temporary frame files were left behind: ${leftover.join(', ')}`);
  process.exit(1);
}
if (captured === 0) {
  console.log('no frames captured; no temporary frame files left behind.');
} else {
  console.log(`${captured} frames captured; no temporary frame files left behind.`);
}
