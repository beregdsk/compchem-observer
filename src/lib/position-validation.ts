// Validation for positions (data/positions/), the second data type beside
// events. Spec: docs/superpowers/specs/2026-09-29-positions-design.md.
// Shares the context and helpers of validation.ts; the rules are the subset
// of the event rules that apply to a job advert.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { parse } from 'yaml';
import { compareISO } from './dates';
import { regionOf } from './regions';
import type { RawPosition } from './types';
import {
  descriptionLengthError,
  isBlocked,
  isLinklessMailingListPost,
  normaliseTitle,
  sameAsTitle,
  type EventFile,
  type ValidationContext,
  type ValidationResult,
} from './validation';

export const POSITIONS_DIR = 'data/positions';

let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    compiled = ajv.compile(JSON.parse(readFileSync('schema/position.schema.json', 'utf8')));
  }
  return compiled;
}

/** Every `<year>/<id>.yaml` under `dir`, sorted; empty when the folder does not exist yet. */
export function readPositionFiles(dir = POSITIONS_DIR): EventFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => p.endsWith('.yaml'))
    .sort()
    .map((p) => ({
      file: join(dir, p).split('\\').join('/'),
      data: parse(readFileSync(join(dir, p), 'utf8')),
    }));
}

export function validatePosition(entry: EventFile, ctx: ValidationContext): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const validate = schemaValidator();
  if (!validate(entry.data)) {
    for (const err of validate.errors ?? []) {
      const field = err.instancePath.replace(/^\//, '') || err.params?.missingProperty || '(root)';
      out.errors.push({
        file: entry.file,
        field: String(field),
        message: err.message ?? 'schema violation',
      });
    }
    return out;
  }

  const p = entry.data as RawPosition;
  const err = (field: string, message: string) =>
    out.errors.push({ file: entry.file, field, message });

  // id, file name, folder and the year of `added` agree.
  const stem = basename(entry.file, '.yaml');
  const folder = basename(dirname(entry.file));
  const year = p.added.slice(0, 4);
  if (p.id !== stem) err('id', `id "${p.id}" must equal the file name stem "${stem}"`);
  if (!p.id.endsWith(`-${year}`)) err('id', `id must end with the year of added "${year}"`);
  if (folder !== year) {
    err('added', `file must sit in the folder for the year it was added, data/positions/${year}/`);
  }

  if (compareISO(p.added, ctx.today) > 0) err('added', `added ${p.added} is in the future`);

  for (const t of p.topics) {
    if (!ctx.topics.has(t)) err('topics', `unknown topic "${t}"; add it to data/topics.yaml first`);
  }
  if (regionOf(p.location.country) === undefined) {
    err(
      'location/country',
      `country "${p.location.country}" is not in the region table; add it to src/lib/regions.ts`,
    );
  }

  for (const field of ['url', 'source_url'] as const) {
    const value = p[field];
    if (value && isBlocked(value, ctx.blockedHosts)) {
      err(field, `host of ${field} is on the blocklist in data/blocklist.yaml`);
    }
  }

  const tooLong = descriptionLengthError(p, ctx);
  if (tooLong) err('description', tooLong);
  const aliasError = sameAsTitle(p);
  if (aliasError) err('aliases', aliasError);
  if (
    !isLinklessMailingListPost(p, ctx) &&
    p.description.length > 200 &&
    !p.description.includes('.')
  ) {
    out.warnings.push({
      file: entry.file,
      field: 'description',
      message: 'description looks copied: over 200 characters with no full stop',
    });
  }
  return out;
}

/**
 * Cross-file checks. A `url` equal to its own `source_url` is the fallback
 * for a post that linked no advert (a mailing-list message, a channel post),
 * which many positions can share, so it is not a duplicate by itself;
 * title plus institution still is.
 */
export function validatePositionCollection(entries: EventFile[]): ValidationResult {
  const out: ValidationResult = { errors: [], warnings: [] };
  const byId = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const dup = (
    map: Map<string, string>,
    key: string,
    file: string,
    field: string,
    what: string,
  ) => {
    const seen = map.get(key);
    if (seen) out.errors.push({ file, field, message: `duplicate ${what}, also in ${seen}` });
    else map.set(key, file);
  };

  for (const entry of entries) {
    const p = entry.data as RawPosition;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') continue;
    dup(byId, p.id, entry.file, 'id', 'id');
    const url = p.url?.replace(/\/+$/, '');
    if (url && p.url !== p.source_url) dup(byUrl, url, entry.file, 'url', 'url');
    const key = `${normaliseTitle(p.title ?? '')}|${normaliseTitle(p.institution ?? '')}`;
    dup(byTitle, key, entry.file, 'title', 'title at the same institution');
  }
  return out;
}
