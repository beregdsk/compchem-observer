import { describe, expect, it } from 'vitest';
import {
  awaitModelSlot,
  DEFAULT_EXTRACT_BASE_URL,
  EXTRACT_ATTEMPTS,
  FREE_MODEL_INTERVAL_MS,
  failedResponseError,
  RetryableExtractError,
  clip,
  extractEvent,
  extractEvents,
  normalizeEventUrl,
} from '../../src/lib/discovery/extract-client';

function stubFetch(status: number, body: unknown, statusText = 'OK') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, statusText });
  }) as typeof fetch;
  return { impl, calls };
}

function completionWith(content: unknown) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

const options = { apiKey: 'sk-test', model: 'test-extract-model', topics: ['molecular-dynamics'] };

describe('extractEvent', () => {
  it('POSTs a chat-completion request with the text as the user message only', async () => {
    const { impl, calls } = stubFetch(200, completionWith({ found: false, event: null }));
    await extractEvent('Some page text', { ...options, fetchImpl: impl });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(DEFAULT_EXTRACT_BASE_URL);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(calls[0]!.init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Some page text' });
    expect(body.messages[0]!.content).not.toContain('Some page text');
  });

  it('returns null when the model reports no event found', async () => {
    const { impl } = stubFetch(200, completionWith({ found: false, event: null }));
    const result = await extractEvent('irrelevant text', { ...options, fetchImpl: impl });
    expect(result).toBeNull();
  });

  it('normalizes a found event, dropping null location/organizer/venue', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          location: { city: 'Testville', country: 'DE', venue: null },
          url: 'https://example.org/md-school',
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    // toStrictEqual (unlike toEqual) treats a key present with value `undefined` as different
    // from an absent key — this is the exact contract synthesizeDraft (Task 5) depends on.
    expect(result).toStrictEqual({
      title: 'MD Summer School',
      type: 'school',
      start_date: '2027-07-01',
      end_date: '2027-07-05',
      format: 'in-person',
      location: { city: 'Testville', country: 'DE' },
      url: 'https://example.org/md-school',
      topics: ['molecular-dynamics'],
      description: 'A summer school on molecular dynamics.',
      confidence: 0.9,
    });
    expect('location' in (result as object)).toBe(true);
    expect(Object.hasOwn(result as object, 'organizer')).toBe(false);
    expect(Object.hasOwn(result as object, 'cost')).toBe(false);
  });

  it('normalizes a stated cost, and omits the key entirely when cost is null', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          location: null,
          url: 'https://example.org/md-school',
          organizer: null,
          cost: 'Free',
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    expect(result?.cost).toBe('Free');
  });

  it("keeps a translated title's original, and drops one that is just the English title", async () => {
    const event = (original_title: string | null) =>
      completionWith({
        found: true,
        event: {
          title: 'Symposium on Molecular Science',
          original_title,
          type: 'symposium',
          start_date: '2027-09-14',
          end_date: '2027-09-17',
          format: 'in-person',
          location: null,
          url: 'https://example.org/sms',
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'An annual symposium.',
          confidence: 0.9,
        },
      });
    const run = async (original: string | null) =>
      extractEvent('page text', { ...options, fetchImpl: stubFetch(200, event(original)).impl });
    expect((await run('分子科学討論会'))?.original_title).toBe('分子科学討論会');
    expect(await run('Symposium on molecular science')).not.toHaveProperty('original_title');
    expect(await run(null)).not.toHaveProperty('original_title');
  });

  it('passes a stated fee through, and omits it when null, missing or off-vocabulary', async () => {
    const event = (fee: unknown) => ({
      title: 'MD Summer School',
      type: 'school',
      start_date: '2027-07-01',
      end_date: '2027-07-05',
      format: 'in-person',
      location: null,
      url: 'https://example.org/md-school',
      organizer: null,
      cost: null,
      ...(fee === undefined ? {} : { fee }),
      topics: ['molecular-dynamics'],
      description: 'A summer school on molecular dynamics.',
      confidence: 0.9,
    });
    const run = async (fee: unknown) => {
      const { impl } = stubFetch(200, completionWith({ found: true, event: event(fee) }));
      return extractEvent('page text', { ...options, fetchImpl: impl });
    };
    expect((await run('free'))?.fee).toBe('free');
    expect((await run('paid'))?.fee).toBe('paid');
    expect(Object.hasOwn((await run(null)) as object, 'fee')).toBe(false);
    expect(Object.hasOwn((await run(undefined)) as object, 'fee')).toBe(false);
  });

  it('accepts a null event.url without throwing (Fix D)', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'No Canonical Url Workshop',
          type: 'workshop',
          start_date: '2027-06-01',
          end_date: '2027-06-02',
          format: 'online',
          location: null,
          url: null,
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A workshop with no stated canonical URL.',
          confidence: 0.7,
        },
      }),
    );
    const result = await extractEvent('page text', { ...options, fetchImpl: impl });
    expect(result).not.toBeNull();
    expect(result!.url).toBeNull();
  });

  it('throws on a non-2xx response', async () => {
    const { impl } = stubFetch(401, { error: 'bad key' }, 'Unauthorized');
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(/401/);
  });

  it('throws when the response content is not valid JSON', async () => {
    const { impl } = stubFetch(200, { choices: [{ message: { content: 'not json' } }] });
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('throws when the found event does not match the expected shape', async () => {
    const { impl } = stubFetch(200, completionWith({ found: true, event: { title: 'X' } }));
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /expected shape/,
    );
  });

  it('reports token usage via onUsage', async () => {
    const usages: number[] = [];
    const { impl } = stubFetch(200, {
      ...completionWith({ found: false, event: null }),
      usage: { total_tokens: 321 },
    });
    await extractEvent('some text', {
      ...options,
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(usages).toEqual([321]);
  });

  it('reports 0 usage when the response has no usage field', async () => {
    const usages: number[] = [];
    const { impl } = stubFetch(200, completionWith({ found: false, event: null }));
    await extractEvent('some text', {
      ...options,
      fetchImpl: impl,
      onUsage: (tokens) => usages.push(tokens),
    });
    expect(usages).toEqual([0]);
  });

  it('throws when a well-formed event carries a malformed nested location', async () => {
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'MD Summer School',
          type: 'school',
          start_date: '2027-07-01',
          end_date: '2027-07-05',
          format: 'in-person',
          // country is missing and venue is a number, not string | null — both invalid.
          location: { city: 'Testville', venue: 123 },
          url: 'https://example.org/md-school',
          organizer: null,
          cost: null,
          topics: ['molecular-dynamics'],
          description: 'A summer school on molecular dynamics.',
          confidence: 0.9,
        },
      }),
    );
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /expected shape/,
    );
  });

  it('retries a malformed response and returns the next good one', async () => {
    const replies = [
      { choices: [{ message: { content: 'User Safety: safe' } }] },
      { choices: [{ message: { content: '' } }] },
      completionWith({ found: false, event: null }),
    ];
    let calls = 0;
    const impl = (async () =>
      new Response(JSON.stringify(replies[calls++]), { status: 200 })) as typeof fetch;
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).resolves.toBeNull();
    expect(calls).toBe(3);
  });

  it(`gives up after ${EXTRACT_ATTEMPTS} malformed responses`, async () => {
    const { impl, calls } = stubFetch(200, { choices: [{ message: { content: 'not json' } }] });
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).rejects.toThrow(
      /not valid JSON/,
    );
    expect(calls).toHaveLength(EXTRACT_ATTEMPTS);
  });

  it('retries a 429 but not a 401', async () => {
    const waits: number[] = [];
    const sleepImpl = async (ms: number) => {
      waits.push(ms);
    };
    const rateLimited = stubFetch(429, { error: 'slow down' }, 'Too Many Requests');
    await expect(
      extractEvent('text', { ...options, fetchImpl: rateLimited.impl, sleepImpl }),
    ).rejects.toThrow(/429/);
    expect(rateLimited.calls).toHaveLength(EXTRACT_ATTEMPTS);
    // No stated reset: the default wait, between attempts only.
    expect(waits).toEqual([20_000, 20_000]);

    const unauthorized = stubFetch(401, { error: 'bad key' }, 'Unauthorized');
    await expect(
      extractEvent('text', { ...options, fetchImpl: unauthorized.impl }),
    ).rejects.toThrow(/401/);
    expect(unauthorized.calls).toHaveLength(1);
  });

  it("waits out a 429 until OpenRouter's stated reset, capped at a minute", async () => {
    const waits: number[] = [];
    let calls = 0;
    const impl = (async () => {
      calls++;
      if (calls === 1) {
        const reset = Date.now() + 12_000;
        return new Response(
          JSON.stringify({
            error: { code: 429, metadata: { headers: { 'X-RateLimit-Reset': String(reset) } } },
          }),
          { status: 429 },
        );
      }
      return new Response(JSON.stringify(completionWith({ found: false, event: null })));
    }) as typeof fetch;
    const sleepImpl = async (ms: number) => {
      waits.push(ms);
    };
    await expect(
      extractEvent('text', { ...options, fetchImpl: impl, sleepImpl }),
    ).resolves.toBeNull();
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(10_000);
    expect(waits[0]).toBeLessThanOrEqual(12_000);
  });

  it('retries a dropped connection', async () => {
    let calls = 0;
    const impl = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(completionWith({ found: false, event: null })));
    }) as typeof fetch;
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).resolves.toBeNull();
    expect(calls).toBe(2);
  });

  it('retries a timed-out call', async () => {
    let calls = 0;
    const impl = (async () => {
      calls++;
      if (calls === 1) throw new DOMException('timed out', 'TimeoutError');
      return new Response(JSON.stringify(completionWith({ found: false, event: null })));
    }) as typeof fetch;
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).resolves.toBeNull();
    expect(calls).toBe(2);
  });

  it('unwraps JSON inside a Markdown code fence', async () => {
    const fenced = '```json\n' + JSON.stringify({ found: false, event: null }) + '\n```';
    const { impl } = stubFetch(200, { choices: [{ message: { content: fenced } }] });
    await expect(extractEvent('text', { ...options, fetchImpl: impl })).resolves.toBeNull();
  });

  it('trims overlong fields and drops excess or unknown topics instead of failing', async () => {
    const topics = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { impl } = stubFetch(
      200,
      completionWith({
        found: true,
        event: {
          title: 'Sanibel Symposium',
          type: 'symposium',
          start_date: '2027-02-21',
          end_date: '2027-02-26',
          format: 'in-person',
          location: null,
          url: null,
          organizer: null,
          cost: null,
          topics: ['a', 'not-a-topic', 'b', 'a', 'c', 'd', 'e', 'f'],
          description: 'word '.repeat(150),
          confidence: 0.9,
        },
      }),
    );
    const result = await extractEvent('text', { ...options, topics, fetchImpl: impl });
    expect(result!.topics).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result!.description.length).toBeLessThanOrEqual(600);
    expect(result!.description.endsWith('word…')).toBe(true);
  });
});

describe('clip', () => {
  it('leaves short text alone and cuts long text at a word boundary', () => {
    expect(clip('  short  ', 10)).toBe('short');
    expect(clip('alpha beta gamma delta', 15)).toBe('alpha beta…');
  });
});

const listedEvent = (title: string, start = '2027-03-01') => ({
  title,
  type: 'workshop',
  start_date: start,
  end_date: start,
  format: 'online',
  location: null,
  url: null,
  organizer: null,
  cost: null,
  topics: ['molecular-dynamics'],
  description: `About ${title}.`,
  confidence: 0.8,
});

describe('extractEvents', () => {
  it('asks for every listed event and returns each, normalized', async () => {
    const { impl, calls } = stubFetch(
      200,
      completionWith({ events: [listedEvent('MD Workshop'), listedEvent('ML School')] }),
    );
    const events = await extractEvents('listing text', { ...options, fetchImpl: impl });
    expect(events.map((e) => e.title)).toEqual(['MD Workshop', 'ML School']);
    const body = JSON.parse(calls[0]!.init.body as string) as {
      messages: Array<{ content: string }>;
      response_format: { json_schema: { name: string } };
    };
    expect(body.response_format.json_schema.name).toBe('candidate_events');
    expect(body.messages[0]!.content).toContain('lists several events inline');
  });

  it('returns an empty list when the page lists no event in the field', async () => {
    const { impl } = stubFetch(200, completionWith({ events: [] }));
    await expect(extractEvents('text', { ...options, fetchImpl: impl })).resolves.toEqual([]);
  });

  it('retries a response with a non-ISO date instead of passing it on', async () => {
    const replies = [
      completionWith({ events: [listedEvent('MD Workshop', '1 March 2027')] }),
      completionWith({ events: [listedEvent('MD Workshop')] }),
    ];
    let calls = 0;
    const impl = (async () =>
      new Response(JSON.stringify(replies[calls++]), { status: 200 })) as typeof fetch;
    const events = await extractEvents('text', { ...options, fetchImpl: impl });
    expect(calls).toBe(2);
    expect(events[0]!.start_date).toBe('2027-03-01');
  });
});

describe('normalizeEventUrl', () => {
  it('keeps https, upgrades http and bare hosts, and drops anything else', () => {
    expect(normalizeEventUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(normalizeEventUrl('http://euchems2026.eu')).toBe('https://euchems2026.eu/');
    expect(normalizeEventUrl('www.euchems-compchem.eu')).toBe('https://www.euchems-compchem.eu/');
    expect(normalizeEventUrl('ftp://example.org/x')).toBeNull();
    expect(normalizeEventUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeEventUrl('see website')).toBeNull();
    expect(normalizeEventUrl(null)).toBeNull();
  });
});

describe('awaitModelSlot', () => {
  // Far past any slot other tests reserved, so the module's shared state never interferes.
  let clock = 1e15;
  const opts = (model: string, sleeps: number[]) => ({
    apiKey: 'k',
    model,
    topics: [],
    sleepImpl: async (ms: number) => void sleeps.push(ms),
  });

  it('spaces concurrent free-model calls 3.1 s apart', async () => {
    const sleeps: number[] = [];
    clock += 1e9;
    const now = () => clock;
    await Promise.all([1, 2, 3].map(() => awaitModelSlot(opts('x/y:free', sleeps), now)));
    expect(sleeps).toEqual([FREE_MODEL_INTERVAL_MS, 2 * FREE_MODEL_INTERVAL_MS]);
  });

  it('never waits for a paid model', async () => {
    const sleeps: number[] = [];
    await Promise.all([1, 2, 3].map(() => awaitModelSlot(opts('x/y', sleeps), () => clock)));
    expect(sleeps).toEqual([]);
  });
});

describe('failedResponseError', () => {
  const res = (status: number) => new Response('', { status });
  it('retries a 429, a 5xx and an upstream provider failure, not a plain 400', () => {
    expect(failedResponseError('m', res(429), '')).toBeInstanceOf(RetryableExtractError);
    expect(failedResponseError('m', res(502), '')).toBeInstanceOf(RetryableExtractError);
    expect(
      failedResponseError(
        'm',
        res(400),
        '{"error":{"message":"Provider returned error","code":400}}',
      ),
    ).toBeInstanceOf(RetryableExtractError);
    expect(failedResponseError('m', res(400), '{"error":"bad schema"}')).not.toBeInstanceOf(
      RetryableExtractError,
    );
  });
});
