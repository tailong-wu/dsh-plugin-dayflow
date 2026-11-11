#!/usr/bin/env node
/**
 * Read the real Dayflow database on this Mac and print what the tools answer.
 *
 * This is a manual smoke test, not part of `npm test`: it needs a real Dayflow
 * install with recorded activity. Run `npm run build` first.
 *
 *   node scripts/smoke.mjs            # today, status, last 7 days
 *   node scripts/smoke.mjs 2026-10-19 # a specific day
 */
import { readPreferences } from '../lib/categories.js';
import { formatDayKey } from '../lib/day.js';
import { resolveConfig } from '../lib/config.js';
import { detectDayflow } from '../lib/setup.js';
import { readTools } from '../lib/tools/read.js';

const config = resolveConfig({
  databasePath: process.env.DAYFLOW_DB ?? '',
});
const runtime = {
  config,
  preferences: () => readPreferences(),
  presence: () => detectDayflow(config.databasePath),
};
const tools = new Map(readTools(runtime).map((tool) => [tool.name, tool]));

const signal = new AbortController().signal;

async function run(name, args = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const value = await tool.execute(args, { signal });
  const text = tool.output.render(args, value).map((block) => block.text ?? '').join('\n');
  console.log(`\n── ${name} ${JSON.stringify(args)} ──`);
  console.log(text);
}

const day = process.argv[2] ?? formatDayKey(new Date());
const today = new Date(`${day}T12:00:00`);
const weekAgo = new Date(today);
weekAgo.setDate(weekAgo.getDate() - 6);

await run('dayflow_status');
await run('dayflow_timeline', { date: day });
await run('dayflow_breakdown', { from: formatDayKey(weekAgo), to: day });
await run('dayflow_weekly', { date: day });
await run('dayflow_categories');
