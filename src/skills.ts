/**
 * The bundled skills: Dayflow, onboarding, standup, weekly review, review
 * queue, long task, memory, and reflection.
 *
 * Skills live as Markdown files beside the package (`skills/<name>/SKILL.md`),
 * the same layout Dayflow ships, so they can be edited and reviewed as prose.
 * They are registered at runtime instead of copied into a skills root, so
 * installing the plugin is enough to make them available.
 * @module dsh-plugin-dayflow/skills
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-skill';

/** One parsed skill definition. */
export interface SkillDocument {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly content: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** The public skill-name grammar: kebab-case. Kept local to avoid a runtime dependency. */
export function isSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a `SKILL.md` document into its frontmatter fields and body.
 * @param text - the file contents.
 * @param fallbackName - the name to use when frontmatter omits one.
 * @returns the parsed skill.
 */
export function parseSkillDocument(text: string, fallbackName: string): SkillDocument {
  const match = FRONTMATTER_PATTERN.exec(text);
  if (match === null) {
    return { name: fallbackName, description: '', content: text.trim() };
  }

  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (key !== '' && value !== '') fields.set(key, value);
  }

  const name = fields.get('name') ?? fallbackName;
  if (!isSkillName(name)) {
    throw new Error(`Skill "${name}" in ${fallbackName}/SKILL.md is not kebab-case.`);
  }
  const description = fields.get('description') ?? '';
  if (description === '') {
    throw new Error(`Skill "${name}" in ${fallbackName}/SKILL.md has no description.`);
  }
  const whenToUse = fields.get('whenToUse');
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    content: text.slice(match[0].length).trim(),
  };
}

/**
 * Load every `skills/<dir>/SKILL.md` under a directory.
 * @param directory - the package's `skills` root.
 * @returns the parsed skills, sorted by name for deterministic registration.
 */
export function loadSkills(directory: string): SkillDocument[] {
  if (!existsSync(directory)) return [];
  const skills: SkillDocument[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name, 'SKILL.md');
    if (!existsSync(path)) continue;
    skills.push(parseSkillDocument(readFileSync(path, 'utf8'), entry.name));
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Register the bundled skills with the harness.
 * @param ctx - the plugin context, with `skills` injected.
 * @param directory - the package's `skills` root.
 */
export function registerSkills(ctx: Context, directory: string): void {
  for (const skill of loadSkills(directory)) {
    ctx.skills.register({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      content: skill.content,
      source: 'bundled',
    });
  }
}
