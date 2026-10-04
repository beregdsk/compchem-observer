import { describe, expect, it } from 'vitest';
import {
  addLabel,
  createBranch,
  getBranchStatus,
  getCheckRunConclusions,
  getDefaultBranch,
  listFilesOnBranch,
  listOpenDiscoveryPrs,
  openPr,
  mergePr,
  putFile,
  syncFailureIssue,
  updatePrBody,
  type GitHubOptions,
} from '../../src/lib/discovery/github-client';

interface StubResponse {
  status: number;
  body?: unknown;
}

/** Keyed by "METHOD path", where path is everything after the GitHub API host. */
function stubGitHub(responses: Record<string, StubResponse>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    const path = url.replace('https://api.github.com', '');
    const key = `${method} ${path}`;
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const stub = responses[key];
    if (!stub) throw new Error(`unstubbed request: ${key}`);
    return new Response(stub.body === undefined ? '' : JSON.stringify(stub.body), {
      status: stub.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const options = (impl: typeof fetch): GitHubOptions => ({
  token: 'gh-test-token',
  repo: 'acme/compchem-events',
  fetchImpl: impl,
});

describe('getDefaultBranch', () => {
  it('resolves the default branch name and its current sha', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events': { status: 200, body: { default_branch: 'main' } },
      'GET /repos/acme/compchem-events/git/ref/heads/main': {
        status: 200,
        body: { object: { sha: 'abc123' } },
      },
    });
    const result = await getDefaultBranch(options(impl));
    expect(result).toEqual({ name: 'main', sha: 'abc123' });
  });
});

describe('getBranchStatus', () => {
  it('reports a branch that does not exist', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 404,
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: false });
  });

  it('reports a branch that exists with an open PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [{ number: 42, state: 'open' }],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: 42, everHadPr: true });
  });

  // Distinguishes "this branch was created but a PR was never opened for it"
  // (e.g. a prior run crashed between createBranch and openPr — resumable)
  // from "a PR was opened and is now closed or merged" (a human already
  // reviewed it — never reopen). Both look identical under a `state=open`
  // query; only `state=all` tells them apart.
  it('reports an orphaned branch that never had a PR opened for it', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: undefined, everHadPr: false });
  });

  it('reports a branch whose only PR is closed or merged', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/git/ref/heads/discovery/some-event-2027': {
        status: 200,
        body: { object: { sha: 'def456' } },
      },
      'GET /repos/acme/compchem-events/pulls?state=all&head=acme:discovery/some-event-2027': {
        status: 200,
        body: [{ number: 7, state: 'closed' }],
      },
    });
    const result = await getBranchStatus('discovery/some-event-2027', options(impl));
    expect(result).toEqual({ exists: true, openPr: undefined, everHadPr: true });
  });
});

describe('createBranch', () => {
  it('creates a ref from the given sha', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 201, body: {} },
    });
    await createBranch('discovery/some-event-2027', 'abc123', options(impl));
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.github.com/repos/acme/compchem-events/git/refs',
        body: { ref: 'refs/heads/discovery/some-event-2027', sha: 'abc123' },
      },
    ]);
  });

  it('throws on a non-201 response', async () => {
    const { impl } = stubGitHub({
      'POST /repos/acme/compchem-events/git/refs': { status: 422, body: { message: 'exists' } },
    });
    await expect(
      createBranch('discovery/some-event-2027', 'abc123', options(impl)),
    ).rejects.toThrow('HTTP 422');
  });
});

describe('putFile', () => {
  it('creates a new file when none exists on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 404 },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml': {
        status: 201,
        body: {},
      },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Add candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({
      message: 'Add candidate event: Some Event',
      content: Buffer.from('title: Some Event\n', 'utf8').toString('base64'),
      branch: 'discovery/some-event-2027',
    });
  });

  it('includes the existing sha when updating a file already on the branch', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        { status: 200, body: { sha: 'file-sha-1' } },
      'PUT /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml': {
        status: 200,
        body: {},
      },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Update candidate event: Some Event',
      options(impl),
    );
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({ sha: 'file-sha-1' });
  });

  // I4 from the final review: without this, a rerun that re-extracts the
  // same unchanged candidate commits an identical file every time, and
  // resets `added` over a reviewer's own edits to the PR.
  it('skips the commit entirely when the existing content already matches', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/events/2027/some-event-2027.yaml?ref=discovery/some-event-2027':
        {
          status: 200,
          body: {
            sha: 'file-sha-1',
            content: Buffer.from('title: Some Event\n', 'utf8').toString('base64'),
          },
        },
    });
    await putFile(
      'discovery/some-event-2027',
      'data/events/2027/some-event-2027.yaml',
      'title: Some Event\n',
      'Update candidate event: Some Event',
      options(impl),
    );
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('openPr, updatePrBody, addLabel', () => {
  it('opens a pull request and returns its number', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/pulls': { status: 201, body: { number: 7 } },
    });
    const result = await openPr(
      'discovery/some-event-2027',
      'main',
      'Some Event',
      'PR body',
      options(impl),
    );
    expect(result).toEqual({ number: 7 });
    expect(calls[0]?.body).toEqual({
      title: 'Some Event',
      head: 'discovery/some-event-2027',
      base: 'main',
      body: 'PR body',
    });
  });

  it('updates a pull request body', async () => {
    const { impl, calls } = stubGitHub({
      'PATCH /repos/acme/compchem-events/pulls/7': { status: 200, body: {} },
    });
    await updatePrBody(7, 'new body', options(impl));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { body: 'new body' } });
  });

  it('adds a label to a pull request', async () => {
    const { impl, calls } = stubGitHub({
      'POST /repos/acme/compchem-events/issues/7/labels': { status: 200, body: {} },
    });
    await addLabel(7, 'needs-review', options(impl));
    expect(calls[0]?.body).toEqual({ labels: ['needs-review'] });
  });
});

describe('syncFailureIssue', () => {
  it('creates a new issue when there are errors and none exists yet', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
      'POST /repos/acme/compchem-events/issues': { status: 201, body: { number: 9 } },
    });
    await syncFailureIssue(
      [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
      options(impl),
    );
    const created = calls.find((c) => c.method === 'POST');
    expect(created?.body).toMatchObject({
      title: 'Discovery agent source failures',
      labels: ['discovery-failures'],
    });
    expect((created?.body as { body: string }).body).toContain('https://example.org/dead');
    expect((created?.body as { body: string }).body).toContain('HTTP 500');
  });

  it('updates the existing issue instead of creating a second one', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 9, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/9': { status: 200, body: {} },
    });
    await syncFailureIssue(
      [{ source: 'https://example.org/dead', message: 'HTTP 500' }],
      options(impl),
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    const updated = calls.find((c) => c.method === 'PATCH');
    expect(updated?.body).toMatchObject({ state: 'open' });
  });

  it('closes the existing issue when there are no errors', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [{ number: 9, title: 'Discovery agent source failures' }],
      },
      'PATCH /repos/acme/compchem-events/issues/9': { status: 200, body: {} },
    });
    await syncFailureIssue([], options(impl));
    const updated = calls.find((c) => c.method === 'PATCH');
    expect(updated?.body).toMatchObject({ state: 'closed' });
  });

  it('does nothing when there are no errors and no open issue', async () => {
    const { impl, calls } = stubGitHub({
      'GET /repos/acme/compchem-events/issues?state=open&labels=discovery-failures': {
        status: 200,
        body: [],
      },
    });
    await syncFailureIssue([], options(impl));
    expect(calls).toHaveLength(1);
  });
});

describe('listOpenDiscoveryPrs', () => {
  it('returns only PRs on discovery/* branches, never a human-authored PR', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: 'Confidence: 0.93',
            head: { ref: 'discovery/some-event-2027', sha: 'sha-5' },
            labels: [{ name: 'needs-review' }],
          },
          {
            number: 6,
            body: 'A hand-written PR, unrelated to discovery',
            head: { ref: 'fix-typo', sha: 'sha-6' },
            labels: [],
          },
        ],
      },
    });
    const prs = await listOpenDiscoveryPrs(options(impl));
    expect(prs).toEqual([
      {
        number: 5,
        headRef: 'discovery/some-event-2027',
        headSha: 'sha-5',
        body: 'Confidence: 0.93',
        labels: ['needs-review'],
      },
    ]);
  });

  it('treats a null body as an empty string', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/pulls?state=open&per_page=100': {
        status: 200,
        body: [
          {
            number: 5,
            body: null,
            head: { ref: 'discovery/some-event-2027', sha: 'sha-5' },
            labels: [],
          },
        ],
      },
    });
    const prs = await listOpenDiscoveryPrs(options(impl));
    expect(prs[0]!.body).toBe('');
  });
});

describe('getCheckRunConclusions', () => {
  it('maps each check run name to its conclusion', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/commits/sha-5/check-runs?per_page=100': {
        status: 200,
        body: {
          check_runs: [
            { name: 'check', status: 'completed', conclusion: 'success' },
            { name: 'e2e', status: 'completed', conclusion: 'success' },
            { name: 'Workers Builds: compchem-events', status: 'completed', conclusion: 'failure' },
          ],
        },
      },
    });
    const conclusions = await getCheckRunConclusions('sha-5', options(impl));
    expect(conclusions.get('check')).toBe('success');
    expect(conclusions.get('e2e')).toBe('success');
    expect(conclusions.get('Workers Builds: compchem-events')).toBe('failure');
    expect(conclusions.get('never-ran')).toBeUndefined();
  });
});

describe('mergePr', () => {
  it('PUTs a merge pinned to the checked head sha', async () => {
    const { impl, calls } = stubGitHub({
      'PUT /repos/acme/compchem-events/pulls/5/merge': { status: 200, body: { merged: true } },
    });
    expect(await mergePr(5, 'sha-5', options(impl))).toBeUndefined();
    expect(calls[0]!.body).toEqual({ sha: 'sha-5', merge_method: 'merge' });
  });

  it('reports a refused merge instead of throwing', async () => {
    const { impl } = stubGitHub({
      'PUT /repos/acme/compchem-events/pulls/5/merge': {
        status: 409,
        body: { message: 'Head branch was modified' },
      },
    });
    expect(await mergePr(5, 'sha-5', options(impl))).toBe(
      'merge refused: HTTP 409 (Head branch was modified)',
    );
  });

  it('throws on any other failure', async () => {
    const { impl } = stubGitHub({
      'PUT /repos/acme/compchem-events/pulls/5/merge': { status: 403, body: {} },
    });
    await expect(mergePr(5, 'sha-5', options(impl))).rejects.toThrow(/403/);
  });
});

describe('listFilesOnBranch', () => {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

  it('returns the decoded YAML files directly under the folder', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/groups?ref=discovery/x': {
        status: 200,
        body: [
          { path: 'data/groups/a.yaml', type: 'file' },
          { path: 'data/groups/README.md', type: 'file' },
          { path: 'data/groups/sub', type: 'dir' },
          { path: 'data/groups/b.yaml', type: 'file' },
        ],
      },
      'GET /repos/acme/compchem-events/contents/data/groups/a.yaml?ref=discovery/x': {
        status: 200,
        body: { content: `${b64('id: a\n').slice(0, 4)}\n${b64('id: a\n').slice(4)}` },
      },
      'GET /repos/acme/compchem-events/contents/data/groups/b.yaml?ref=discovery/x': {
        status: 200,
        body: { content: b64('id: b\n') },
      },
    });
    expect(await listFilesOnBranch('discovery/x', 'data/groups', options(impl))).toEqual([
      { path: 'data/groups/a.yaml', content: 'id: a\n' },
      { path: 'data/groups/b.yaml', content: 'id: b\n' },
    ]);
  });

  it('returns nothing when the folder does not exist on the branch', async () => {
    const { impl } = stubGitHub({
      'GET /repos/acme/compchem-events/contents/data/groups?ref=discovery/x': { status: 404 },
    });
    expect(await listFilesOnBranch('discovery/x', 'data/groups', options(impl))).toEqual([]);
  });
});
