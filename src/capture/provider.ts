/**
 * Screen capture provider for the native port.
 *
 * Frames come from a small Swift helper that is embedded below as source text
 * and compiled lazily with `xcrun swiftc` into `os.tmpdir()` on first use. The
 * helper captures the screen with `CGWindowListCreateImage`, writes the JPEG,
 * and reports the frame's 9x8 grayscale dHash, the frontmost app, the focused
 * window title, idle seconds, and whether the screen is locked or the display
 * asleep. Everything the capture engine needs to dedupe and to skip frames
 * arrives in one call.
 *
 * When the Swift toolchain is missing or the helper cannot capture (a locked
 * screen, a sleeping display, a denied permission), the provider falls back to
 * `/usr/sbin/screencapture -x -t jpg`. That path needs no helper and no
 * Accessibility permission, but it cannot produce a hash or a state: the frame
 * then simply has no `hash` field. `permission()` likewise falls back to a
 * probe with `screencapture` itself.
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
import { release, tmpdir } from 'node:os';
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
  /** The JPEG bytes the helper or `screencapture` wrote. */
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
  /** 64-bit dHash as 16 lowercase hex chars; absent when only screencapture ran. */
  hash?: string;
}

/** What the helper reports about the screen before any frame is taken. */
export interface CaptureProviderState {
  /** The screen is locked or the GUI session is no longer on the console. */
  locked: boolean;
  /** The main display is asleep. */
  displayAsleep: boolean;
  /** Seconds since the last keyboard or mouse event, when the helper reports it. */
  idleSeconds?: number;
  /** Frontmost app metadata, when the helper reports it. */
  app?: CaptureAppInfo;
}

/** The seam the capture engine codes against; tests substitute a fake. */
export interface CaptureProvider {
  readonly name: string;
  permission(): Promise<CapturePermission>;
  capture(): Promise<CaptureFrame>;
  /** Current lock and display state, when the provider can report it cheaply. */
  state?(): Promise<CaptureProviderState>;
  dispose?(): void | Promise<void>;
}

/** The native provider, with the extra probes the local smoke script prints. */
export interface NativeCaptureProvider extends CaptureProvider {
  /** Whether the embedded Swift helper compiled and can be executed. */
  helperAvailable(): Promise<boolean>;
  /** The native provider always reports a state; it degrades to "unknown". */
  state(): Promise<CaptureProviderState>;
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

/** The dHash samples 9 columns by 8 rows of grayscale. */
const DHASH_COLUMNS = 9;

/** Eight rows of eight comparisons make the 64 bits of a dHash. */
const DHASH_ROWS = 8;

/** Marks OS releases whose SDK obsoletes `CGWindowListCreateImage` at compile time. */
const FIRST_DARWIN_WITH_OBSOLETE_WINDOW_IMAGE = 24;

/** Deployment target pinned for the helper when the current SDK forbids that call. */
const HELPER_DEPLOYMENT_TARGET = 'macosx14.0';

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
 * Compute the 9x8 grayscale dHash the helper reports, as the reference contract.
 *
 * The Swift helper implements the same comparison on a downscaled capture: the
 * gray samples are laid out row by row (9 per row, 8 rows), every row compares
 * neighbouring samples left to right, and a set bit means the left sample is
 * brighter than the one beside it. The first comparison of the first row is the
 * most significant bit. This function exists so the bit order and the hex
 * formatting are pinned by tests; the provider itself takes the hash from the
 * helper rather than decoding JPEG bytes.
 * @param gray - exactly 72 grayscale samples, 9 per row and 8 rows.
 * @returns the 64-bit hash as 16 lowercase hex characters.
 * @throws RangeError when `gray` does not hold exactly 72 samples.
 */
export function dhashFromGray9x8(gray: Uint8Array): string {
  const samples = DHASH_COLUMNS * DHASH_ROWS;
  if (gray.length !== samples) {
    throw new RangeError(`a 9x8 dHash needs ${samples} gray samples, got ${gray.length}`);
  }
  let bits = 0n;
  for (let row = 0; row < DHASH_ROWS; row += 1) {
    const base = row * DHASH_COLUMNS;
    for (let column = 0; column < DHASH_COLUMNS - 1; column += 1) {
      bits = (bits << 1n) | (gray[base + column]! > gray[base + column + 1]! ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/**
 * The deployment target for the helper, or undefined to use the compiler default.
 *
 * `CGWindowListCreateImage` is obsoleted in the macOS 15 SDK, which turns a
 * plain `swiftc` call on a modern Mac into a compile error even though the
 * symbol still works at runtime. Pinning the helper's deployment target to
 * macOS 14 keeps the call legal; a ScreenCaptureKit replacement is a later port.
 * Older machines compile with their own default target, where the API is only
 * deprecated and still accepted.
 * @returns a `swiftc -target` value, or undefined on older macOS.
 */
function helperCompileTarget(): string | undefined {
  const darwinMajor = Number.parseInt(release().split('.')[0] ?? '', 10);
  if (!Number.isFinite(darwinMajor) || darwinMajor < FIRST_DARWIN_WITH_OBSOLETE_WINDOW_IMAGE) {
    return undefined;
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  return `${arch}-apple-${HELPER_DEPLOYMENT_TARGET}`;
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

/** One parsed `capture` object from the helper. */
interface HelperCapture extends HelperMeta {
  width?: number;
  height?: number;
  hash?: string;
}

/** Whether a value is a JSON object we can read by key. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse one JSON object from helper output, tolerating anything malformed. */
function parseJsonObject(stdout: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  return isRecord(value) ? value : undefined;
}

/**
 * Read the app, window title, and idle fields out of one helper object.
 *
 * A window title only appears when Screen Recording is allowed, and the
 * frontmost app can be unavailable on a locked or sleeping screen, so every
 * field is optional. A malformed value is dropped, never thrown: the caller
 * still has a usable frame or a usable default.
 * @param value - one parsed helper JSON object.
 * @returns whatever app and idle fields could be read.
 */
function metaFromRecord(value: Record<string, unknown>): HelperMeta {
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
 * Parse the helper's `meta` output, tolerating anything malformed.
 *
 * Bad JSON yields an empty object rather than throwing: the frame is still
 * usable without metadata.
 * @param stdout - the helper's standard output.
 * @returns whatever app and idle fields could be read.
 */
export function parseHelperMeta(stdout: string): HelperMeta {
  const value = parseJsonObject(stdout);
  return value ? metaFromRecord(value) : {};
}

/**
 * Parse the helper's `state` output, tolerating anything malformed.
 *
 * A missing or unreadable report means "nothing known", and the defaults say
 * the screen is usable: the capture engine treats every skip as a deliberate
 * action, so a broken helper must not silently stop capture.
 * @param stdout - the helper's standard output.
 * @returns the lock and display state, defaulting to unlocked and awake.
 */
function parseHelperState(stdout: string): CaptureProviderState {
  const state: CaptureProviderState = { locked: false, displayAsleep: false };
  const value = parseJsonObject(stdout);
  if (!value) return state;
  const meta = metaFromRecord(value);
  if (meta.app) state.app = meta.app;
  if (meta.idleSeconds !== undefined) state.idleSeconds = meta.idleSeconds;
  state.locked = value.locked === true;
  state.displayAsleep = value.displayAsleep === true;
  return state;
}

/**
 * Parse the helper's `capture` output, tolerating anything malformed.
 *
 * The frame itself is the primary product, so an unreadable report yields an
 * empty object and the caller keeps the JPEG without metadata. A hash is only
 * accepted when it is exactly 16 hex characters, the contract the dedupe gate
 * relies on.
 * @param stdout - the helper's standard output.
 * @returns whatever frame metadata and hash could be read.
 */
function parseHelperCapture(stdout: string): HelperCapture {
  const capture: HelperCapture = {};
  const value = parseJsonObject(stdout);
  if (!value) return capture;
  const meta = metaFromRecord(value);
  if (meta.app) capture.app = meta.app;
  if (meta.idleSeconds !== undefined) capture.idleSeconds = meta.idleSeconds;

  const width = value.width;
  if (typeof width === 'number' && Number.isInteger(width) && width > 0) capture.width = width;
  const height = value.height;
  if (typeof height === 'number' && Number.isInteger(height) && height > 0) capture.height = height;

  const hash = value.hash;
  if (typeof hash === 'string' && /^[0-9a-f]{16}$/i.test(hash)) capture.hash = hash.toLowerCase();
  return capture;
}

/**
 * The Swift helper, embedded so the plugin ships one self-contained file.
 *
 * Modes. `preflight` prints `granted` or `denied` from
 * `CGPreflightScreenCaptureAccess()` and exits 0 or 1. `meta` prints one JSON
 * object: the frontmost application (`NSWorkspace`), the focused window title
 * from `CGWindowListCopyWindowInfo` (absent without the permission, which is
 * expected and not an error), and idle seconds from
 * `CGEventSourceSecondsSinceLastEventType`. `state` prints the same metadata
 * plus `locked` (from `CGSessionCopyCurrentDictionary`) and `displayAsleep`
 * (from `CGDisplayIsAsleep`), without capturing. `capture <path>` writes one
 * JPEG of the on-screen content, computes its 9x8 grayscale dHash, and prints
 * the frame size and hash with the same metadata; it exits non-zero when the
 * screen cannot be read, which is the provider's cue to fall back.
 */
const HELPER_SOURCE = String.raw`// Dayflow capture helper: screen permission, metadata, screen state, and frames.
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

/// Report a failure on stderr and exit with a stable status code.
func fail(_ message: String, status: Int32) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(status)
}

/// The frontmost application as a JSON field, or a literal null app.
func appParts() -> [String] {
    guard let app = NSWorkspace.shared.frontmostApplication else { return ["\"app\":null"] }
    var fields: [String] = []
    if let bundle = app.bundleIdentifier, !bundle.isEmpty {
        fields.append("\"bundleId\":\"\(jsonEscaped(bundle))\"")
    }
    if let name = app.localizedName, !name.isEmpty {
        fields.append("\"name\":\"\(jsonEscaped(name))\"")
    }
    return ["\"app\":{" + fields.joined(separator: ",") + "}"]
}

/// The focused window title, when the system exposes it.
func windowTitlePart() -> String? {
    guard let front = NSWorkspace.shared.frontmostApplication else { return nil }
    // kCGWindowName is present only while Screen Recording is allowed; a
    // missing title is expected and must not fail the call.
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    let frontPid = front.processIdentifier
    let frontName = front.localizedName
    for window in windows {
        let ownerPid = (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value
        let ownerName = window[kCGWindowOwnerName as String] as? String
        let sameProcess = ownerPid != nil && ownerPid! == frontPid
        let sameOwner = frontName != nil && ownerName == frontName
        if !sameProcess && !sameOwner { continue }
        if let layer = window[kCGWindowLayer as String] as? NSNumber, layer.intValue != 0 { continue }
        if let name = window[kCGWindowName as String] as? String, !name.isEmpty {
            return "\"windowTitle\":\"\(jsonEscaped(name))\""
        }
    }
    return nil
}

/// Seconds since the last keyboard or mouse event, when the system reports it.
func idleSecondsPart() -> String? {
    guard let anyInput = CGEventType(rawValue: UInt32.max) else { return nil }
    let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    guard idle.isFinite && idle >= 0 else { return nil }
    return "\"idleSeconds\":\(Int(idle.rounded()))"
}

/// Whether the GUI session is locked, logged out, or off the console.
func sessionIsLocked() -> Bool {
    guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    // Both keys describe a live console session; when they are missing the
    // session dictionary itself is already the best answer we have.
    let onConsole = info["kCGSSessionOnConsoleKey"] as? Bool ?? true
    let loginDone = info["kCGSessionLoginDoneKey"] as? Bool ?? true
    let screenLocked = info["CGSSessionScreenIsLocked"] as? Bool ?? false
    return screenLocked || !onConsole || !loginDone
}

/// Whether the main display is asleep.
func mainDisplayAsleep() -> Bool {
    return CGDisplayIsAsleep(CGMainDisplayID()) != 0
}

/// The 9x8 grayscale dHash of an image, as 16 lowercase hex chars.
///
/// The image is drawn into a 9x8 gray buffer and each row is compared left to
/// right: a set bit means the left sample is brighter than the one beside it.
/// Rows run top to bottom and each row's comparisons run left to right, so the
/// first comparison is the most significant bit.
func dhashHex(_ image: CGImage) -> String? {
    let columns = 9
    let rows = 8
    // 16 bytes per row keeps the buffer naturally aligned for Core Graphics.
    let bytesPerRow = 16
    var pixels = [UInt8](repeating: 0, count: bytesPerRow * rows)
    let drawn = pixels.withUnsafeMutableBytes { (buffer: UnsafeMutableRawBufferPointer) -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress,
            width: columns,
            height: rows,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return false }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: CGFloat(columns), height: CGFloat(rows)))
        return true
    }
    guard drawn else { return nil }

    var bits: UInt64 = 0
    for row in 0..<rows {
        let base = row * bytesPerRow
        for column in 0..<(columns - 1) {
            bits <<= 1
            if pixels[base + column] > pixels[base + column + 1] {
                bits |= 1
            }
        }
    }
    let hex = String(bits, radix: 16)
    return String(repeating: "0", count: 16 - hex.count) + hex
}

/// The metadata every mode reports: app, window title, and idle seconds.
func metadataParts() -> [String] {
    var parts = appParts()
    if let title = windowTitlePart() { parts.append(title) }
    if let idle = idleSecondsPart() { parts.append(idle) }
    return parts
}

/// Print "granted" or "denied" and exit 0 / 1.
func emitPreflight() -> Never {
    let granted = CGPreflightScreenCaptureAccess()
    print(granted ? "granted" : "denied")
    exit(granted ? 0 : 1)
}

/// Print one JSON object with the frontmost app and idle seconds.
func emitMeta() -> Never {
    print("{" + metadataParts().joined(separator: ",") + "}")
    exit(0)
}

/// Print the lock and display state without capturing a frame.
func emitState() -> Never {
    var parts = metadataParts()
    parts.append("\"locked\":\(sessionIsLocked())")
    parts.append("\"displayAsleep\":\(mainDisplayAsleep())")
    print("{" + parts.joined(separator: ",") + "}")
    exit(0)
}

/// Capture a frame, write it as JPEG, and print its hash and metadata.
///
/// CGWindowListCreateImage was obsoleted in the macOS 15 SDK, which is why the
/// plugin compiles the helper with a pinned deployment target; it still works
/// at runtime. A nil image (locked screen, sleeping display, missing permission)
/// exits non-zero so the plugin can fall back to screencapture.
func emitCapture(_ path: String) -> Never {
    guard let image = CGWindowListCreateImage(
        CGRect.null,
        .optionOnScreenOnly,
        kCGNullWindowID,
        .bestResolution
    ) else {
        fail("CGWindowListCreateImage returned no image", status: 3)
    }
    let bitmap = NSBitmapImageRep(cgImage: image)
    guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
        fail("could not encode the captured frame as JPEG", status: 5)
    }
    do {
        try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
        fail("could not write the captured frame: \(error.localizedDescription)", status: 6)
    }
    guard let hash = dhashHex(image) else {
        fail("could not hash the captured frame", status: 7)
    }

    var parts = metadataParts()
    parts.append("\"width\":\(image.width)")
    parts.append("\"height\":\(image.height)")
    parts.append("\"hash\":\"\(hash)\"")
    parts.append("\"locked\":\(sessionIsLocked())")
    parts.append("\"displayAsleep\":\(mainDisplayAsleep())")
    print("{" + parts.joined(separator: ",") + "}")
    exit(0)
}

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "meta"
switch mode {
case "preflight":
    emitPreflight()
case "meta":
    emitMeta()
case "state":
    emitState()
case "capture":
    guard CommandLine.arguments.count > 2 else {
        fail("usage: <helper> capture <output.jpg>", status: 2)
    }
    emitCapture(CommandLine.arguments[2])
default:
    FileHandle.standardError.write("usage: <helper> preflight|meta|state|capture <output.jpg>\n".data(using: .utf8)!)
    exit(2)
}
`;

/**
 * Create the native capture provider.
 *
 * The provider is stateless between calls except for one memoised helper
 * compilation, so `permission()`, `capture()`, and `state()` may be called
 * concurrently: whichever call arrives first starts the compile and the others
 * await the same promise.
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
   * compiled from the same source by an earlier run is reused as-is. The
   * source digest names the binary, so editing the embedded helper replaces it
   * on the next call; the compile flags are pinned alongside the source because
   * they are part of the same contract.
   */
  async function compileHelper(): Promise<boolean> {
    try {
      await mkdir(helperDirectory, { recursive: true, mode: 0o700 });
      const target = helperPath();
      if (existsSync(target)) return true;

      const sourcePath = join(helperDirectory, `helper-${randomSuffix()}.swift`);
      const builtPath = `${sourcePath}.bin`;
      const args = ['swiftc', '-O'];
      const compileTarget = helperCompileTarget();
      if (compileTarget !== undefined) args.push('-target', compileTarget);
      args.push('-o', builtPath, sourcePath);
      try {
        await writeFile(sourcePath, HELPER_SOURCE, { mode: PRIVATE_FILE_MODE });
        const compiled = await run('xcrun', args, {
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

  /**
   * Capture one frame through the helper, when it can.
   *
   * A helper that is missing, exits non-zero, or writes an unreadable frame
   * resolves to undefined so the caller can fall back to `screencapture`. A
   * helper that exits 0 but prints a malformed report still yields its frame,
   * just without metadata: the pixels are the product, the report is extra.
   * @param path - the private frame file to write.
   * @returns the finished frame, or undefined to fall back.
   */
  async function captureWithHelper(path: string): Promise<CaptureFrame | undefined> {
    try {
      if (!(await ensureHelper())) return undefined;
      await writeFile(path, new Uint8Array(0), { mode: PRIVATE_FILE_MODE });
      const result = await run(helperPath(), ['capture', path], { timeoutMs });
      if (result.code !== 0) return undefined;
      // Stamp the frame once it is on disk, before the (cheap) local read.
      const capturedAt = now();
      await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
      const jpeg = await readFile(path);
      if (jpeg.byteLength === 0) return undefined;

      const parsed = parseHelperCapture(result.stdout);
      const size = jpegDimensions(jpeg);
      const frame: CaptureFrame = {
        jpeg,
        width: size.width > 0 ? size.width : (parsed.width ?? 0),
        height: size.height > 0 ? size.height : (parsed.height ?? 0),
        capturedAt,
      };
      if (parsed.app) frame.app = parsed.app;
      if (parsed.idleSeconds !== undefined) frame.idleSeconds = parsed.idleSeconds;
      if (parsed.hash !== undefined) frame.hash = parsed.hash;
      return frame;
    } catch {
      // Any helper failure degrades to the plain screenshot path below.
      return undefined;
    }
  }

  /**
   * Capture one frame with `/usr/sbin/screencapture`, the dependency-free path.
   *
   * The CLI cannot compute a hash, so the returned frame has none; metadata is
   * looked up through the helper concurrently, which is usually already
   * compiled by the time this fallback runs.
   * @param path - the private frame file to write.
   * @returns the finished frame.
   * @throws CaptureError when the CLI fails or writes an empty frame.
   */
  async function captureWithScreencapture(path: string): Promise<CaptureFrame> {
    // Start the metadata lookup first: it may still hold a compiled helper.
    const metaPromise = readMeta();
    // Pre-create the frame file private; a 0700 directory already keeps it
    // out of other users' reach, and the chmod below restores the mode if
    // screencapture replaces the inode.
    await writeFile(path, new Uint8Array(0), { mode: PRIVATE_FILE_MODE });
    const result = await run(screencapturePath, ['-x', '-t', 'jpg', path], { timeoutMs });
    if (result.code !== 0) {
      const detail = result.stderr.trim() || `exit code ${result.code}`;
      throw new CaptureError(`screencapture failed: ${detail}`, captureFailureCode(result.stderr));
    }
    // Stamp the frame after the capture completed, before the helper lookup.
    const capturedAt = now();
    await chmod(path, PRIVATE_FILE_MODE).catch(() => undefined);
    const jpeg = await readFile(path);
    if (jpeg.byteLength === 0) {
      throw new CaptureError('screencapture wrote an empty frame', 'capture_failed');
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
  }

  /** Ask the helper for the current lock and display state. */
  async function readHelperState(): Promise<CaptureProviderState> {
    const fallback: CaptureProviderState = { locked: false, displayAsleep: false };
    if (!isMac) return fallback;
    try {
      if (!(await ensureHelper())) return fallback;
      const result = await run(helperPath(), ['state'], { timeoutMs });
      if (result.code !== 0) return fallback;
      return parseHelperState(result.stdout);
    } catch {
      return fallback;
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

      const directory = await mkdtemp(join(tmpdir(), 'dayflow-capture-frame-'));
      const path = join(directory, `frame-${randomSuffix()}.jpg`);
      try {
        const fromHelper = await captureWithHelper(path);
        if (fromHelper) return fromHelper;
        return await captureWithScreencapture(path);
      } finally {
        // The frame leaves the disk before capture() resolves, on every path.
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async state(): Promise<CaptureProviderState> {
      return readHelperState();
    },
  };
}
