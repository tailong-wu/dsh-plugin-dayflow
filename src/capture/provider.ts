/**
 * Screen capture provider for the native port.
 *
 * Phase 0 proves that the plugin can capture this Mac's screen from inside the
 * host process without the Dayflow app. Frames come from `/usr/sbin/screencapture
 * -x -t jpg`, which needs no helper and no Accessibility permission. The richer
 * metadata (frontmost app, window title, idle seconds) comes from a small Swift
 * helper that is embedded below as source text and compiled lazily with
 * `xcrun swiftc` into `os.tmpdir()` on first use. When that toolchain is missing
 * the provider still captures frames: `permission()` falls back to a probe with
 * `screencapture` itself and `capture()` simply omits the app and idle fields.
 *
 * Nothing here writes to the journal or to the repository. A captured frame
 * lives in a private temporary directory that is removed in a `finally` block,
 * before `capture()` resolves.
 * @module dsh-plugin-dayflow/capture/provider
 */

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What the system reports about the Screen Recording permission. */
export type CapturePermission = 'granted' | 'denied' | 'unknown';

/** The application that was in front when a frame was taken. */
export interface CaptureAppInfo {
  /** The frontmost application's bundle identifier, when known. */
  bundleId?: string;
  /** The frontmost application's display name, when known. */
  name?: string;
  /** The focused window's title; empty without Screen Recording permission. */
  windowTitle?: string;
}

/** One captured screen frame plus whatever metadata was available. */
export interface CaptureFrame {
  /** The JPEG bytes exactly as `screencapture` wrote them. */
  jpeg: Uint8Array;
  /** Pixel width read from the JPEG frame header, or 0 when unreadable. */
  width: number;
  /** Pixel height read from the JPEG frame header, or 0 when unreadable. */
  height: number;
  /** Epoch milliseconds when the frame was captured. */
  capturedAt: number;
  /** Frontmost app metadata, omitted when the helper is unavailable. */
  app?: CaptureAppInfo;
  /** Seconds since the last keyboard or mouse event, when the helper reports it. */
  idleSeconds?: number;
}

/** The seam the capture engine codes against; tests substitute a fake. */
export interface CaptureProvider {
  readonly name: string;
  permission(): Promise<CapturePermission>;
  capture(): Promise<CaptureFrame>;
  dispose?(): void | Promise<void>;
}

/** The native provider, with the extra probe the local smoke script prints. */
export interface NativeCaptureProvider extends CaptureProvider {
  /** Whether the embedded Swift helper compiled and can be executed. */
  helperAvailable(): Promise<boolean>;
}

/** Runs one child process and resolves with its exit status and output. */
export type CaptureCommandRunner = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Options for {@link createNativeCaptureProvider}; every field has a default. */
export interface CaptureProviderOptions {
  /** Override the CLI path; defaults to `/usr/sbin/screencapture`. */
  screencapturePath?: string;
  /** Where the lazily compiled helper lands; defaults to `<os.tmpdir()>/dayflow-capture`. */
  helperDirectory?: string;
  /** Injectable command runner, mainly for tests; defaults to `child_process.execFile`. */
  run?: CaptureCommandRunner;
  /** Injectable clock, mainly for tests; defaults to `Date.now`. */
  now?: () => number;
  /** How long one `screencapture` or helper call may take. */
  timeoutMs?: number;
}

/** Stable failure codes for capture, kept apart from `DayflowError`. */
export type CaptureErrorCode = 'permission_denied' | 'capture_failed' | 'helper_unavailable';

/** A capture failure a caller can branch on without matching message text. */
export class CaptureError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: CaptureErrorCode;

  constructor(message: string, code: CaptureErrorCode, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    this.name = 'CaptureError';
    this.code = code;
  }
}

/** The provider name reported on frames and by the smoke script. */
const PROVIDER_NAME = 'native-screencapture';

/** Where macOS keeps the capture CLI. */
const DEFAULT_SCREENCAPTURE_PATH = '/usr/sbin/screencapture';

/** One capture or probe call; generous because a 6K screen takes a moment. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** `swiftc -O` on the small helper takes a couple of seconds; leave headroom. */
const COMPILE_TIMEOUT_MS = 120_000;

/** A frame smaller than this cannot be a real screenshot, so the probe says denied. */
const MIN_PROBE_BYTES = 1024;

/** Mode for files only this user may read: the Swift source and the captured frame. */
const PRIVATE_FILE_MODE = 0o600;

/** Mode for the compiled helper. */
const HELPER_FILE_MODE = 0o700;

/** Markers that begin a JPEG frame header: SOF0/1/2/9/10. */
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc9, 0xca]);

/** SOI and EOI, plus the restart markers, carry no length field. */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Read a JPEG's pixel size from its first frame header.
 *
 * The parser walks the marker segments without decoding the image, so it works
 * on a full-resolution screenshot as cheaply as on a thumbnail: it skips every
 * segment that is not a start-of-frame marker and returns the dimensions of the
 * first one it meets (SOF0, SOF1, SOF2, SOF9, or SOF10). A truncated, malformed,
 * or header-less buffer yields `{ width: 0, height: 0 }` instead of throwing,
 * because a broken dimension must not lose an otherwise valid frame.
 * @param jpeg - the JPEG bytes, from `screencapture` or a test fixture.
 * @returns the width and height in pixels, or zeros when no frame header exists.
 */
export function jpegDimensions(jpeg: Uint8Array): { width: number; height: number } {
  const missing = { width: 0, height: 0 };
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return missing;

  let offset = 2;
  while (offset + 3 < jpeg.length) {
    // A marker always starts with 0xFF. Skip fill bytes between segments.
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = jpeg[offset + 1]!;
    while (marker === 0xff) {
      offset += 1;
      marker = jpeg[offset + 1]!;
    }
    offset += 2;
    if (isStandaloneMarker(marker)) continue;

    if (offset + 1 >= jpeg.length) break;
    const length = (jpeg[offset]! << 8) | jpeg[offset + 1]!;
    if (length < 2 || offset + length > jpeg.length) break;

    if (SOF_MARKERS.has(marker)) {
      // length(2) + precision(1) + height(2) + width(2).
      if (length < 7) return missing;
      const height = (jpeg[offset + 3]! << 8) | jpeg[offset + 4]!;
      const width = (jpeg[offset + 5]! << 8) | jpeg[offset + 6]!;
      return { width, height };
    }

    // Start of scan: the frame header would have appeared before it.
    if (marker === 0xda) break;
    offset += length;
  }
  return missing;
}

/**
 * Map a failed `screencapture` to a failure code.
 * @param stderr - what the CLI wrote to stderr.
 * @returns `permission_denied` when the text names a permission problem.
 */
function captureFailureCode(stderr: string): CaptureErrorCode {
  const text = stderr.toLowerCase();
  return /screen recording|not permitted|not authorized|permission|denied|declined/.test(text)
    ? 'permission_denied'
    : 'capture_failed';
}

/** Exit status for a finished `execFile`, normalising spawn errors to -1. */
function toExitCode(error: Error | null): number {
  if (!error) return 0;
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'number' ? code : -1;
}

/** The default runner: `execFile` behind a promise, never rejecting. */
const defaultRunner: CaptureCommandRunner = (command, args, { timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ code: toExitCode(error), stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });

/** A short random suffix for one-shot files. */
function randomSuffix(): string {
  return randomBytes(8).toString('hex');
}

/** One parsed `meta` object from the helper. */
interface HelperMeta {
  app?: CaptureAppInfo;
  idleSeconds?: number;
}

/** Whether a value is a JSON object we can read by key. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the helper's `meta` output, tolerating anything malformed.
 *
 * A window title only appears when Screen Recording is allowed, and the
 * frontmost app can be unavailable on a locked or sleeping screen, so every
 * field is optional. Bad JSON yields an empty object rather than throwing: the
 * frame is still usable without metadata.
 * @param stdout - the helper's standard output.
 * @returns whatever app and idle fields could be read.
 */
export function parseHelperMeta(stdout: string): HelperMeta {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return {};
  }
  if (!isRecord(value)) return {};

  const app: CaptureAppInfo = {};
  if (isRecord(value.app)) {
    const bundleId = value.app.bundleId;
    if (typeof bundleId === 'string' && bundleId !== '') app.bundleId = bundleId;
    const name = value.app.name;
    if (typeof name === 'string' && name !== '') app.name = name;
  }
  const windowTitle = value.windowTitle;
  if (typeof windowTitle === 'string' && windowTitle !== '') app.windowTitle = windowTitle;

  const meta: HelperMeta = {};
  if (Object.keys(app).length > 0) meta.app = app;
  const idle = value.idleSeconds;
  if (typeof idle === 'number' && Number.isFinite(idle) && idle >= 0) meta.idleSeconds = idle;
  return meta;
}

/**
 * The Swift helper, embedded so the plugin ships one self-contained file.
 *
 * Two modes. `preflight` prints `granted` or `denied` from
 * `CGPreflightScreenCaptureAccess()` and exits 0 or 1. `meta` prints one JSON
 * object: the frontmost application (`NSWorkspace`), the focused window title
 * from `CGWindowListCopyWindowInfo` (absent without the permission, which is
 * expected and not an error), and idle seconds from
 * `CGEventSourceSecondsSinceLastEventType`.
 */
const HELPER_SOURCE = String.raw`// Dayflow capture helper: prints the screen-recording permission or screen metadata.
// Compiled once by the plugin into its helper directory; no third-party code.
import AppKit
import CoreGraphics
import Foundation

/// Escape a string for a JSON string literal.
func jsonEscaped(_ value: String) -> String {
    var out = ""
    for scalar in value.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out
}

/// Print "granted" or "denied" and exit 0 / 1.
func emitPreflight() -> Never {
    let granted = CGPreflightScreenCaptureAccess()
    print(granted ? "granted" : "denied")
    exit(granted ? 0 : 1)
}

/// Print one JSON object with the frontmost app, its window title when the
/// system exposes it, and the seconds since the last input event.
func emitMeta() -> Never {
    let front = NSWorkspace.shared.frontmostApplication
    var parts: [String] = []

    if let app = front {
        var fields: [String] = []
        if let bundle = app.bundleIdentifier, !bundle.isEmpty {
            fields.append("\"bundleId\":\"\(jsonEscaped(bundle))\"")
        }
        if let name = app.localizedName, !name.isEmpty {
            fields.append("\"name\":\"\(jsonEscaped(name))\"")
        }
        parts.append("\"app\":{" + fields.joined(separator: ",") + "}")
    } else {
        parts.append("\"app\":null")
    }

    // kCGWindowName is present only while Screen Recording is allowed; a
    // missing title is expected and must not fail the call.
    var title: String?
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    if let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] {
        let frontPid = front?.processIdentifier ?? -1
        let frontName = front?.localizedName
        for window in windows {
            let ownerPid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
            let ownerName = window[kCGWindowOwnerName as String] as? String
            let sameProcess = ownerPid != nil && ownerPid! == frontPid
            let sameOwner = frontName != nil && ownerName == frontName
            if !sameProcess && !sameOwner { continue }
            if let layer = window[kCGWindowLayer as String] as? NSNumber, layer.intValue != 0 { continue }
            if let name = window[kCGWindowName as String] as? String, !name.isEmpty {
                title = name
                break
            }
        }
    }
    if let value = title {
        parts.append("\"windowTitle\":\"\(jsonEscaped(value))\"")
    }

    if let anyInput = CGEventType(rawValue: UInt32.max) {
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        if idle.isFinite && idle >= 0 {
            parts.append("\"idleSeconds\":\(Int(idle.rounded()))")
        }
    }

    print("{" + parts.joined(separator: ",") + "}")
    exit(0)
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "meta"
switch mode {
case "preflight":
    emitPreflight()
case "meta":
    emitMeta()
default:
    FileHandle.standardError.write("usage: <helper> preflight|meta\n".data(using: .utf8)!)
    exit(2)
}
`;

/**
 * Create the native capture provider.
 *
 * The provider is stateless between calls except for one memoised helper
 * compilation, so `permission()` and `capture()` may be called concurrently:
 * whichever call arrives first starts the compile and the others await the same
 * promise.
 * @param options - overrides for the CLI path, helper directory, runner, clock, timeout.
 * @returns the provider; on a non-macOS platform every call degrades safely.
 */
export function createNativeCaptureProvider(
  options: CaptureProviderOptions = {},
): NativeCaptureProvider {
  const screencapturePath = options.screencapturePath ?? DEFAULT_SCREENCAPTURE_PATH;
  const helperDirectory = options.helperDirectory ?? join(tmpdir(), 'dayflow-capture');
  const run = options.run ?? defaultRunner;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isMac = process.platform === 'darwin';

  /** Memoised helper compilation; `false` means the toolchain is unusable. */
  let helperPromise: Promise<boolean> | undefined;

  /** Where the helper for this exact source version lives. */
  function helperPath(): string {
    const digest = createHash('sha256').update(HELPER_SOURCE).digest('hex').slice(0, 12);
    return join(helperDirectory, `dayflow-capture-helper-${digest}`);
  }

  /**
   * Compile the helper into the helper directory, atomically.
   *
   * The output is written under a one-shot name and renamed into place, so a
   * concurrent reader can never observe a half-written executable. A helper
   * compiled from the same source by an earlier run is reused as-is.
   */
  async function compileHelper(): Promise<boolean> {
    try {
      await mkdir(helperDirectory, { recursive: true, mode: 0o700 });
      const target = helperPath();
      if (existsSync(target)) return true;

      const sourcePath = join(helperDirectory, `helper-${randomSuffix()}.swift`);
      const builtPath = `${sourcePath}.bin`;
      try {
        await writeFile(sourcePath, HELPER_SOURCE, { mode: PRIVATE_FILE_MODE });
        const compiled = await run('xcrun', ['swiftc', '-O', '-o', builtPath, sourcePath], {
          timeoutMs: Math.max(timeoutMs, COMPILE_TIMEOUT_MS),
        });
        if (compiled.code !== 0 || !existsSync(builtPath)) return false;
        await chmod(builtPath, HELPER_FILE_MODE).catch(() => undefined);
        await rename(builtPath, target);
        return true;
      } finally {
        await rm(sourcePath, { force: true }).catch(() => undefined);
        await rm(builtPath, { force: true }).catch(() => undefined);
      }
    } catch {
      return false;
    }
  }

  /** The shared compilation attempt, started on first use and kept afterwards. */
  function ensureHelper(): Promise<boolean> {
    helperPromise ??= compileHelper();
    return helperPromise;
  }

  /** Ask the helper for the Screen Recording permission. */
  async function readPreflight(): Promise<CapturePermission> {
    const result = await run(helperPath(), ['preflight'], { timeoutMs });
    const output = result.stdout.trim().toLowerCase();
    if (output.includes('granted')) return 'granted';
    if (output.includes('denied')) return 'denied';
    if (result.code === 0) return 'granted';
    if (result.code === 1) return 'denied';
    return 'unknown';
  }

  /** Probe the permission with a real screenshot, for machines without swiftc. */
  async function probeWithScreencapture(): Promise<CapturePermission> {
    const directory = await mkdtemp(join(tmpdir(), 'dayflow-capture-probe-'));
    const path = join(directory, 'probe.jpg');
    try {
      const result = await run(screencapturePath, ['-x', '-t', 'jpg', path], { timeoutMs });
      if (result.code !== 0) return 'denied';
      const written = await stat(path).then((info) => info.size).catch(() => 0);
      return written > MIN_PROBE_BYTES ? 'granted' : 'denied';
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Read `meta` from the helper; any failure degrades to "no metadata". */
  async function readMeta(): Promise<HelperMeta | undefined> {
    try {
      if (!(await ensureHelper())) return undefined;
      const result = await run(helperPath(), ['meta'], { timeoutMs });
      if (result.code !== 0) return undefined;
      return parseHelperMeta(result.stdout);
    } catch {
      return undefined;
    }
  }

  return {
    name: PROVIDER_NAME,

    async helperAvailable(): Promise<boolean> {
      return isMac ? ensureHelper() : false;
    },

    async permission(): Promise<CapturePermission> {
      if (!isMac) return 'unknown';
      try {
        if (await ensureHelper()) return await readPreflight();
      } catch {
        // A broken helper must not hide a screenshot the CLI can still take.
      }
      try {
        return await probeWithScreencapture();
      } catch {
        return 'unknown';
      }
    },

    async capture(): Promise<CaptureFrame> {
      if (!isMac) {
        throw new CaptureError(
          'Screen capture is only available on macOS',
          'capture_failed',
        );
      }

      // Start the metadata lookup first: it may have to compile the helper.
      const metaPromise = readMeta();
      const directory = await mkdtemp(join(tmpdir(), 'dayflow-capture-frame-'));
      const path = join(directory, `frame-${randomSuffix()}.jpg`);
      let jpeg: Uint8Array;
      let capturedAt: number;
      try {
        // Pre-create the frame file private; a 0700 directory already keeps it
        // out of other users' reach, and the chmod below restores the mode if
        // screencapture replaces the inode.
        await writeFile(path, new Uint8Array(0), { mode: PRIVATE_FILE_MODE });
        const result = await run(screencapturePath, ['-x', '-t', 'jpg', path], { timeoutMs });
        if (result.code !== 0) {
          const detail = result.stderr.trim() || `exit code ${result.code}`;
          throw new CaptureError(
            `screencapture failed: ${detail}`,
            captureFailureCode(result.stderr),
          );
        }
        // Stamp the frame before the (possibly slow) helper metadata lookup.
        capturedAt = now();
        await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
        jpeg = await readFile(path);
        if (jpeg.byteLength === 0) {
          throw new CaptureError('screencapture wrote an empty frame', 'capture_failed');
        }
      } finally {
        // The frame leaves the disk before capture() resolves, on every path.
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }

      const meta = await metaPromise;
      const size = jpegDimensions(jpeg);
      const frame: CaptureFrame = {
        jpeg,
        width: size.width,
        height: size.height,
        capturedAt,
      };
      if (meta?.app) frame.app = meta.app;
      if (meta?.idleSeconds !== undefined) frame.idleSeconds = meta.idleSeconds;
      return frame;
    },
  };
}
