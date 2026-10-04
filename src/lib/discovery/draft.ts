import { createHash } from 'node:crypto';
import { stringify } from 'yaml';
import type { ISODate } from '../dates';
import type { RawEvent, RawGroup, RawPosition } from '../types';

/**
 * Russian Cyrillic to Latin, so a title from a Russian-language source
 * still yields a readable id instead of an empty one.
 */
const CYRILLIC: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
};

/**
 * ASCII, lowercase, hyphen-separated — matches the event id schema pattern.
 * Never empty: a title with no Latin or Cyrillic letters (Chinese, Japanese)
 * becomes "event-" plus a short hash of the title, so two such events don't
 * share an id.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[а-яё]/g, (c) => CYRILLIC[c] ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `event-${createHash('sha256').update(title).digest('hex').slice(0, 8)}`;
}

export interface DraftInput {
  title: string;
  /** Kept as an alias: the source's own title when `title` translates it. */
  original_title?: string;
  type: RawEvent['type'];
  start_date: ISODate;
  end_date: ISODate;
  format: RawEvent['format'];
  location?: RawEvent['location'];
  url: string;
  source_url: string;
  organizer?: string;
  cost?: string;
  fee?: RawEvent['fee'];
  topics: string[];
  description: string;
}

/**
 * Builds a structurally complete `RawEvent` from extracted fields: `id` from
 * title + start year, `added` set to the run date. This is
 * exactly what the later, separate PR-opening step would set anyway — see
 * docs/superpowers/specs/2026-09-23-discovery-source-parsing-design.md,
 * "Validation and the candidate draft".
 */
export function synthesizeDraft(input: DraftInput, today: ISODate): RawEvent {
  const year = input.start_date.slice(0, 4);
  const draft: RawEvent = {
    id: `${slugifyTitle(input.title)}-${year}`,
    title: input.title,
    type: input.type,
    start_date: input.start_date,
    end_date: input.end_date,
    format: input.format,
    url: input.url,
    source_url: input.source_url,
    topics: input.topics,
    description: input.description,
    added: today,
  };
  if (input.original_title) draft.aliases = [input.original_title];
  if (input.location) draft.location = input.location;
  if (input.organizer) draft.organizer = input.organizer;
  if (input.cost) draft.cost = input.cost;
  if (input.fee) draft.fee = input.fee;
  return draft;
}

/**
 * The file path a draft would occupy if it were written to `data/events/`,
 * derived from the draft's own `id`/`start_date` — never from where it was
 * found. `src/lib/validation.ts`'s semantic rule 1 checks the file's
 * basename and parent folder against `id` and the start year, so this path
 * must always agree with the draft that produced it.
 */
export function draftFilePath(draft: RawEvent): string {
  return `data/events/${draft.start_date.slice(0, 4)}/${draft.id}.yaml`;
}

/**
 * Renders a draft as the YAML text a PR would commit at `draftFilePath(draft)`.
 *
 * `singleQuote: true` matches the repo's Prettier config (`.prettierrc.json`).
 * Without it, `yaml`'s own default (double quotes) disagrees with Prettier
 * for any description that needs quoting but contains no apostrophe — which
 * is most of them, since descriptions are LLM-written prose long enough to
 * wrap — so a generated draft would fail `npm run lint`'s `prettier --check`
 * in CI on every such PR.
 */
export function serializeDraft(draft: RawEvent | RawPosition | RawGroup): string {
  return stringify(draft, { singleQuote: true });
}
