import { fetchWithTimeout } from './http';

const GITHUB_API = 'https://api.github.com';

export interface GitHubOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface ApiResult<T> {
  status: number;
  data: T;
}

/**
 * One GitHub REST call. Returns the raw status alongside the parsed body
 * instead of throwing on a non-2xx, because callers need to branch on
 * specific statuses (404 means "does not exist", not an error) — each
 * exported function decides for itself which statuses are errors.
 */
async function githubRequest<T>(
  options: GitHubOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    `${options.baseUrl ?? GITHUB_API}/repos/${options.repo}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
  );
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T };
}

export interface DefaultBranch {
  name: string;
  sha: string;
}

interface RepoInfo {
  default_branch: string;
}

interface RefInfo {
  object: { sha: string };
}

export async function getDefaultBranch(options: GitHubOptions): Promise<DefaultBranch> {
  const repoRes = await githubRequest<RepoInfo>(options, 'GET', '');
  if (repoRes.status !== 200) {
    throw new Error(`failed to read repo "${options.repo}": HTTP ${repoRes.status}`);
  }
  const name = repoRes.data.default_branch;
  const refRes = await githubRequest<RefInfo>(options, 'GET', `/git/ref/heads/${name}`);
  if (refRes.status !== 200) {
    throw new Error(`failed to read ref for default branch "${name}": HTTP ${refRes.status}`);
  }
  return { name, sha: refRes.data.object.sha };
}

export type BranchStatus =
  { exists: false } | { exists: true; openPr: number | undefined; everHadPr: boolean };

interface PullSummary {
  number: number;
  state: string;
}

/**
 * `everHadPr` distinguishes an orphaned branch (created by a prior run that
 * then crashed before `openPr` — resumable) from a branch whose PR is now
 * closed or merged (a human already reviewed it — never reopen). Both have
 * `openPr: undefined`; only querying `state=all` instead of `state=open`
 * tells them apart.
 */
export async function getBranchStatus(
  branch: string,
  options: GitHubOptions,
): Promise<BranchStatus> {
  const refRes = await githubRequest<unknown>(options, 'GET', `/git/ref/heads/${branch}`);
  if (refRes.status === 404) return { exists: false };
  if (refRes.status !== 200) {
    throw new Error(`failed to check branch "${branch}": HTTP ${refRes.status}`);
  }
  const owner = options.repo.split('/')[0];
  const pullsRes = await githubRequest<PullSummary[]>(
    options,
    'GET',
    `/pulls?state=all&head=${owner}:${branch}`,
  );
  if (pullsRes.status !== 200) {
    throw new Error(`failed to list pull requests for branch "${branch}": HTTP ${pullsRes.status}`);
  }
  const openPr = pullsRes.data.find((pr) => pr.state === 'open')?.number;
  return { exists: true, openPr, everHadPr: pullsRes.data.length > 0 };
}

/** One file's text at `ref`, a branch name or a commit sha. */
async function readFileAt(path: string, ref: string, options: GitHubOptions): Promise<string> {
  const res = await githubRequest<{ content: string }>(
    options,
    'GET',
    `/contents/${path}?ref=${ref}`,
  );
  if (res.status !== 200) {
    throw new Error(`failed to read "${path}" on "${ref}": HTTP ${res.status}`);
  }
  return Buffer.from(res.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

/** The files directly under `dir` on `branch`; empty when the folder does not exist there. */
export async function listFilesOnBranch(
  branch: string,
  dir: string,
  options: GitHubOptions,
): Promise<Array<{ path: string; content: string }>> {
  const list = await githubRequest<Array<{ path: string; type: string }>>(
    options,
    'GET',
    `/contents/${dir}?ref=${branch}`,
  );
  if (list.status === 404) return [];
  if (list.status !== 200) {
    throw new Error(`failed to list "${dir}" on "${branch}": HTTP ${list.status}`);
  }
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of list.data.filter((e) => e.type === 'file' && e.path.endsWith('.yaml'))) {
    files.push({ path: entry.path, content: await readFileAt(entry.path, branch, options) });
  }
  return files;
}

/**
 * The YAML files a PR adds or changes under any of `dirs`, read at the PR's
 * head commit — which stays readable after a closed PR's branch is deleted.
 */
export async function listPrYamlFiles(
  pr: number,
  headSha: string,
  dirs: readonly string[],
  options: GitHubOptions,
): Promise<Array<{ path: string; content: string }>> {
  const res = await githubRequest<Array<{ filename: string; status: string }>>(
    options,
    'GET',
    `/pulls/${pr}/files?per_page=100`,
  );
  if (res.status !== 200) {
    throw new Error(`failed to list the files of PR #${pr}: HTTP ${res.status}`);
  }
  const files: Array<{ path: string; content: string }> = [];
  for (const f of res.data) {
    if (f.status === 'removed' || !f.filename.endsWith('.yaml')) continue;
    if (!dirs.some((d) => f.filename.startsWith(d))) continue;
    files.push({ path: f.filename, content: await readFileAt(f.filename, headSha, options) });
  }
  return files;
}

export interface ClosedPrSummary {
  number: number;
  headRef: string;
  headSha: string;
}

/** Pages of closed PRs read at most; 100 each. */
const CLOSED_PR_PAGES = 10;

/** PRs on `discovery/*` branches that were closed without being merged: rejected by a reviewer. */
export async function listRejectedDiscoveryPrs(options: GitHubOptions): Promise<ClosedPrSummary[]> {
  const rejected: ClosedPrSummary[] = [];
  for (let page = 1; page <= CLOSED_PR_PAGES; page += 1) {
    const res = await githubRequest<
      Array<{ number: number; merged_at: string | null; head: { ref: string; sha: string } }>
    >(options, 'GET', `/pulls?state=closed&per_page=100&page=${page}`);
    if (res.status !== 200) {
      throw new Error(`failed to list closed pull requests: HTTP ${res.status}`);
    }
    for (const pr of res.data) {
      if (pr.merged_at === null && pr.head.ref.startsWith('discovery/')) {
        rejected.push({ number: pr.number, headRef: pr.head.ref, headSha: pr.head.sha });
      }
    }
    if (res.data.length < 100) break;
  }
  return rejected;
}

export async function createBranch(
  branch: string,
  fromSha: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'POST', '/git/refs', {
    ref: `refs/heads/${branch}`,
    sha: fromSha,
  });
  if (res.status !== 201) {
    throw new Error(`failed to create branch "${branch}": HTTP ${res.status}`);
  }
}

interface ContentsInfo {
  sha: string;
  content?: string;
}

/**
 * Skips the commit entirely when the branch already has this exact content
 * at this path — otherwise a rerun that re-extracts an unchanged candidate
 * would commit an identical file every time and reset `added`
 * over whatever a reviewer already edited on the PR (final
 * review finding I4). GitHub's Contents API returns `content` base64-
 * encoded with embedded newlines every ~60 characters, hence the strip
 * before decoding.
 */
export async function putFile(
  branch: string,
  path: string,
  content: string,
  message: string,
  options: GitHubOptions,
): Promise<void> {
  const existing = await githubRequest<ContentsInfo>(
    options,
    'GET',
    `/contents/${path}?ref=${branch}`,
  );
  const sha = existing.status === 200 ? existing.data.sha : undefined;
  if (
    existing.status === 200 &&
    typeof existing.data.content === 'string' &&
    Buffer.from(existing.data.content.replace(/\s/g, ''), 'base64').toString('utf8') === content
  ) {
    return;
  }
  const res = await githubRequest(options, 'PUT', `/contents/${path}`, {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`failed to write "${path}" on branch "${branch}": HTTP ${res.status}`);
  }
}

export async function openPr(
  branch: string,
  base: string,
  title: string,
  body: string,
  options: GitHubOptions,
): Promise<{ number: number }> {
  const res = await githubRequest<{ number: number }>(options, 'POST', '/pulls', {
    title,
    head: branch,
    base,
    body,
  });
  if (res.status !== 201) {
    throw new Error(`failed to open pull request from "${branch}": HTTP ${res.status}`);
  }
  return { number: res.data.number };
}

export async function updatePrBody(
  prNumber: number,
  body: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'PATCH', `/pulls/${prNumber}`, { body });
  if (res.status !== 200) {
    throw new Error(`failed to update pull request #${prNumber}: HTTP ${res.status}`);
  }
}

export async function addLabel(
  prNumber: number,
  label: string,
  options: GitHubOptions,
): Promise<void> {
  const res = await githubRequest(options, 'POST', `/issues/${prNumber}/labels`, {
    labels: [label],
  });
  if (res.status !== 200) {
    throw new Error(`failed to label pull request #${prNumber}: HTTP ${res.status}`);
  }
}

export interface OpenPrSummary {
  number: number;
  headRef: string;
  headSha: string;
  body: string;
  labels: string[];
}

interface PullListItem {
  number: number;
  body: string | null;
  head: { ref: string; sha: string };
  labels: Array<{ name: string }>;
}

/**
 * Open PRs on branches this agent itself creates (`discovery/*`) — never
 * touches a human-authored PR, however it's labelled. 100 is GitHub's max
 * page size; the discovery agent's own `MAX_PRS` cap keeps the open backlog
 * well under that in practice, so a second page is never needed.
 */
export async function listOpenDiscoveryPrs(options: GitHubOptions): Promise<OpenPrSummary[]> {
  const res = await githubRequest<PullListItem[]>(options, 'GET', '/pulls?state=open&per_page=100');
  if (res.status !== 200) {
    throw new Error(`failed to list open pull requests: HTTP ${res.status}`);
  }
  return res.data
    .filter((pr) => pr.head.ref.startsWith('discovery/'))
    .map((pr) => ({
      number: pr.number,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      body: pr.body ?? '',
      labels: pr.labels.map((l) => l.name),
    }));
}

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

/**
 * The check-run conclusions for one commit — `Map` keyed by check name, so
 * a caller can ask "did *this specific* check pass" without caring about
 * checks it doesn't gate on (e.g. the Cloudflare Workers Build preview, or
 * the always-passing link-check job).
 */
export async function getCheckRunConclusions(
  sha: string,
  options: GitHubOptions,
): Promise<Map<string, string | null>> {
  const res = await githubRequest<{ check_runs: CheckRun[] }>(
    options,
    'GET',
    `/commits/${sha}/check-runs?per_page=100`,
  );
  if (res.status !== 200) {
    throw new Error(`failed to read check runs for ${sha}: HTTP ${res.status}`);
  }
  const conclusions = new Map<string, string | null>();
  for (const run of res.data.check_runs) conclusions.set(run.name, run.conclusion);
  return conclusions;
}

/**
 * Merges a PR, but only while its head is still `sha` — the commit whose
 * checks the caller looked at — so a push after that check is never merged
 * unseen. Returns undefined on success, else why GitHub refused (405: not
 * mergeable, e.g. a conflict; 409: the head moved).
 */
export async function mergePr(
  prNumber: number,
  sha: string,
  options: GitHubOptions,
): Promise<string | undefined> {
  const res = await githubRequest<{ message?: string }>(
    options,
    'PUT',
    `/pulls/${prNumber}/merge`,
    {
      sha,
      merge_method: 'merge',
    },
  );
  if (res.status === 200) return undefined;
  if (res.status === 405 || res.status === 409) {
    return `merge refused: HTTP ${res.status}${res.data?.message ? ` (${res.data.message})` : ''}`;
  }
  throw new Error(`failed to merge pull request #${prNumber}: HTTP ${res.status}`);
}

/** Which tracking issue a job reports to: each job owns one, so one job's clean run never closes another's. */
export interface FailureIssue {
  title: string;
  label: string;
  /** The body's first line, given the number of failures. */
  intro?: (count: number) => string;
}

const DISCOVERY_ISSUE: FailureIssue = {
  title: 'Discovery agent source failures',
  label: 'discovery-failures',
};

interface IssueSummary {
  number: number;
  title: string;
}

/**
 * Find-or-create-and-update-or-close, same shape as .github/workflows/links.yml's
 * tracking issue for dead links — the issue never multiplies across runs,
 * it just reflects the latest run's failures.
 */
export async function syncFailureIssue(
  errors: readonly { source: string; message: string }[],
  options: GitHubOptions,
  issue: FailureIssue = DISCOVERY_ISSUE,
): Promise<void> {
  const listRes = await githubRequest<IssueSummary[]>(
    options,
    'GET',
    `/issues?state=open&labels=${issue.label}`,
  );
  if (listRes.status !== 200) {
    throw new Error(`failed to list open issues: HTTP ${listRes.status}`);
  }
  const existing = listRes.data.find((i) => i.title === issue.title);

  if (errors.length === 0) {
    if (!existing) return;
    const res = await githubRequest(options, 'PATCH', `/issues/${existing.number}`, {
      state: 'closed',
      body: 'The latest run succeeded. Closing.',
    });
    if (res.status !== 200) {
      throw new Error(`failed to close issue #${existing.number}: HTTP ${res.status}`);
    }
    return;
  }

  const body = [
    issue.intro?.(errors.length) ??
      `The latest discovery run found ${errors.length} source(s) failing to fetch or extract:`,
    '',
    ...errors.map((e) => `- \`${e.source}\`: ${e.message}`),
  ].join('\n');

  if (existing) {
    const res = await githubRequest(options, 'PATCH', `/issues/${existing.number}`, {
      body,
      state: 'open',
    });
    if (res.status !== 200) {
      throw new Error(`failed to update issue #${existing.number}: HTTP ${res.status}`);
    }
    return;
  }

  const res = await githubRequest(options, 'POST', '/issues', {
    title: issue.title,
    body,
    labels: [issue.label],
  });
  if (res.status !== 201) {
    throw new Error(`failed to create the failure-tracking issue: HTTP ${res.status}`);
  }
}

/** Opens a new issue; for reports that are not a rolling tracking issue. */
export async function createIssue(
  title: string,
  body: string,
  labels: readonly string[],
  options: GitHubOptions,
): Promise<{ number: number }> {
  const res = await githubRequest<{ number: number }>(options, 'POST', '/issues', {
    title,
    body,
    labels,
  });
  if (res.status !== 201) throw new Error(`failed to create issue "${title}": HTTP ${res.status}`);
  return { number: res.data.number };
}
