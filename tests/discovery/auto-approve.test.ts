import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  autoMergeHighConfidencePrs,
  parseConfidence,
  AUTO_APPROVE_THRESHOLD,
  HIGH_CONFIDENCE_LABEL,
} from '../../src/lib/discovery/auto-approve';
import { buildPositionPrBody, buildPrBody } from '../../src/lib/discovery/orchestrator';
import type { RawEvent, RawPosition } from '../../src/lib/types';

const candidate: RawEvent = {
  id: 'excited-states-symposium-2027',
  title: 'Excited-State Symposium',
  type: 'symposium',
  start_date: '2027-11-03',
  end_date: '2027-11-05',
  format: 'in-person',
  url: 'https://organiser.example.org/excited-states-symposium-2027/',
  topics: ['photochemistry'],
  description: 'A symposium on excited-state photochemistry.',
  added: '2026-09-25',
};

function bodyWithConfidence(confidence: number): string {
  return buildPrBody(candidate, {
    confidence,
    criteria: { relevant: 0.9, organiser: 0.9, programme: 0.9, cost: 0.9, red_flag: 0.02 },
  });
}

describe('parseConfidence', () => {
  it("reads the number from buildPrBody's own Confidence line", () => {
    expect(parseConfidence(bodyWithConfidence(0.93))).toBe(0.93);
  });

  it("reads the number from buildPositionPrBody's Confidence line", () => {
    const p: RawPosition = {
      id: 'utrecht-university-phd-position-in-molecular-dynamics-2026',
      title: 'PhD position in molecular dynamics',
      level: 'phd',
      institution: 'Utrecht University',
      location: { city: 'Utrecht', country: 'NL' },
      url: 'https://example.org/jobs/phd-md',
      source_url: 'https://example.org/jobs.xml',
      topics: ['molecular-dynamics'],
      description: 'A funded PhD project.',
      added: '2026-09-29',
    };
    expect(parseConfidence(buildPositionPrBody(p, 0.93))).toBe(0.93);
  });

  it('returns undefined for a body with no Confidence line', () => {
    expect(parseConfidence('A hand-written PR with no confidence line at all.')).toBeUndefined();
  });
});

interface StubResponse {
  status: number;
  body?: unknown;
}

function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(input).replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({
      method,
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const githubOptions = (impl: typeof fetch) => ({
  token: 'gh-test-token',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

const greenChecks = {
  check_runs: [
    { name: 'check', status: 'completed', conclusion: 'success' },
    { name: 'e2e', status: 'completed', conclusion: 'success' },
    { name: 'Workers Builds: compchem-events', status: 'completed', conclusion: 'failure' },
  ],
};

describe('autoMergeHighConfidencePrs', () => {
  const candidatePath = `data/events/2027/${candidate.id}.yaml`;
  const validFile = { ...candidate, location: { city: 'Lyon', country: 'FR' } };
  const prFiles = (data: unknown) => ({
    'GET /repos/acme/compchem-events/pulls/5/files?per_page=100': {
      status: 200,
      body: [{ filename: candidatePath, status: 'added' }],
    },
    [`GET /repos/acme/compchem-events/contents/${candidatePath}?ref=sha-5`]: {
      status: 200,
      body: { content: Buffer.from(stringify(data)).toString('base64') },
    },
  });
  const openPrs = (labels: Array<{ name: string }> = []) => ({
    'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
      status: 200,
      body: [
        {
          number: 5,
          body: bodyWithConfidence(AUTO_APPROVE_THRESHOLD),
          head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
          labels,
        },
      ],
    },
    'GET /repos/acme/compchem-events/commits/sha-5/check-runs?per_page=100': {
      status: 200,
      body: greenChecks,
    },
  });

  it('labels and merges a PR at or above the threshold once required checks are green', async () => {
    const { impl, calls } = stubGitHub({
      ...openPrs([{ name: 'needs-review' }]),
      ...prFiles(validFile),
      'POST /repos/acme/compchem-events/issues/5/labels': { status: 200, body: {} },
      'PUT /repos/acme/compchem-events/pulls/5/merge': { status: 200, body: { merged: true } },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result).toEqual({ merged: [5], skipped: [] });
    const label = calls.find((c) => c.url.endsWith('/issues/5/labels'));
    expect(label?.body).toEqual({ labels: [HIGH_CONFIDENCE_LABEL] });
    const merge = calls.find((c) => c.url.endsWith('/pulls/5/merge'));
    // Pinned to the sha whose checks were read, so a later push is never merged unseen.
    expect(merge?.body).toMatchObject({ sha: 'sha-5' });
  });

  it('merges a PR an earlier run already labelled, without labelling it again', async () => {
    const { impl, calls } = stubGitHub({
      ...openPrs([{ name: HIGH_CONFIDENCE_LABEL }]),
      ...prFiles(validFile),
      'PUT /repos/acme/compchem-events/pulls/5/merge': { status: 200, body: { merged: true } },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.merged).toEqual([5]);
    expect(calls.some((c) => c.url.endsWith('/labels'))).toBe(false);
  });

  it("never merges a PR whose files fail main's validator, though its CI passed", async () => {
    const { impl, calls } = stubGitHub({
      ...openPrs(),
      ...prFiles({ ...validFile, topics: ['not-a-topic'] }),
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.merged).toEqual([]);
    expect(result.skipped[0]?.reason).toMatch(/^fails main's validator:\n.*topics/s);
    expect(calls.some((c) => c.method === 'PUT' || c.method === 'POST')).toBe(false);
  });

  it('reports a merge GitHub refuses and moves on', async () => {
    const { impl } = stubGitHub({
      ...openPrs([{ name: HIGH_CONFIDENCE_LABEL }]),
      ...prFiles(validFile),
      'PUT /repos/acme/compchem-events/pulls/5/merge': {
        status: 405,
        body: { message: 'Pull Request is not mergeable' },
      },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result).toEqual({
      merged: [],
      skipped: [{ number: 5, reason: 'merge refused: HTTP 405 (Pull Request is not mergeable)' }],
    });
  });

  it('skips a PR below the confidence threshold, without checking its CI status', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.89),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.merged).toEqual([]);
    expect(result.skipped).toEqual([{ number: 5, reason: 'confidence 0.89 below threshold' }]);
    // Never spent a call checking CI for a PR that was never going to qualify anyway.
    expect(calls).toHaveLength(1);
  });

  it('skips a high-confidence PR whose required checks have not all passed', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.95),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
      'GET /repos/acme/compchem-events/commits/sha-5/check-runs?per_page=100': {
        status: 200,
        body: {
          check_runs: [
            { name: 'check', status: 'completed', conclusion: 'failure' },
            { name: 'e2e', status: 'completed', conclusion: 'success' },
          ],
        },
      },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.merged).toEqual([]);
    expect(result.skipped).toEqual([{ number: 5, reason: 'checks not green: check' }]);
  });

  it('leaves a possible duplicate for a human, however confident', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: bodyWithConfidence(0.99),
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [{ name: 'possible-duplicate' }],
          },
        ],
      },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.skipped).toEqual([{ number: 5, reason: 'possible duplicate' }]);
    expect(calls).toHaveLength(1);
  });

  it('skips a PR whose body has no parseable confidence line', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: 'A hand-edited PR body with the Confidence line removed.',
            head: { ref: 'discovery/excited-states-symposium-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
    });
    const result = await autoMergeHighConfidencePrs(githubOptions(impl));
    expect(result.skipped).toEqual([
      { number: 5, reason: 'could not parse confidence from PR body' },
    ]);
  });
});
