/**
 * Native capture provider: permission, frames, metadata, and the JPEG parser.
 *
 * Nothing here takes a real screenshot. Every test injects the command runner,
 * points the helper at a disposable directory under a `mkdtemp`, and fakes the
 * clock, so the provider code under test is the real one while the machine's
 * Screen Recording permission never matters. The one real JPEG below was
 * produced once by `screencapture` and downscaled with `sips`; it is embedded so
 * the frame bytes and their SOF dimensions can be asserted exactly.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CaptureError,
  createNativeCaptureProvider,
  jpegDimensions,
  parseHelperMeta,
} from '../src/capture/provider.js';
import type { CaptureCommandRunner } from '../src/capture/provider.js';

const directory = mkdtempSync(join(tmpdir(), 'dsh-dayflow-capture-test-'));
after(() => rmSync(directory, { recursive: true, force: true }));

let counter = 0;

/** A fresh directory inside the disposable root. */
function testDirectory(label: string): string {
  counter += 1;
  return join(directory, `${label}-${counter}`);
}

/** Run a task with `TMPDIR` pointed at a disposable directory. */
async function withTemporaryRoot<T>(root: string, task: () => Promise<T>): Promise<T> {
  mkdirSync(root, { recursive: true });
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    return await task();
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
}

/** A real 3x2 JPEG: `screencapture`, then `sips -z 2 3`, profile stripped. */
const JPEG = Uint8Array.from(
  Buffer.from(
    [
      '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAAB',
      '//8AAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklN',
      'BCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAAB',
      'AgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNi',
      'coIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SV',
      'lpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8B',
      'AAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXET',
      'IjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpz',
      'dHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm',
      '5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwM',
      'DA4ODg4ODw8PDw8PDw8PD//bAEMBAgMDBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
      'EBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A/GKQneabk06T75plaGZ//9k=',
    ].join(''),
    'base64',
  ),
);

/** One recorded child-process call. */
interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

/** The value a stubbed call resolves with. */
interface StubResult {
  readonly code: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** A runner that records calls and answers them from `handler`. */
function recordingRunner(
  handler: (call: RecordedCall) => StubResult | Promise<StubResult>,
): { calls: RecordedCall[]; run: CaptureCommandRunner } {
  const calls: RecordedCall[] = [];
  const run: CaptureCommandRunner = async (command, args, options) => {
    const call = { command, args: [...args], timeoutMs: options.timeoutMs };
    calls.push(call);
    const result = await handler(call);
    return { code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { calls, run };
}

/** The path the compile step was told to write the helper to. */
function compiledHelperPath(args: readonly string[]): string {
  const index = args.indexOf('-o');
  assert.ok(index >= 0, 'swiftc invocation carries -o');
  const path = args[index + 1];
  assert.ok(path, 'swiftc invocation carries an output path');
  return path;
}

/** Handle a successful fake `swiftc` run by creating the helper file. */
function buildsHelper(call: RecordedCall, source = '#!/bin/sh\n'): StubResult {
  writeFileSync(compiledHelperPath(call.args), source);
  return { code: 0 };
}

/** A 1x1-compatible frame header with a chosen SOF marker and dimensions. */
function frameHeader(marker: number, width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0, length 16
    ...new Array<number>(14).fill(0),
    0xff,
    marker,
    0x00,
    0x11, // SOF, length 17
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // three components
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9, // EOI
  ]);
}

test('permission maps the helper preflight result', async () => {
  const helperDirectory = testDirectory('preflight');
  const { calls, run } = recordingRunner((call) => {
    if (call.command === 'xcrun') return buildsHelper(call);
    if (call.args[0] === 'preflight') return { code: 0, stdout: 'granted\n' };
    throw new Error(`unexpected command ${call.command} ${call.args.join(' ')}`);
  });
  const provider = createNativeCaptureProvider({ helperDirectory, run });

  assert.equal(provider.name, 'native-screencapture');
  assert.equal(await provider.helperAvailable(), true);
  assert.equal(await provider.permission(), 'granted');
  assert.equal(await provider.permission(), 'granted');

  assert.equal(
    calls.filter((call) => call.command === 'xcrun').length,
    1,
    'the helper is compiled once and reused',
  );
  assert.deepEqual(
    calls.filter((call) => call.command !== 'xcrun').map((call) => call.args),
    [['preflight'], ['preflight']],
  );
});

test('permission reports denied when preflight exits 1', async () => {
  const helperDirectory = testDirectory('denied');
  const { run } = recordingRunner((call) => {
    if (call.command === 'xcrun') return buildsHelper(call);
    return { code: 1, stdout: 'denied\n' };
  });
  const provider = createNativeCaptureProvider({ helperDirectory, run });
  assert.equal(await provider.permission(), 'denied');
});

test('permission reports unknown when the runner throws', async () => {
  const { run } = recordingRunner(() => {
    throw new Error('spawn xcrun ENOENT');
  });
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('broken-runner'),
    run,
  });
  assert.equal(await provider.permission(), 'unknown');
});

test('permission falls back to a screencapture probe without swiftc', async () => {
  const probeRoot = testDirectory('probe-root');

  const granted = recordingRunner((call) => {
    if (call.command === 'xcrun') return { code: 127, stderr: 'xcrun: error: unable to find utility' };
    writeFileSync(call.args[call.args.length - 1]!, new Uint8Array(4096));
    return { code: 0 };
  });
  const grantedProvider = createNativeCaptureProvider({
    helperDirectory: testDirectory('probe-granted'),
    run: granted.run,
  });
  await withTemporaryRoot(probeRoot, async () => {
    assert.equal(await grantedProvider.permission(), 'granted');
    assert.deepEqual(readdirSync(probeRoot), [], 'the probe cleans up after itself');
  });

  const denied = recordingRunner((call) =>
    call.command === 'xcrun'
      ? { code: 127, stderr: 'xcrun: error: unable to find utility' }
      : { code: 1, stderr: 'could not create image' },
  );
  const deniedProvider = createNativeCaptureProvider({
    helperDirectory: testDirectory('probe-denied'),
    run: denied.run,
  });
  assert.equal(await deniedProvider.permission(), 'denied');

  const empty = recordingRunner((call) => {
    if (call.command === 'xcrun') return { code: 127, stderr: 'xcrun: error: unable to find utility' };
    writeFileSync(call.args[call.args.length - 1]!, new Uint8Array(16));
    return { code: 0 };
  });
  const emptyProvider = createNativeCaptureProvider({
    helperDirectory: testDirectory('probe-empty'),
    run: empty.run,
  });
  assert.equal(await emptyProvider.permission(), 'denied', 'a tiny file is not a real screenshot');
});

test('capture returns the JPEG bytes, dimensions, and removes the frame file', async () => {
  const frameRoot = testDirectory('capture-root');
  const capturedAt = 1_700_000_000_000;
  const { calls, run } = recordingRunner((call) => {
    if (call.command === 'xcrun') return { code: 127, stderr: 'xcrun: error: unable to find utility' };
    writeFileSync(call.args[call.args.length - 1]!, JPEG);
    return { code: 0 };
  });
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('capture-helper'),
    run,
    now: () => capturedAt,
  });

  await withTemporaryRoot(frameRoot, async () => {
    const frame = await provider.capture();
    assert.equal(frame.width, 3);
    assert.equal(frame.height, 2);
    assert.equal(frame.capturedAt, capturedAt);
    assert.equal(frame.app, undefined, 'no helper means no app metadata');
    assert.equal(frame.idleSeconds, undefined);
    assert.equal(frame.jpeg.byteLength, JPEG.byteLength);
    assert.deepEqual(new Uint8Array(frame.jpeg), JPEG);
    assert.deepEqual(readdirSync(frameRoot), [], 'the temporary frame directory is gone');
  });

  const screencaptureCall = calls.find((call) => call.command !== 'xcrun');
  assert.deepEqual(screencaptureCall?.args.slice(0, 3), ['-x', '-t', 'jpg']);
});

test('capture raises CaptureError and cleans up when screencapture fails', async () => {
  const frameRoot = testDirectory('capture-failure-root');
  const { run } = recordingRunner((call) =>
    call.command === 'xcrun'
      ? { code: 127, stderr: 'xcrun: error: unable to find utility' }
      : { code: 1, stderr: 'could not create image from display' },
  );
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('capture-failure-helper'),
    run,
  });

  await withTemporaryRoot(frameRoot, async () => {
    await assert.rejects(provider.capture(), (error: unknown) => {
      assert.ok(error instanceof CaptureError);
      assert.equal(error.code, 'capture_failed');
      assert.match(error.message, /could not create image from display/);
      return true;
    });
    assert.deepEqual(readdirSync(frameRoot), []);
  });
});

test('capture maps a screen-recording denial to permission_denied', async () => {
  const frameRoot = testDirectory('capture-denied-root');
  const { run } = recordingRunner((call) =>
    call.command === 'xcrun'
      ? { code: 127, stderr: 'xcrun: error: unable to find utility' }
      : { code: 1, stderr: 'The user has not granted screen recording permission.' },
  );
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('capture-denied-helper'),
    run,
  });

  await withTemporaryRoot(frameRoot, async () => {
    await assert.rejects(provider.capture(), (error: unknown) => {
      assert.ok(error instanceof CaptureError);
      assert.equal(error.code, 'permission_denied');
      return true;
    });
  });
});

test('capture adds app and idle metadata from the helper', async () => {
  const frameRoot = testDirectory('capture-meta-root');
  const meta = JSON.stringify({
    app: { bundleId: 'com.apple.Safari', name: 'Safari' },
    windowTitle: 'Example — Safari',
    idleSeconds: 12,
  });
  const { run } = recordingRunner((call) => {
    if (call.command === 'xcrun') return buildsHelper(call);
    if (call.args[0] === 'meta') return { code: 0, stdout: meta };
    if (call.args[0] === 'preflight') return { code: 0, stdout: 'granted\n' };
    writeFileSync(call.args[call.args.length - 1]!, JPEG);
    return { code: 0 };
  });
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('capture-meta-helper'),
    run,
  });

  await withTemporaryRoot(frameRoot, async () => {
    const frame = await provider.capture();
    assert.deepEqual(frame.app, {
      bundleId: 'com.apple.Safari',
      name: 'Safari',
      windowTitle: 'Example — Safari',
    });
    assert.equal(frame.idleSeconds, 12);
    assert.deepEqual(readdirSync(frameRoot), []);
  });
});

test('jpegDimensions reads every supported SOF marker and tolerates junk', () => {
  assert.deepEqual(jpegDimensions(JPEG), { width: 3, height: 2 });

  for (const marker of [0xc0, 0xc1, 0xc2, 0xc9, 0xca]) {
    const label = `SOF marker 0x${marker.toString(16)}`;
    assert.deepEqual(jpegDimensions(frameHeader(marker, 1280, 720)), { width: 1280, height: 720 }, label);
    assert.deepEqual(jpegDimensions(frameHeader(marker, 4096, 2304)), { width: 4096, height: 2304 }, label);
  }

  const withoutFrame = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
  assert.deepEqual(jpegDimensions(withoutFrame), { width: 0, height: 0 });
  assert.deepEqual(jpegDimensions(Uint8Array.from([0xff, 0xd8])), { width: 0, height: 0 });
  assert.deepEqual(jpegDimensions(Uint8Array.from([0x00, 0x01, 0x02, 0x03])), { width: 0, height: 0 });
  assert.deepEqual(jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00])), { width: 0, height: 0 });
  assert.deepEqual(
    jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x00, 0xff, 0xd9])),
    { width: 0, height: 0 },
    'a frame header too short to hold dimensions is ignored',
  );
  assert.deepEqual(
    jpegDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00])),
    { width: 0, height: 0 },
    'a segment whose length runs past the buffer stops the walk',
  );
});

test('parseHelperMeta reads what it can and never throws on bad output', () => {
  assert.deepEqual(
    parseHelperMeta(
      JSON.stringify({
        app: { bundleId: 'com.apple.Safari', name: 'Safari' },
        windowTitle: 'Example — Safari',
        idleSeconds: 42,
      }),
    ),
    {
      app: { bundleId: 'com.apple.Safari', name: 'Safari', windowTitle: 'Example — Safari' },
      idleSeconds: 42,
    },
  );
  assert.deepEqual(parseHelperMeta('{"app":null}'), {});
  assert.deepEqual(parseHelperMeta('{"windowTitle":"Solo"}'), { app: { windowTitle: 'Solo' } });
  assert.deepEqual(parseHelperMeta('{"app":{"bundleId":"","name":""}}'), {});
  assert.deepEqual(parseHelperMeta('{"app":{},"idleSeconds":-1}'), {});
  assert.deepEqual(parseHelperMeta('not json'), {});
  assert.deepEqual(parseHelperMeta('[1,2,3]'), {});
  assert.deepEqual(parseHelperMeta(''), {});
});

test('concurrent permission and capture share one helper compilation', async () => {
  const frameRoot = testDirectory('concurrent-root');
  let compiles = 0;
  const { run } = recordingRunner((call) => {
    if (call.command === 'xcrun') {
      compiles += 1;
      return buildsHelper(call);
    }
    if (call.args[0] === 'preflight') return { code: 0, stdout: 'granted\n' };
    if (call.args[0] === 'meta') return { code: 0, stdout: '{"app":null}' };
    writeFileSync(call.args[call.args.length - 1]!, JPEG);
    return { code: 0 };
  });
  const provider = createNativeCaptureProvider({
    helperDirectory: testDirectory('concurrent-helper'),
    run,
  });

  await withTemporaryRoot(frameRoot, async () => {
    const [permission, frame] = await Promise.all([provider.permission(), provider.capture()]);
    assert.equal(permission, 'granted');
    assert.equal(frame.width, 3);
    assert.equal(frame.height, 2);
  });
  assert.equal(compiles, 1, 'one compilation is shared by both callers');
});
