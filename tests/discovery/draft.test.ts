import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import prettier from 'prettier';
import {
  draftFilePath,
  serializeDraft,
  slugifyTitle,
  synthesizeDraft,
  type DraftInput,
} from '../../src/lib/discovery/draft';
import { loadValidationContext, validateEvent } from '../../src/lib/validation';

describe('slugifyTitle', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyTitle('DFT Summer School')).toBe('dft-summer-school');
  });

  it('strips accents and punctuation', () => {
    expect(slugifyTitle("École d'Été: DFT & Beyond!")).toBe('ecole-d-ete-dft-beyond');
  });

  it('transliterates Cyrillic, so Russian titles get a readable id', () => {
    expect(slugifyTitle('Школа по квантовой химии 2027')).toBe('shkola-po-kvantovoi-khimii-2027');
  });

  it('never returns an empty slug', () => {
    expect(slugifyTitle('量子化学会议')).toMatch(/^event-[0-9a-f]{8}$/);
    expect(slugifyTitle('量子化学会议')).not.toBe(slugifyTitle('理论化学会议'));
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugifyTitle('  --Multiple   Spaces--  ')).toBe('multiple-spaces');
  });
});

const fullInput: DraftInput = {
  title: 'New Symposium on Excited-State Photochemistry',
  type: 'symposium',
  start_date: '2027-06-10',
  end_date: '2027-06-12',
  format: 'in-person',
  location: { city: 'Testville', country: 'DE' },
  url: 'https://organiser.example.org/symposium-2027/',
  source_url: 'https://organiser.example.org/symposium-2027/',
  organizer: 'Test Organiser',
  cost: 'Free',
  fee: 'free',
  topics: ['photochemistry', 'excited-states'],
  description: 'A symposium on excited-state photochemistry.',
};

describe('synthesizeDraft', () => {
  it('derives id from title and start year, and sets added to today', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    expect(draft.id).toBe('new-symposium-on-excited-state-photochemistry-2027');
    expect(draft.added).toBe('2026-09-23');
    expect(draft.location).toEqual({ city: 'Testville', country: 'DE' });
    expect(draft.organizer).toBe('Test Organiser');
    expect(draft.cost).toBe('Free');
    expect(draft.fee).toBe('free');
  });

  it('omits location, organizer and cost entirely when absent, never as undefined keys', () => {
    const { location, organizer, cost, fee, ...rest } = fullInput;
    void location;
    void organizer;
    void cost;
    void fee;
    const draft = synthesizeDraft(rest, '2026-09-23');
    expect('location' in draft).toBe(false);
    expect('organizer' in draft).toBe(false);
    expect('cost' in draft).toBe(false);
    expect('fee' in draft).toBe(false);
  });
});

describe('synthesizeDraft aliases', () => {
  it("keeps a translated title's original as an alias, and adds no key otherwise", () => {
    expect(
      synthesizeDraft({ ...fullInput, original_title: '励起状態シンポジウム' }, '2026-09-23')
        .aliases,
    ).toEqual(['励起状態シンポジウム']);
    expect('aliases' in synthesizeDraft(fullInput, '2026-09-23')).toBe(false);
  });
});

describe('draftFilePath', () => {
  it('places the draft under its own start year and id', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    expect(draftFilePath(draft)).toBe(
      'data/events/2027/new-symposium-on-excited-state-photochemistry-2027.yaml',
    );
  });
});

describe('serializeDraft', () => {
  it('produces YAML that round-trips through the yaml parser', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    const yamlText = serializeDraft(draft);
    expect(parse(yamlText)).toEqual(draft);
  });

  // Regression test for a real CI failure: every generated draft is
  // committed straight into a PR, so its YAML must already satisfy `npm run
  // lint`'s `prettier --check`. A long, apostrophe-free description (the
  // common case — LLM-written prose near the 280-char cap) needs Prettier's
  // "fold across lines and quote" treatment, and `yaml`'s own default quote
  // style (double) disagreed with this repo's `singleQuote: true`, so every
  // such draft failed CI even though nothing else was wrong with it.
  it('matches this repo’s Prettier formatting exactly, needing no --write', async () => {
    const draft = synthesizeDraft(
      {
        ...fullInput,
        // The colon-space forces YAML to quote this scalar at all (a plain
        // scalar can't contain ": ") — and it has no apostrophe, so nothing
        // forces double quotes specifically; that's what exposes a quote
        // style disagreement with Prettier.
        description:
          'Symposium on excited state photochemistry: a two day event with invited ' +
          'talks, a poster session and a panel discussion on open software for ' +
          'computational spectroscopy.',
      },
      '2026-09-23',
    );
    const yamlText = serializeDraft(draft);
    const filepath = draftFilePath(draft);
    const config = await prettier.resolveConfig(filepath);
    const formatted = await prettier.format(yamlText, { ...config, filepath });
    expect(yamlText).toBe(formatted);
  });
});

describe('a synthesized draft passes the real validator', () => {
  it('has zero errors against validateEvent with its own draftFilePath', () => {
    const draft = synthesizeDraft(fullInput, '2026-09-23');
    const ctx = loadValidationContext('.', '2026-09-23');
    const result = validateEvent({ file: draftFilePath(draft), data: draft }, ctx);
    expect(result.errors).toEqual([]);
  });
});
