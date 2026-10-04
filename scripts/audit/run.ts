#!/usr/bin/env node
// The daily data audit: checks a slice of the entries on main against their
// own pages and opens one PR with the fixes, listing what needs a human.
// See "Data audit" in docs/discovery-agent.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { todayUTC } from '../../src/lib/dates';
import { readGroupFiles } from '../../src/lib/group-validation';
import { readPositionFiles } from '../../src/lib/position-validation';
import { loadValidationContext } from '../../src/lib/validation';
import {
  buildAuditPrBody,
  loadAuditState,
  runAudit,
  saveAuditState,
  type AuditEntry,
  type AuditKind,
} from '../../src/lib/discovery/audit';
import {
  createIssue,
  getBranchStatus,
  syncFailureIssue,
  type FailureIssue,
} from '../../src/lib/discovery/github-client';
import { Proposer } from '../../src/lib/discovery/propose';
import { buildConfig } from '../discovery/config';
import { readEventFiles } from '../validate';

const AUDIT_FAILURES: FailureIssue = {
  title: 'Data audit failures',
  label: 'audit-failures',
  intro: (n) => `The latest data audit could not check ${n} entr${n === 1 ? 'y' : 'ies'}:`,
};

export interface AuditArgs {
  maxEntries: number;
  /** A file listing entry paths, one per line, to audit whether or not they are due. */
  files?: string;
  model?: string;
  dryRun: boolean;
}

export function parseAuditArgs(argv: string[]): AuditArgs {
  const args: AuditArgs = { maxEntries: 40, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--dry-run') {
      args.dryRun = true;
    } else if (flag === '--model') {
      const value = argv[++i];
      if (!value) throw new Error('--model needs a model id');
      args.model = value;
    } else if (flag === '--files') {
      const value = argv[++i];
      if (!value) throw new Error('--files needs a file of entry paths');
      args.files = value;
    } else if (flag === '--max-entries') {
      const value = argv[++i];
      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        throw new Error(`--max-entries needs a positive integer, got "${value ?? ''}"`);
      }
      args.maxEntries = Number(value);
    } else {
      throw new Error(`unknown argument "${flag}"`);
    }
  }
  return args;
}

function readOnlyList(path: string): Set<string> {
  return new Set(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

function readEntries(): AuditEntry[] {
  const tag = (kind: AuditKind) => (f: { file: string; data: unknown }) =>
    ({ ...f, kind, data: f.data as Record<string, unknown> }) as AuditEntry;
  return [
    ...readEventFiles().map(tag('event')),
    ...readPositionFiles().map(tag('position')),
    ...readGroupFiles().map(tag('group')),
  ];
}

async function main(): Promise<void> {
  const args = parseAuditArgs(process.argv.slice(2));
  const resolved = buildConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  const cfg = resolved.config;
  const log = (message: string) => console.error(message);
  const today = todayUTC();
  const ctx = loadValidationContext('.', today);
  const statePath =
    process.env.AUDIT_STATE_PATH ?? join(dirname(cfg.statePath), 'audit-state.json');
  const state = loadAuditState(statePath);

  const result = await runAudit({
    entries: readEntries(),
    state,
    ctx,
    extract: { ...cfg.extract, model: args.model ?? cfg.extract.model, topics: [...ctx.topics] },
    userAgent: cfg.userAgent,
    today,
    maxEntries: args.maxEntries,
    only: args.files ? readOnlyList(args.files) : undefined,
    log,
  });
  const body = buildAuditPrBody(result, today);

  if (args.dryRun) {
    console.log(body);
    for (const [path, content] of result.changed) console.log(`\n--- ${path}\n${content}`);
    return;
  }

  // Recorded first: a GitHub failure below must not make tomorrow's run pay
  // for the same model calls again; the findings are in the log either way.
  saveAuditState(statePath, state);
  log(body);

  if (result.changed.size > 0) {
    let n = 1;
    let branch = `audit/${today}-${n}`;
    while ((await getBranchStatus(branch, cfg.github)).exists) branch = `audit/${today}-${++n}`;
    const pr = await new Proposer(cfg.github).proposeBatch({
      branch,
      files: [...result.changed].map(([path, content]) => ({ path, content })),
      title: `Data audit: ${today}`,
      message: 'Fix entries flagged by the data audit',
      body,
      labels: ['needs-review', 'audit'],
    });
    log(`audit: ${pr.outcome} ${'pr' in pr ? `PR #${pr.pr}` : ''}`);
  } else if (result.findings.length > 0) {
    // Nothing to commit, so no PR can carry the report: an issue does.
    const issue = await createIssue(`Data audit: ${today}`, body, ['audit'], cfg.github);
    log(`audit: no fixes; opened issue #${issue.number}`);
  } else {
    log(`audit: ${result.audited} entries, nothing found`);
  }
  await syncFailureIssue(result.errors, cfg.github, AUDIT_FAILURES);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
