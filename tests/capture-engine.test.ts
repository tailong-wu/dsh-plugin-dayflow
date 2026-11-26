/**
 * The capture engine's gates, storage, dedupe, retention, and loop contract.
 *
 * Every case gets its own disposable directory with a real (migrated) journal,
 * a real `frames` tree, and a fake provider, plus an injected clock so the
 * Dayflow day and the retention cutoff are deterministic. The fake timers in
 * the loop case make the recursive schedule observable without waiting.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import type { DatabaseSync } from 'node:sqlite';

import { CaptureEngine, hammingDistance } from '../src/capture/engine.js';
import type { CaptureEngineTimers } from '../src/capture/engine.js';
import type { CaptureFrame, CaptureProvider, CaptureProviderState } from '../src/capture/provider.js';
import { readCaptureState, recordScreenshotRow, writeCaptureState } from '../src/capture/state.js';
import { Config, resolveConfig } from '../src/config.js';
import type { CaptureConfig, ResolvedConfig } from '../src/config.js';
import { dayWindowContaining } from '../src/day.js';
import { openJournal } from '../src/journal.js';

/** One throwaway journal + frames tree. */
interface TestCase {
  journalPath: string;
  framesDirectory: string;
}

const root = mkdtempSync(join(tmpdir(), 'dsh-dayflow-capture-engine-test-'));
after(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Noon on a fixed local day; every engine in this file uses it as its clock. */
const NOW = new Date(2026, 10, 26, 12, 0, 0, 0);
/** The Dayflow day that contains {@link NOW}. */
const DAY = dayWindowContaining(NOW).dayKey;

let caseCount = 0;

/** A directory nothing else in this file touches. */
function freshCase(): TestCase {
  caseCount += 1;
  const directory = join(root, `case-${caseCount}`);
  mkdirSync(directory, { recursive: true });
  return { journalPath: join(directory, 'journal.sqlite'), framesDirectory: join(directory, 'frames') };
}

/** Open a journal, run one callback, and close it. */
function withDb<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = openJournal(path);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

/** The engine config, resolved from the real schema with test defaults. */
function configFor(overrides: Partial<CaptureConfig> = {}): ResolvedConfig {
  return resolveConfig({
    capture: {
      enabled: true,
      intervalSeconds: 5,
      idleSeconds: 120,
      maxFramesPerDay: 100,
      keepFramesDays: 0,
      dedupeDistance: 4,
      retentionCheckMinutes: 60,
      pauseApps: [],
      displays: 'main',
      ...overrides,
    },
  });
}

/** A frame the fake provider returns; `hash` is the provider's optional dHash. */
type TestFrame = CaptureFrame;

/** The JPEG bytes these tests store; the engine never decodes them. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

/** One frame at the injected clock, overridable field by field. */
function makeFrame(overrides: Partial<TestFrame> = {}): TestFrame {
  return { jpeg: JPEG, width: 1280, height: 800, capturedAt: NOW.getTime(), ...overrides };
}

/** A scripted frame source: a frame, a thrown error, or a factory. */
type FrameStep = TestFrame | Error | (() => CaptureFrame | Promise<CaptureFrame>);
type FrameFactory = () => CaptureFrame | Promise<CaptureFrame>;

/** Walk the steps in order, repeating the last one once the script runs out. */
function sequence(...steps: FrameStep[]): FrameFactory {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step === undefined) throw new Error('the frame script is empty');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step() : step;
  };
}

/** A capture provider driven by a frame script and an optional state script. */
function makeProvider(
  frames: FrameFactory,
  state?: () => CaptureProviderState | Promise<CaptureProviderState>,
): { provider: CaptureProvider; record: { calls: number } } {
  const record = { calls: 0 };
  const provider: CaptureProvider = {
    name: 'fake-capture-provider',
    async permission() {
      return 'granted';
    },
    async capture() {
      record.calls += 1;
      return frames();
    },
  };
  if (state !== undefined) {
    provider.state = async () => state();
  }
  return { provider, record };
}

/** Build the engine the way the plugin will, with the fixed clock. */
function makeEngine(
  testCase: TestCase,
  provider: CaptureProvider,
  overrides: Partial<CaptureConfig> = {},
  extra: { timers?: CaptureEngineTimers; logger?: (event: string, detail?: Record<string, unknown>) => void } = {},
): CaptureEngine {
  return new CaptureEngine({
    journalPath: testCase.journalPath,
    provider,
    config: configFor(overrides),
    framesDirectory: testCase.framesDirectory,
    now: () => new Date(NOW.getTime()),
    ...extra,
  });
}

/** Every JPEG under a directory, recursively. */
function frameFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...frameFiles(path));
    else if (entry.name.endsWith('.jpg')) found.push(path);
  }
  return found.map((path) => path);
}

/** The `capture_state` table as a key/value map. */
function stateMap(path: string): Map<string, string> {
  return withDb(path, (db) => {
    const rows = db.prepare('SELECT key, value FROM capture_state').all() as { key?: unknown; value?: unknown }[];
    const map = new Map<string, string>();
    for (const row of rows) {
      if (typeof row.key === 'string' && typeof row.value === 'string') map.set(row.key, row.value);
    }
    return map;
  });
}

/** One `screenshots` row as the engine writes it. */
interface ScreenshotRow {
  source_id?: unknown;
  source_key?: unknown;
  captured_at?: unknown;
  file_path?: unknown;
  file_size?: unknown;
  idle_seconds_at_capture?: unknown;
  frame_index?: unknown;
  payload_json?: unknown;
}

/** Every `screenshots` row, oldest first. */
function screenshotRows(path: string): ScreenshotRow[] {
  return withDb(path, (db) => db.prepare('SELECT * FROM screenshots ORDER BY id').all() as unknown as ScreenshotRow[]);
}

/** Force a value past the compiler so the runtime validator is what fails. */
function invalidConfig(value: unknown): never {
  return value as never;
}

/** A schemastery validation failure, which is a `TypeError` carrying the field path. */
function isSchemaValidationError(error: unknown): boolean {
  return error instanceof TypeError && /expect/i.test(error.message);
}

/** A rejected resolveConfig value. */
function isInvalidInput(error: unknown): boolean {
  return error instanceof Error && /^(capture\.|searchLimit|source)/.test(error.message) && /must be/.test(error.message);
}

/** Wait for real (not fake) timers until a loop condition holds. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** Timers a test can see and fire by hand. */
class FakeTimers implements CaptureEngineTimers {
  private nextHandle = 1;
  private readonly pending = new Map<number, { callback: () => void; milliseconds: number }>();

  setTimeout(callback: () => void, milliseconds: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, { callback, milliseconds });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** How many timers are armed right now. */
  get size(): number {
    return this.pending.size;
  }

  /** The delays of the armed timers, in insertion order. */
  get delays(): number[] {
    return [...this.pending.values()].map((entry) => entry.milliseconds);
  }

  /** Fire the oldest armed timer; `false` when none is armed. */
  fireNext(): boolean {
    const first = this.pending.entries().next();
    if (first.done === true) return false;
    const [handle, entry] = first.value;
    this.pending.delete(handle);
    entry.callback();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Storing one frame
// ---------------------------------------------------------------------------

test('a captured frame is written privately and recorded in the journal', async () => {
  const testCase = freshCase();
  const hash = '0f1e2d3c4b5a6978';
  const frame = makeFrame({
    hash,
    app: { bundleId: 'com.apple.Safari', name: 'Safari', windowTitle: 'Example' },
    idleSeconds: 5,
  });
  const { provider, record } = makeProvider(sequence(frame));
  const engine = makeEngine(testCase, provider);

  assert.equal(await engine.captureOnce(), 'stored');
  assert.equal(record.calls, 1, 'the provider was used once');

  const files = frameFiles(testCase.framesDirectory);
  assert.equal(files.length, 1, 'exactly one frame is on disk');
  const expectedPath = join(testCase.framesDirectory, DAY, `${frame.capturedAt}-${hash}.jpg`);
  assert.equal(files[0], expectedPath);
  assert.equal(statSync(expectedPath).mode & 0o777, 0o600, 'the frame file is private');
  assert.equal(statSync(join(testCase.framesDirectory, DAY)).mode & 0o777, 0o700, 'the day directory is private');
  assert.equal(statSync(expectedPath).size, JPEG.byteLength);

  const rows = screenshotRows(testCase.journalPath);
  assert.equal(rows.length, 1);
  const row = rows[0] as ScreenshotRow;
  assert.equal(row.source_id, 'native');
  assert.equal(row.source_key, `${hash}:${Math.floor(frame.capturedAt / 1000)}`);
  assert.equal(row.captured_at, Math.floor(frame.capturedAt / 1000));
  assert.equal(row.file_path, expectedPath);
  assert.equal(row.file_size, JPEG.byteLength);
  assert.equal(row.idle_seconds_at_capture, 5);
  assert.equal(row.frame_index, 0);
  const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
  assert.equal(payload.hash, hash);
  assert.equal(payload.width, 1280);
  assert.equal(payload.height, 800);
  assert.equal(payload.outcome, 'stored');
  assert.deepEqual(payload.app, { bundleId: 'com.apple.Safari', name: 'Safari', windowTitle: 'Example' });

  const state = withDb(testCase.journalPath, (db) => readCaptureState(db));
  assert.equal(state.lastFrameAt, frame.capturedAt);
  assert.equal(stateMap(testCase.journalPath).get('last_frame_hash'), hash, 'the dHash hint is journaled for a restart');

  const status = engine.status();
  assert.equal(status.running, false);
  assert.equal(status.paused, false);
  assert.equal(status.framesToday, 1);
  assert.equal(status.lastFrameAt, frame.capturedAt);
  assert.equal(status.lastOutcome, 'stored');
  assert.equal(status.lastSkipReason, undefined);
  assert.equal(status.lastError, undefined);
});

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

test('a paused journal skips capture until it is resumed', async () => {
  const testCase = freshCase();
  withDb(testCase.journalPath, (db) => {
    writeCaptureState(db, { paused: true });
  });
  const { provider, record } = makeProvider(sequence(makeFrame({ hash: '0000000000000000' })));
  const engine = makeEngine(testCase, provider);

  assert.equal(await engine.captureOnce(), 'paused');
  assert.equal(record.calls, 0, 'a paused engine does not take a frame');
  assert.deepEqual(frameFiles(testCase.framesDirectory), []);
  assert.deepEqual(screenshotRows(testCase.journalPath), []);
  assert.equal(engine.status().paused, true);
  assert.equal(engine.status().lastOutcome, 'paused');

  withDb(testCase.journalPath, (db) => {
    writeCaptureState(db, { paused: false });
  });
  assert.equal(await engine.captureOnce(), 'stored');
  assert.equal(record.calls, 1);
  assert.equal(frameFiles(testCase.framesDirectory).length, 1);
  assert.equal(engine.status().paused, false);
});

// ---------------------------------------------------------------------------
// Idle and locked screens
// ---------------------------------------------------------------------------

test('idle input is skipped, and idleSeconds: 0 disables the idle gate', async () => {
  const testCase = freshCase();
  const idleFrame = makeFrame({ hash: '1111111111111111', idleSeconds: 500 });
  const { provider, record } = makeProvider(sequence(idleFrame));
  const engine = makeEngine(testCase, provider, { idleSeconds: 120 });

  assert.equal(await engine.captureOnce(), 'idle');
  assert.equal(record.calls, 1, 'the frame was taken before the idle gate could skip it');
  assert.deepEqual(frameFiles(testCase.framesDirectory), []);
  assert.deepEqual(screenshotRows(testCase.journalPath), []);
  assert.match(String(engine.status().lastSkipReason), /idle/);

  // The documented 0 disables the gate: the same idle frame is now stored.
  const disabled = makeEngine(testCase, makeProvider(sequence(makeFrame({ hash: '2222222222222222', idleSeconds: 500 }))).provider, {
    idleSeconds: 0,
  });
  assert.equal(await disabled.captureOnce(), 'stored');
  assert.equal(frameFiles(testCase.framesDirectory).length, 1);
});

test('a locked or sleeping screen is skipped without taking a frame', async () => {
  const lockedCase = freshCase();
  const locked = makeProvider(sequence(makeFrame()), () => ({ locked: true, displayAsleep: false }));
  const lockedEngine = makeEngine(lockedCase, locked.provider);
  assert.equal(await lockedEngine.captureOnce(), 'locked');
  assert.equal(locked.record.calls, 0);
  assert.match(String(lockedEngine.status().lastSkipReason), /locked/);
  assert.deepEqual(frameFiles(lockedCase.framesDirectory), []);

  const asleepCase = freshCase();
  const asleep = makeProvider(sequence(makeFrame()), () => ({ locked: false, displayAsleep: true }));
  const asleepEngine = makeEngine(asleepCase, asleep.provider);
  assert.equal(await asleepEngine.captureOnce(), 'locked');
  assert.equal(asleep.record.calls, 0);
  assert.match(String(asleepEngine.status().lastSkipReason), /asleep/);
  assert.deepEqual(frameFiles(asleepCase.framesDirectory), []);
});

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

test('duplicate frames are deduped by dHash distance and by raw bytes', async () => {
  // The Hamming helper itself: valid equal-length hex only.
  assert.equal(hammingDistance('0000000000000000', '0000000000000001'), 1);
  assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64);
  assert.equal(hammingDistance('0000000000000000', '0000'), undefined, 'lengths must match');
  assert.equal(hammingDistance('zzzzzzzzzzzzzzzz', '0000000000000000'), undefined, 'hex only');

  // (a) Same hash twice: the second frame never reaches the disk.
  const sameCase = freshCase();
  const sameHash = '0123456789abcdef';
  const same = makeProvider(sequence(makeFrame({ hash: sameHash }), makeFrame({ hash: sameHash })));
  const sameEngine = makeEngine(sameCase, same.provider);
  assert.equal(await sameEngine.captureOnce(), 'stored');
  assert.equal(await sameEngine.captureOnce(), 'deduped');
  assert.equal(frameFiles(sameCase.framesDirectory).length, 1);
  assert.equal(screenshotRows(sameCase.journalPath).length, 1);
  assert.equal(same.record.calls, 2, 'dedupe happens after the capture, not before it');

  // A restarted engine remembers the hash from capture_state.
  const restarted = makeProvider(sequence(makeFrame({ hash: sameHash })));
  const restartedEngine = makeEngine(sameCase, restarted.provider);
  assert.equal(await restartedEngine.captureOnce(), 'deduped', 'the journaled hint survives a new engine instance');

  // (b) A Hamming distance inside dedupeDistance (default 4) is a duplicate.
  const nearCase = freshCase();
  const near = makeProvider(
    sequence(makeFrame({ hash: '0000000000000000' }), makeFrame({ hash: '0000000000000001' })),
  );
  const nearEngine = makeEngine(nearCase, near.provider);
  assert.equal(await nearEngine.captureOnce(), 'stored');
  assert.equal(await nearEngine.captureOnce(), 'deduped');
  assert.equal(frameFiles(nearCase.framesDirectory).length, 1);

  // (c) A distance above dedupeDistance is a different picture and is stored.
  const farCase = freshCase();
  const far = makeProvider(
    sequence(makeFrame({ hash: '0000000000000000' }), makeFrame({ hash: 'ffffffffffffffff' })),
  );
  const farEngine = makeEngine(farCase, far.provider);
  assert.equal(await farEngine.captureOnce(), 'stored');
  assert.equal(await farEngine.captureOnce(), 'stored');
  const farRows = screenshotRows(farCase.journalPath);
  assert.equal(farRows.length, 2);
  assert.equal(farRows[0]?.frame_index, 0);
  assert.equal(farRows[1]?.frame_index, 1);
  assert.equal(frameFiles(farCase.framesDirectory).length, 2);

  // (d) A non-adjacent repeat (A, B, A) is a new frame, not a key collision.
  const revisitCase = freshCase();
  const revisit = makeProvider(
    sequence(
      makeFrame({ hash: '0000000000000000', capturedAt: NOW.getTime() }),
      makeFrame({ hash: 'ffffffffffffffff', capturedAt: NOW.getTime() + 1000 }),
      makeFrame({ hash: '0000000000000000', capturedAt: NOW.getTime() + 2000 }),
    ),
  );
  const revisitEngine = makeEngine(revisitCase, revisit.provider);
  assert.equal(await revisitEngine.captureOnce(), 'stored');
  assert.equal(await revisitEngine.captureOnce(), 'stored');
  assert.equal(await revisitEngine.captureOnce(), 'stored', 'returning to an earlier screen is a new frame');
  const revisitRows = screenshotRows(revisitCase.journalPath);
  assert.equal(revisitRows.length, 3, 'each stored frame gets its own row');
  assert.deepEqual(
    revisitRows.map((revisitRow) => revisitRow.frame_index),
    [0, 1, 2],
  );
  assert.equal(frameFiles(revisitCase.framesDirectory).length, 3, 'and its own file');

  // (e) Without a provider hash, identical bytes are still a duplicate.
  const bytesCase = freshCase();
  const bytes = makeProvider(sequence(makeFrame(), makeFrame()));
  const bytesEngine = makeEngine(bytesCase, bytes.provider);
  assert.equal(await bytesEngine.captureOnce(), 'stored');
  assert.equal(await bytesEngine.captureOnce(), 'deduped');
  assert.equal(frameFiles(bytesCase.framesDirectory).length, 1);
  assert.equal(stateMap(bytesCase.journalPath).get('last_frame_sha256')?.length, 64, 'the SHA-256 hint is journaled');
});

// ---------------------------------------------------------------------------
// Paused apps
// ---------------------------------------------------------------------------

test('the frontmost app matching a bundle id or a name pattern is skipped', async () => {
  const testCase = freshCase();
  const script = sequence(
    makeFrame({ hash: 'aaaaaaaaaaaaaaaa', app: { bundleId: 'com.example.Secret', name: 'Secret' } }),
    makeFrame({ hash: 'bbbbbbbbbbbbbbbb', app: { bundleId: 'com.tinyspeck.slackmacgap', name: 'Slack Desktop' } }),
    makeFrame({ hash: 'cccccccccccccccc', app: { bundleId: 'com.apple.Safari', name: 'Safari' } }),
  );
  const { provider, record } = makeProvider(script);
  const engine = makeEngine(testCase, provider, { pauseApps: ['com.example.Secret', 'Slack'] });

  assert.equal(await engine.captureOnce(), 'paused-app', 'the bundle id matches exactly');
  assert.equal(await engine.captureOnce(), 'paused-app', 'the display name contains the pattern, case-insensitively');
  assert.equal(await engine.captureOnce(), 'stored', 'an unrelated app is captured');
  assert.equal(record.calls, 3);
  assert.equal(frameFiles(testCase.framesDirectory).length, 1);
  assert.equal(screenshotRows(testCase.journalPath).length, 1);
});

// ---------------------------------------------------------------------------
// Daily cap
// ---------------------------------------------------------------------------

test('the daily frame cap is enforced before capture', async () => {
  const testCase = freshCase();
  withDb(testCase.journalPath, (db) => {
    recordScreenshotRow(db, {
      sourceKey: 'pre-existing-frame',
      capturedAt: NOW.getTime(),
      day: DAY,
      filePath: join(testCase.framesDirectory, DAY, 'pre-existing.jpg'),
    });
  });
  const { provider, record } = makeProvider(sequence(makeFrame({ hash: '1234567890abcdef' })));
  const engine = makeEngine(testCase, provider, { maxFramesPerDay: 1 });

  assert.equal(await engine.captureOnce(), 'capped');
  assert.equal(record.calls, 0, 'a capped day does not even take a frame');
  assert.deepEqual(frameFiles(testCase.framesDirectory), []);
  assert.equal(screenshotRows(testCase.journalPath).length, 1, 'the pre-existing row is the only one');
  assert.match(String(engine.status().lastSkipReason), /cap/);
  assert.equal(engine.status().framesToday, 1);
});

// ---------------------------------------------------------------------------
// Failures never escape a tick
// ---------------------------------------------------------------------------

test('a provider failure is an error outcome and the next tick still stores', async () => {
  const testCase = freshCase();
  const { provider, record } = makeProvider(
    sequence(new Error('screencapture exploded'), makeFrame({ hash: 'feedfacecafebeef' })),
  );
  const engine = makeEngine(testCase, provider);

  assert.equal(await engine.captureOnce(), 'error', 'captureOnce reports the failure instead of throwing');
  assert.match(String(engine.status().lastError), /screencapture exploded/);
  assert.equal(engine.status().lastOutcome, 'error');
  assert.deepEqual(frameFiles(testCase.framesDirectory), [], 'a failed capture writes nothing');

  assert.equal(await engine.captureOnce(), 'stored', 'the loop recovers on the next tick');
  assert.equal(record.calls, 2);
  assert.equal(engine.status().lastError, undefined, 'a stored frame clears the failure');
  assert.equal(frameFiles(testCase.framesDirectory).length, 1);
});

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test('the loop ticks immediately, schedules itself once, and stops cleanly', async () => {
  const testCase = freshCase();
  const timers = new FakeTimers();
  const { provider, record } = makeProvider(sequence(makeFrame({ hash: '9999999999999999' })));
  const engine = makeEngine(testCase, provider, {}, { timers });

  engine.start();
  engine.start(); // idempotent: a second start must not arm a second loop
  await waitFor(() => record.calls === 1 && timers.size === 1, 'the first tick and its schedule');
  assert.equal(record.calls, 1, 'the first tick runs immediately');
  assert.equal(timers.size, 1, 'exactly one timer is armed');
  assert.deepEqual(timers.delays, [5000], 'the delay is capture.intervalSeconds');
  assert.equal(engine.status().running, true);

  timers.fireNext();
  await waitFor(() => record.calls === 2 && timers.size === 1, 'the second tick and its schedule');
  assert.equal(timers.size, 1, 'the loop never arms two timers at once');

  engine.stop();
  assert.equal(timers.size, 0, 'stop clears the pending timer');
  assert.equal(engine.status().running, false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(record.calls, 2, 'no tick runs after stop');

  // A stopped engine can be restarted, and stays single.
  engine.start();
  await waitFor(() => record.calls === 3 && timers.size === 1, 'the restarted loop');
  engine.stop();
  assert.equal(timers.size, 0);
});

test('stopping during an in-flight tick lets it finish without scheduling another', async () => {
  const testCase = freshCase();
  const timers = new FakeTimers();
  const { provider, record } = makeProvider(sequence(makeFrame({ hash: 'abcdefabcdefabcd' })));
  const engine = makeEngine(testCase, provider, {}, { timers });

  engine.start();
  engine.stop(); // the first tick has started but not settled
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(record.calls, 1, 'the in-flight tick still completed');
  assert.equal(timers.size, 0, 'and it could not schedule a successor');
  assert.equal(engine.status().running, false);
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test('the retention sweep deletes expired frames and keeps fresh ones', async () => {
  const testCase = freshCase();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const oldDirectory = join(testCase.framesDirectory, '2026-01-01');
  mkdirSync(oldDirectory, { recursive: true, mode: 0o700 });
  const oldFile = join(oldDirectory, 'old-frame.jpg');
  writeFileSync(oldFile, 'old frame');
  const oldSeconds = (NOW.getTime() - twoDays) / 1000;
  utimesSync(oldFile, oldSeconds, oldSeconds);

  const { provider } = makeProvider(sequence(makeFrame({ hash: '5555555555555555' })));
  const engine = makeEngine(testCase, provider, { keepFramesDays: 0, retentionCheckMinutes: 5 });
  assert.equal(await engine.captureOnce(), 'stored');

  assert.equal(existsSync(oldFile), false, 'keepFramesDays: 0 still keeps only the last day');
  assert.equal(existsSync(oldDirectory), false, 'the emptied day directory is removed');
  assert.equal(frameFiles(join(testCase.framesDirectory, DAY)).length, 1, 'the fresh frame stays');

  // The sweep interval is honored: a second expired file survives the next tick.
  const laterDirectory = join(testCase.framesDirectory, '2026-01-02');
  mkdirSync(laterDirectory, { recursive: true, mode: 0o700 });
  const laterFile = join(laterDirectory, 'later-frame.jpg');
  writeFileSync(laterFile, 'later frame');
  utimesSync(laterFile, oldSeconds, oldSeconds);
  assert.equal(await engine.captureOnce(), 'deduped');
  assert.equal(existsSync(laterFile), true, 'the sweep does not run again before retentionCheckMinutes');
});

test('keepFramesDays above the file age keeps it', async () => {
  const testCase = freshCase();
  const twoDays = 2 * 24 * 60 * 60 * 1000;
  const keptDirectory = join(testCase.framesDirectory, '2026-01-03');
  mkdirSync(keptDirectory, { recursive: true, mode: 0o700 });
  const keptFile = join(keptDirectory, 'kept-frame.jpg');
  writeFileSync(keptFile, 'kept frame');
  const oldSeconds = (NOW.getTime() - twoDays) / 1000;
  utimesSync(keptFile, oldSeconds, oldSeconds);

  const { provider } = makeProvider(sequence(makeFrame({ hash: '6666666666666666' })));
  const engine = makeEngine(testCase, provider, { keepFramesDays: 3 });
  assert.equal(await engine.captureOnce(), 'stored');
  assert.equal(existsSync(keptFile), true, 'a two-day-old file survives a three-day retention');
  assert.equal(frameFiles(testCase.framesDirectory).length, 2, 'old and new both exist');
});

// ---------------------------------------------------------------------------
// A failed journal write must not leave a frame behind
// ---------------------------------------------------------------------------

test('a journal write failure removes the frame it just wrote', async () => {
  caseCount += 1;
  const directory = join(root, `case-${caseCount}`);
  mkdirSync(directory, { recursive: true });
  const journalPath = join(directory, 'journal.sqlite');
  mkdirSync(journalPath); // a directory where the journal file must be: unopenable
  const framesDirectory = join(directory, 'frames');
  const { provider, record } = makeProvider(sequence(makeFrame({ hash: '7777777777777777' })));
  const engine = new CaptureEngine({
    journalPath,
    provider,
    config: configFor(),
    framesDirectory,
    now: () => new Date(NOW.getTime()),
  });

  assert.equal(await engine.captureOnce(), 'error', 'the unopenable journal fails the tick');
  assert.equal(record.calls, 1, 'the frame was captured before the write failed');
  assert.match(String(engine.status().lastError), /journal|database|open/i);
  assert.deepEqual(frameFiles(framesDirectory), [], 'the orphan frame was deleted again');
  assert.doesNotThrow(() => engine.status(), 'status survives an unreadable journal');
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('dedupeDistance and retentionCheckMinutes resolve with defaults and bounds', () => {
  const defaults = resolveConfig({});
  assert.equal(defaults.capture.dedupeDistance, 4);
  assert.equal(defaults.capture.retentionCheckMinutes, 60);
  const parsed = Config({});
  assert.equal(parsed.capture?.dedupeDistance, 4);
  assert.equal(parsed.capture?.retentionCheckMinutes, 60);

  const low = resolveConfig({ capture: { dedupeDistance: 0, retentionCheckMinutes: 5 } });
  assert.equal(low.capture.dedupeDistance, 0);
  assert.equal(low.capture.retentionCheckMinutes, 5);
  const high = resolveConfig({ capture: { dedupeDistance: 16, retentionCheckMinutes: 1440 } });
  assert.equal(high.capture.dedupeDistance, 16);
  assert.equal(high.capture.retentionCheckMinutes, 1440);

  const rejected = [
    { label: 'dedupeDistance above 16', value: { capture: { dedupeDistance: 17 } } },
    { label: 'dedupeDistance below 0', value: { capture: { dedupeDistance: -1 } } },
    { label: 'dedupeDistance not a whole number', value: { capture: { dedupeDistance: 2.5 } } },
    { label: 'retentionCheckMinutes below 5', value: { capture: { retentionCheckMinutes: 4 } } },
    { label: 'retentionCheckMinutes above 1440', value: { capture: { retentionCheckMinutes: 1441 } } },
  ];
  for (const { label, value } of rejected) {
    assert.throws(() => resolveConfig(invalidConfig(value)), isInvalidInput, `resolveConfig rejects ${label}`);
    assert.throws(() => Config(invalidConfig(value)), isSchemaValidationError, `Config rejects ${label}`);
  }
});
