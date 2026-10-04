import { parse } from 'yaml';
import { POSSIBLE_DUPLICATE_LABEL } from './duplicates';
import {
  addLabel,
  getCheckRunConclusions,
  listOpenDiscoveryPrs,
  listPrYamlFiles,
  mergePr,
  type GitHubOptions,
} from './github-client';
import {
  formatProblems,
  loadValidationContext,
  readEventFiles,
  validateCollection,
  validateEvent,
  type EventFile,
  type ValidationContext,
  type ValidationResult,
} from '../validation';
import {
  POSITIONS_DIR,
  readPositionFiles,
  validatePosition,
  validatePositionCollection,
} from '../position-validation';
import {
  GROUPS_DIR,
  readGroupFiles,
  validateGroup,
  validateGroupCollection,
} from '../group-validation';

/** Matches `buildPrBody`'s own `Confidence: 0.93` line — see orchestrator.ts. */
const CONFIDENCE_LINE = /^Confidence: (\d+(?:\.\d+)?)$/m;

export function parseConfidence(prBody: string): number | undefined {
  const match = CONFIDENCE_LINE.exec(prBody);
  if (!match) return undefined;
  return Number(match[1]);
}

export const AUTO_APPROVE_THRESHOLD = 0.9;

/**
 * The checks this pass actually gates on. Deliberately excludes
 * `link-check` (ci.yml runs it as a warning only — `npm run check-links`
 * always exits 0, so it can never fail) and Cloudflare's `Workers Builds`
 * check (a deploy-preview build, not a signal about this candidate's own
 * correctness — see docs/discovery-agent.md for the difference).
 */
export const REQUIRED_CHECKS = ['check', 'e2e'] as const;

export const HIGH_CONFIDENCE_LABEL = 'high-confidence';

export interface AutoMergeResult {
  merged: number[];
  skipped: Array<{ number: number; reason: string }>;
}

interface Kind {
  dir: string;
  validate: (entry: EventFile, ctx: ValidationContext) => ValidationResult;
  validateCollection: (entries: EventFile[]) => ValidationResult;
  readMain: () => EventFile[];
}

const KINDS: Kind[] = [
  {
    dir: 'data/events/',
    validate: validateEvent,
    validateCollection: (entries) => validateCollection(entries, loadValidationContext()),
    readMain: () => readEventFiles(),
  },
  {
    dir: `${POSITIONS_DIR}/`,
    validate: validatePosition,
    validateCollection: validatePositionCollection,
    readMain: () => readPositionFiles(),
  },
  {
    dir: `${GROUPS_DIR}/`,
    validate: validateGroup,
    validateCollection: validateGroupCollection,
    readMain: () => readGroupFiles(),
  },
];

/**
 * A PR's data files checked against the validator in this checkout (main),
 * alone and beside main's own files. Its CI may have run before main's
 * validator got stricter, and merging it then would break main's build.
 * Returns the errors in the PR's own files, formatted.
 */
export function validatePrFiles(files: Array<{ path: string; content: string }>): string {
  const ctx = loadValidationContext();
  const errors: ValidationResult = { errors: [], warnings: [] };
  for (const kind of KINDS) {
    const own = files
      .filter((f) => f.path.startsWith(kind.dir))
      .map((f): EventFile => ({ file: f.path, data: parse(f.content) }));
    if (own.length === 0) continue;
    for (const entry of own) errors.errors.push(...kind.validate(entry, ctx).errors);
    const ownPaths = new Set(own.map((e) => e.file));
    const merged = [...kind.readMain().filter((e) => !ownPaths.has(e.file)), ...own];
    errors.errors.push(
      ...kind.validateCollection(merged).errors.filter((p) => ownPaths.has(p.file)),
    );
  }
  return formatProblems(errors);
}

/**
 * Merges open discovery PRs whose recorded confidence is at least
 * `AUTO_APPROVE_THRESHOLD`, whose `REQUIRED_CHECKS` all passed, that are
 * not labelled `possible-duplicate`, and whose files still pass this
 * checkout's validator. Each gets the `high-confidence` label first, so
 * auto-merged PRs stay findable; a PR GitHub refuses to merge (a conflict,
 * a new push) keeps the label and is retried on the next run.
 */
export async function autoMergeHighConfidencePrs(
  options: GitHubOptions & { log?: (message: string) => void },
): Promise<AutoMergeResult> {
  const log = options.log ?? (() => {});
  const merged: number[] = [];
  const skipped: Array<{ number: number; reason: string }> = [];

  const prs = await listOpenDiscoveryPrs(options);
  for (const pr of prs) {
    // A PR that may repeat another needs a human's eye whatever its confidence.
    if (pr.labels.includes(POSSIBLE_DUPLICATE_LABEL)) {
      skipped.push({ number: pr.number, reason: 'possible duplicate' });
      continue;
    }

    const confidence = parseConfidence(pr.body);
    if (confidence === undefined) {
      skipped.push({ number: pr.number, reason: 'could not parse confidence from PR body' });
      continue;
    }
    if (confidence < AUTO_APPROVE_THRESHOLD) {
      skipped.push({
        number: pr.number,
        reason: `confidence ${confidence.toFixed(2)} below threshold`,
      });
      continue;
    }

    const conclusions = await getCheckRunConclusions(pr.headSha, options);
    const failing = REQUIRED_CHECKS.filter((name) => conclusions.get(name) !== 'success');
    if (failing.length > 0) {
      skipped.push({ number: pr.number, reason: `checks not green: ${failing.join(', ')}` });
      continue;
    }

    const files = await listPrYamlFiles(
      pr.number,
      pr.headSha,
      KINDS.map((k) => k.dir),
      options,
    );
    const problems = validatePrFiles(files);
    if (problems) {
      skipped.push({ number: pr.number, reason: `fails main's validator:\n${problems}` });
      continue;
    }

    if (!pr.labels.includes(HIGH_CONFIDENCE_LABEL)) {
      await addLabel(pr.number, HIGH_CONFIDENCE_LABEL, options);
    }
    const refused = await mergePr(pr.number, pr.headSha, options);
    if (refused) {
      skipped.push({ number: pr.number, reason: refused });
      continue;
    }
    merged.push(pr.number);
    log(`merged PR #${pr.number} (confidence ${confidence.toFixed(2)})`);
  }

  return { merged, skipped };
}
