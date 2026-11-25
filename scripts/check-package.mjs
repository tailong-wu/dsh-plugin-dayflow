#!/usr/bin/env node
// Guard the npm package shape: every required entry point is present, and no
// source, test, workspace, or build-cache path leaks into the tarball.
//
// Usage:
//   npm pack --dry-run --json > /tmp/dayflow-pack.json
//   node scripts/check-package.mjs /tmp/dayflow-pack.json
//
// `npm pack --json` may print build logs before the JSON array; the script
// finds the first line that opens the array, so the file is accepted as-is.

import { readFileSync } from 'node:fs';

/** Paths the package must contain. */
const REQUIRED = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'cordis.patch.yml',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'LICENSE',
];

/** Skills that must ship with their SKILL.md. */
const SKILLS = [
  'dayflow',
  'long-task',
  'memory',
  'onboarding',
  'reflection',
  'review-queue',
  'standup',
  'weekly-review',
];

/** Directory prefixes that must never appear in the tarball. */
const FORBIDDEN_PREFIXES = ['src/', 'tests/', '.test-build/', '.github/', 'scripts/', 'node_modules/', 'out/'];

/** File suffixes that must never appear in the tarball. */
const FORBIDDEN_SUFFIXES = ['.tgz', '.map', '.tsbuildinfo'];

/**
 * Find the first line that opens the pack JSON array.
 * @param {string} raw - the whole npm pack output.
 * @returns {string} the JSON text.
 */
function jsonSlice(raw) {
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => line.trimStart().startsWith('['));
  if (start < 0) {
    throw new Error('no JSON array in npm pack output');
  }
  return lines.slice(start).join('\n');
}

/**
 * Validate one `npm pack --json` payload.
 * @param {Array<{ files?: Array<{ path: string }>, size?: number, unpackedSize?: number }>} packs
 * @returns {string[]} problems; empty means the package is fine.
 */
export function checkPackage(packs) {
  if (!Array.isArray(packs) || packs.length !== 1) {
    return ['expected exactly one package in the npm pack output'];
  }
  const files = (packs[0].files ?? []).map((file) => file.path);
  const problems = [];
  for (const required of REQUIRED) {
    if (!files.includes(required)) problems.push(`missing required file ${required}`);
  }
  for (const skill of SKILLS) {
    const path = `skills/${skill}/SKILL.md`;
    if (!files.includes(path)) problems.push(`missing skill ${path}`);
  }
  for (const path of files) {
    if (FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      problems.push(`forbidden path ${path}`);
      continue;
    }
    if (FORBIDDEN_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
      problems.push(`forbidden file ${path}`);
      continue;
    }
    if (path.endsWith('.ts') && !path.endsWith('.d.ts')) {
      problems.push(`uncompiled TypeScript source ${path}`);
    }
  }
  return problems;
}

/**
 * Run the guard against a pack JSON file.
 * @param {string} path - path to the `npm pack --dry-run --json` output.
 */
function main(path) {
  const packs = JSON.parse(jsonSlice(readFileSync(path, 'utf8')));
  const problems = checkPackage(packs);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-package: ${problem}`);
    process.exit(1);
  }
  const p = packs[0];
  console.log(
    `check-package: ok · ${p.files.length} files · ${(p.size / 1024 / 1024).toFixed(2)} MB packed · ` +
      `${(p.unpackedSize / 1024 / 1024).toFixed(2)} MB unpacked`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/check-package.mjs <pack.json>');
    process.exit(2);
  }
  main(target);
}
