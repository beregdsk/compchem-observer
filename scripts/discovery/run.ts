#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { site } from '../../site.config';
import { loadEvents } from '../../src/lib/events';
import { loadGroups } from '../../src/lib/groups';
import { loadPositions } from '../../src/lib/positions';
import { loadValidationContext } from '../../src/lib/validation';
import { ADD_THRESHOLD } from '../../src/lib/discovery/classify-candidate';
import { fetchWithBrowser } from '../../src/lib/discovery/browser-fetch';
import { leadsFromEvents, leadsFromPositions } from '../../src/lib/discovery/group-match';
import { passLevelErrors, runGroupsPass } from '../../src/lib/discovery/groups-pass';
import { todayUTC } from '../../src/lib/dates';
import { runDiscoveryRun, type OrchestratorOptions } from '../../src/lib/discovery/orchestrator';
import { runPipeline, type PipelineOptions } from '../../src/lib/discovery/pipeline';
import { discoveryPrDrafts, type PrDrafts } from '../../src/lib/discovery/pr-drafts';
import { loadState, saveState } from '../../src/lib/discovery/state';
import { syncFailureIssue } from '../../src/lib/discovery/github-client';
import { autoMergeHighConfidencePrs } from '../../src/lib/discovery/auto-approve';

export { buildConfig, type ConfigResult, type ResolvedConfig } from './config';
import { buildConfig } from './config';
import { parseCrawlArgs, runGroupsCrawl, type GroupsCrawlResult } from './groups-crawl';

async function main(): Promise<void> {
  const resolved = buildConfig(process.env);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exitCode = 1;
    return;
  }
  const cfg = resolved.config;
  const log = (message: string) => console.error(message);

  const pipelineOptions: PipelineOptions = {
    statePath: cfg.statePath,
    userAgent: cfg.userAgent,
    maxPages: cfg.maxPages,
    maxPagesPerSource: cfg.maxPagesPerSource,
    maxTokens: cfg.maxTokens,
    extract: cfg.extract,
    browserFetchImpl: fetchWithBrowser,
    mailbox: cfg.mailbox,
    log,
  };
  const pipelineResult = await runPipeline(pipelineOptions);
  for (const error of pipelineResult.errors) log(`ERROR ${error.source}: ${error.message}`);

  // Drafts in open and rejected discovery PRs, for the duplicate checks. A
  // failure here is reported, and the run goes on checking against main only.
  const sourceErrors = [...pipelineResult.errors];
  const prState = loadState(cfg.statePath);
  let prDrafts: PrDrafts | undefined;
  try {
    prDrafts = await discoveryPrDrafts(cfg.github, prState);
    log(
      `duplicate checks include ${prDrafts.events.length} event and ${prDrafts.positions.length} position draft(s) from PRs`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sourceErrors.push({ source: 'pr-drafts', message });
    log(`ERROR pr-drafts: ${message}`);
  }

  const ctx = loadValidationContext();
  const orchestratorOptions: OrchestratorOptions = {
    candidates: pipelineResult.candidates,
    existingEvents: loadEvents({ includeFixtures: false }),
    blockedHosts: ctx.blockedHosts,
    classify: cfg.classify,
    github: cfg.github,
    sourceErrors,
    maxPrs: cfg.maxPrs,
    maxTokens: cfg.maxTokens,
    tokensUsedSoFar: pipelineResult.tokensUsed,
    positions: pipelineResult.positions,
    existingPositions: loadPositions({ includeFixtures: false }),
    prDrafts,
    log,
  };
  const result = await runDiscoveryRun(orchestratorOptions);
  // The pipeline saved its state before the orchestrator ran; without this,
  // a candidate cut off by MAX_TOKENS/MAX_PRS would never be seen again.
  pipelineResult.requeue(result.deferred);
  if (result.deferred.length > 0) log(`requeued ${result.deferred.length} deferred candidate(s)`);
  // requeue rewrote the state file from the pipeline's own copy; keep the
  // rejected PRs read above, so they are not fetched again next run.
  const latest = loadState(cfg.statePath);
  saveState(cfg.statePath, { ...latest, rejectedPrs: prState.rejectedPrs });

  const acceptedPositions = pipelineResult.positions
    .filter((p) => p.confidence >= ADD_THRESHOLD)
    .map((p) => p.draft);
  const groups = await runGroupsPass({
    leads: [
      ...leadsFromEvents(result.accepted),
      ...leadsFromPositions(acceptedPositions),
      ...pipelineResult.groupLeads,
    ],
    existingGroups: loadGroups({ includeFixtures: false }),
    statePath: cfg.statePath,
    fetch: { userAgent: cfg.userAgent, browserFetchImpl: fetchWithBrowser },
    extract: { ...cfg.extract, topics: [...ctx.topics] },
    github: cfg.github,
    maxSearches: cfg.maxSearches,
    maxPages: Math.max(0, cfg.maxPages - pipelineResult.pagesFetched),
    maxPrs: Math.max(0, cfg.maxPrs - result.prsOpened - result.prsUpdated),
    maxTokens: cfg.maxTokens,
    tokensUsedSoFar: result.tokensUsed,
    blockedHosts: ctx.blockedHosts,
    today: todayUTC(),
    log,
  });
  for (const error of groups.errors) log(`ERROR groups ${error.source}: ${error.message}`);
  // The orchestrator synced the tracking issue before the groups pass ran, so
  // a pass that failed as a whole is added by a second call (which replaces
  // the first's body). Per-name failures stay in the log and JSON only.
  const passErrors = passLevelErrors(groups.errors);
  if (passErrors.length > 0) {
    try {
      await syncFailureIssue([...sourceErrors, ...result.errors, ...passErrors], cfg.github);
    } catch (err) {
      log(`failed to sync the failure issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The groups crawler's nightly slice: small budgets, the free model, at
  // most one batch PR, skipped while a big crawl holds the lock.
  let crawl: GroupsCrawlResult | { status: 'failed'; error: string } | undefined;
  const prsLeft = Math.max(0, cfg.maxPrs - result.prsOpened - result.prsUpdated - groups.prsOpened);
  if (prsLeft > 0) {
    try {
      const dir = dirname(cfg.statePath);
      crawl = await runGroupsCrawl({
        github: cfg.github,
        extract: { ...cfg.extract, topics: [...ctx.topics] },
        fetch: { userAgent: cfg.userAgent, browserFetchImpl: fetchWithBrowser },
        statePath: cfg.statePath,
        crawlStatePath: process.env.CRAWL_STATE_PATH ?? join(dir, 'crawl-state.json'),
        lockPath: join(dir, 'crawl.lock'),
        today: todayUTC(),
        args: { ...parseCrawlArgs([]), maxPrs: Math.min(1, prsLeft) },
        maxTokens: cfg.maxTokens,
        blockedHosts: ctx.blockedHosts,
        openalex: { mailto: site.contactEmail, apiKey: process.env.OPENALEX_API_KEY || undefined },
        log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      crawl = { status: 'failed', error: message };
      log(`ERROR groups-crawl: ${message}`);
      try {
        await syncFailureIssue(
          [...sourceErrors, ...result.errors, ...passErrors, { source: 'groups-crawl', message }],
          cfg.github,
        );
      } catch (e) {
        log(`failed to sync the failure issue: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // A separate phase, deliberately run after and independent of the loop
  // above: it revisits *all* currently-open discovery PRs (not just this
  // run's candidates), since CI on a PR opened days ago finishes long after
  // the run that opened it has exited. Merges the ones that qualify; see
  // auto-approve.ts.
  const autoMerge = await autoMergeHighConfidencePrs({ ...cfg.github, log });

  console.log(JSON.stringify({ ...result, groups, crawl, autoMerge }, null, 2));
}

// Only run when invoked directly — see scripts/discovery/parse-sources.ts for
// why this compares full resolved file URLs rather than basenames.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
