import { createHash } from 'node:crypto';
import type { ISODate } from '../dates';
import type { RawPosition } from '../types';
import { slugifyTitle } from './draft';
import type { ExtractedPosition } from './position-extract';

/**
 * Longest slug kept before the `-<hash>-<year>` suffix, so ids and branch names
 * stay readable; ids stay within 80 + 9 + 5 = 94 characters.
 */
const MAX_SLUG = 80;

/**
 * A structurally complete `RawPosition` from extracted fields. The id carries
 * the institution as well as the title, since adverts reuse generic titles
 * ("PhD position in computational chemistry") across institutions. `url`
 * falls back to the item it was found in, never to an invented link.
 */
export function synthesizePositionDraft(
  fields: ExtractedPosition,
  sourceUrl: string,
  topics: string[],
  today: ISODate,
): RawPosition {
  let slug = slugifyTitle(`${fields.institution} ${fields.title}`);
  if (slug.length > MAX_SLUG) {
    // Truncation can make distinct long titles share a prefix, so a short hash
    // of the full institution and title keeps their ids apart.
    const hash = createHash('sha256')
      .update(`${fields.institution}|${fields.title}`)
      .digest('hex')
      .slice(0, 8);
    slug = `${slug.slice(0, MAX_SLUG).replace(/-[^-]*$/, '')}-${hash}`;
  }
  const draft: RawPosition = {
    id: `${slug}-${today.slice(0, 4)}`,
    title: fields.title,
    level: fields.level,
    institution: fields.institution,
    location: fields.location,
    url: fields.url ?? sourceUrl,
    source_url: sourceUrl,
    topics,
    description: fields.description,
    added: today,
  };
  if (fields.original_title) draft.aliases = [fields.original_title];
  if (fields.group) draft.group = fields.group;
  if (fields.deadline) draft.deadline = fields.deadline;
  return draft;
}

/** Where the draft lives once merged; agrees with position-validation's folder rule. */
export function positionFilePath(p: RawPosition): string {
  return `data/positions/${p.added.slice(0, 4)}/${p.id}.yaml`;
}
