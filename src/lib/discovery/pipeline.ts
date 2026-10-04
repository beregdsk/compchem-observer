import {
  FULL_TEXT_MAX,
  isLinklessMailingListPost,
  loadTopics,
  loadValidationContext,
  validateEvent,
  type ValidationContext,
} from '../validation';
import { compareISO, todayUTC, type ISODate } from '../dates';
import { validatePosition } from '../position-validation';
import type { RawEvent, RawPosition } from '../types';
import { draftFilePath, synthesizeDraft } from './draft';
import { cecamEventText, cecamEventUrl, fetchCecamEvents } from './cecam-client';
import {
  clip,
  extractEvent,
  extractEvents,
  type ExtractedFields,
  type ExtractOptions,
} from './extract-client';
import { keywordTopics } from './keyword-topics';
import { extractPosition, looksLikePosition } from './position-extract';
import { positionFilePath, synthesizePositionDraft } from './position-draft';
import { politeFetch, type FetchOptions } from './fetch';
import type { ExtractionInput } from './html';
import { extractionInputFromPage } from './parsers/page';
import {
  findAggregatorLinks,
  findEventPageLinks,
  findNextListingPage,
  findPositionLinks,
} from './parsers/listing';
import { parseFeedItems } from './parsers/rss';
import { parseGroupListing, type GroupLead } from './parsers/group-listing';
import { parseICalEvents, type ICalEvent } from './parsers/ical';
import { extractionInputsFromChannel } from './parsers/telegram';
import {
  fetchNewMailboxMessages,
  type MailboxCredentials,
  type ParsedMailMessage,
} from './mailbox-client';
import { loadSources, type Source } from './sources';
import { loadState, saveState, type PageState } from './state';

/**
 * Caps the text sent to the extraction model. A large or hostile page (or a
 * listing with many child pages) would otherwise be sent at full size, with
 * unbounded token cost and a real risk of a context-length failure from the
 * model. 8000 characters is generous for any real conference/workshop
 * page's readable content.
 */
const EXTRACTION_TEXT_LIMIT = 8000;
/** An inline listing carries many events in one page, so it gets more room. */
const LISTING_EXTRACTION_TEXT_LIMIT = 16000;

/**
 * Sources processed at once. A run is mostly waiting — on the per-host
 * politeness delay and on 20-60s LLM calls — so sources overlap well; kept
 * small because OpenRouter's free tier allows 20 requests a minute per
 * account, and extraction backs off on 429 rather than failing.
 */
const SOURCE_CONCURRENCY = 4;

/**
 * Pages of one paginated listing followed per run (the first included).
 * The per-source page cap still bounds the total; this bounds the crawl
 * of archives that run back for years.
 */
const MAX_LISTING_PAGES = 5;

function truncateForExtraction(text: string, limit = EXTRACTION_TEXT_LIMIT): string {
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * Generic anchor terms beyond data/topics.yaml's own vocabulary — a
 * prolific listing source (GRC's find-a-conference page covers every
 * discipline it runs, not just chemistry) can otherwise send hundreds of
 * pages with zero on-topic content to the extraction model. Kept
 * deliberately broad: a false negative here silently drops a page before
 * any human ever sees it, which is worse than an occasional wasted call
 * the model itself would have rejected anyway.
 */
const RELEVANCE_GENERIC_TERMS = [
  'computational chemistry',
  'theoretical chemistry',
  'quantum chemistry',
  'molecular simulation',
  'ab initio',
  'first principles',
  'first-principles',
  'chemistry',
  'chemical',
  // Russian stems: the Telegram channels in data/sources.yaml post in
  // Russian, and with English terms alone every one of their posts was
  // skipped as off-topic before the model saw it. Stems, so one covers
  // every inflection: "хими" — химия, химический; "квантов" — квантовый.
  'хими',
  'квантов',
  'молекуляр',
  'вычислительн',
  'моделировани',
  'суперкомпьют',
  // Other non-English sources: Italian/French (chimica, chimie), German
  // (Chemie), and Chinese/Japanese (化学 chemistry, 分子 molecule, 计算/計算
  // computation, 理论/理論 theory) — CJK has no word boundaries to miss.
  'chimi',
  'chemie',
  '化学',
  '分子',
  '计算',
  '計算',
  '理论',
  '理論',
];

function relevanceKeywords(topicSlugs: readonly string[]): string[] {
  return [...RELEVANCE_GENERIC_TERMS, ...topicSlugs.map((slug) => slug.replace(/-/g, ' '))];
}

/**
 * The text a calendar-feed event is re-extracted from when keywords alone
 * can't make a valid candidate of it: every field the feed carried, title
 * first, including the free-text location the model can split into
 * city/country.
 */
function icalExtractionText({ draft, location, description }: ICalEvent): string {
  return [
    draft.title,
    `Dates: ${draft.start_date} to ${draft.end_date}`,
    location ? `Location: ${location}` : 'Location: none given (online?)',
    `URL: ${draft.url}`,
    description ?? draft.description,
  ].join('\n');
}

function looksRelevant(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

export interface PipelineOptions {
  sourcesPath?: string;
  statePath: string;
  userAgent: string;
  maxPages: number;
  maxTokens: number;
  /**
   * Caps pages fetched from any single top-level source — a prolific
   * listing page (GRC's find-a-conference page discovered hundreds of
   * unrelated-discipline links in one run) must not be able to consume the
   * whole shared `maxPages` budget and starve every source after it.
   * Optional so existing callers don't need updating; defaults to 40.
   */
  maxPagesPerSource?: number;
  today?: ISODate;
  fetchImpl?: typeof fetch;
  /** See `FetchOptions.browserFetchImpl` — undefined in tests, so nothing launches a real browser. */
  browserFetchImpl?: (url: string, userAgent: string) => Promise<string>;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => Date;
  extract: Omit<ExtractOptions, 'topics'>;
  /** IMAP credentials for `kind: 'mailbox'` sources. Undefined disables them — see `case 'mailbox'` below. */
  mailbox?: MailboxCredentials;
  /**
   * Defaults to the real `fetchNewMailboxMessages` (unlike `browserFetchImpl`,
   * which has no internal default and is simply left unset in every test) —
   * a mailbox source only ever runs when `mailbox` credentials are present,
   * so there is no risk of a test accidentally dialing out; defaulting here
   * means a real deployment can't silently no-op a configured mailbox by
   * forgetting to pass this. Tests that do want to fake it override it.
   */
  mailboxFetchImpl?: typeof fetchNewMailboxMessages;
  log?: (message: string) => void;
}

/** Pages one source has fetched so far, against `maxPagesPerSource`. */
interface SourceBudget {
  pagesFetched: number;
}

/** A position the pipeline accepted, with the extractor's confidence (no classifier runs on positions). */
export interface PositionCandidate {
  draft: RawPosition;
  confidence: number;
}

export interface PipelineResult {
  candidates: RawEvent[];
  /** Accepted position adverts from RSS, Telegram and mailbox items; see `processInput`'s `'post'` mode. */
  positions: PositionCandidate[];
  errors: Array<{ source: string; message: string }>;
  tokensUsed: number;
  /** Leads from `group-listing` sources, for the groups pass. */
  groupLeads: GroupLead[];
  /** Pages fetched this run, so the groups pass can take only what is left of `maxPages`. */
  pagesFetched: number;
  /**
   * Rolls back, and saves, the state of every page or mailbox message the
   * given candidates came from, so the next run fetches and extracts them
   * again. For candidates a later step never got to handle (see
   * `OrchestratorResult.deferred`): the state file is saved before that
   * step runs, and would otherwise record them as done.
   */
  requeue(candidateIds: readonly string[]): void;
}

/** Fetches every source in data/sources.yaml, extracts and validates candidates. Never opens a PR. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const sources = loadSources(options.sourcesPath);
  const state = loadState(options.statePath);
  const today = options.today ?? todayUTC();
  // The mailing lists are this run's own mailbox sources, which tests swap out.
  const ctx: ValidationContext = {
    ...loadValidationContext('.', today),
    mailingListUrls: new Set(sources.filter((s) => s.kind === 'mailbox').map((s) => s.url)),
  };
  const log = options.log ?? (() => {});
  const keywords = relevanceKeywords([...ctx.topics]);
  const vocabulary = loadTopics();
  let tokensUsed = 0;
  const extractOptions: ExtractOptions = {
    ...options.extract,
    topics: [...ctx.topics],
    onUsage: (tokens) => {
      tokensUsed += tokens;
    },
  };

  const candidates: RawEvent[] = [];
  const positions: PositionCandidate[] = [];
  /** Candidate id → the `state.pages` keys it was extracted from. */
  const origins = new Map<string, Set<string>>();
  /** `state.pages` key → its value before this run touched it, for `requeue`. */
  const previousStates = new Map<string, PageState | undefined>();
  const errors: Array<{ source: string; message: string }> = [];
  const groupLeads: GroupLead[] = [];
  let pagesFetched = 0;
  /** URLs already fetched (or being fetched) this run, by any source. */
  const claimedUrls = new Set<string>();
  const maxPagesPerSource = options.maxPagesPerSource ?? 40;

  const fetchOpts: FetchOptions = {
    state,
    userAgent: options.userAgent,
    fetchImpl: options.fetchImpl,
    browserFetchImpl: options.browserFetchImpl,
    sleepImpl: options.sleepImpl,
    now: options.now,
  };

  /**
   * Budgets are reserved before the fetch and released if it doesn't
   * produce a page, so sources running concurrently can't all pass the
   * check and overshoot `maxPages` together. A URL another source already
   * fetched this run is skipped, as a second fetch would only have found
   * it unchanged.
   */
  async function fetchPage(url: string, source: SourceBudget): Promise<string | undefined> {
    if (claimedUrls.has(url)) {
      log(`already fetched this run: ${url}`);
      return undefined;
    }
    if (pagesFetched >= options.maxPages) {
      log(`max pages (${options.maxPages}) reached, skipping ${url}`);
      return undefined;
    }
    if (source.pagesFetched >= maxPagesPerSource) {
      log(`max pages per source (${maxPagesPerSource}) reached, skipping ${url}`);
      return undefined;
    }
    claimedUrls.add(url);
    pagesFetched += 1;
    source.pagesFetched += 1;
    const result = await politeFetch(url, fetchOpts);
    if (result.status === 'fetched') return result.body;
    pagesFetched -= 1;
    source.pagesFetched -= 1;
    if (result.status === 'unchanged') log(`unchanged: ${url}`);
    else if (result.status === 'skipped') log(`skipped (${result.reason}): ${url}`);
    else log(`error fetching ${url}: ${result.error}`);
    return undefined;
  }

  function validationErrors(draft: RawEvent): string[] {
    return validateEvent({ file: draftFilePath(draft), data: draft }, ctx).errors.map(
      (e) => e.message,
    );
  }

  function addCandidate(draft: RawEvent, origin: string): void {
    candidates.push(draft);
    const keys = origins.get(draft.id) ?? new Set<string>();
    keys.add(origin);
    origins.set(draft.id, keys);
  }

  function acceptDraft(draft: RawEvent, sourceUrl: string, origin: string): void {
    // The archive keeps past events, so validation allows them — but
    // discovery only proposes upcoming ones. Listings (CCL's especially)
    // still carry long-finished entries, and models extract them anyway.
    if (compareISO(draft.end_date, today) < 0) {
      log(`skipping past event from ${sourceUrl}: ${draft.title} (ended ${draft.end_date})`);
      return;
    }
    const errors = validationErrors(draft);
    if (errors.length > 0) {
      log(`dropped candidate from ${sourceUrl}: ${errors.join('; ')}`);
      return;
    }
    addCandidate(draft, origin);
  }

  function acceptPosition(draft: RawPosition, confidence: number, origin: string): void {
    if (draft.deadline && compareISO(draft.deadline, today) < 0) {
      log(
        `skipping closed position from ${draft.source_url}: ${draft.title} (deadline ${draft.deadline})`,
      );
      return;
    }
    const errors = validatePosition({ file: positionFilePath(draft), data: draft }, ctx).errors;
    if (errors.length > 0) {
      log(`dropped position from ${draft.source_url}: ${errors.map((e) => e.message).join('; ')}`);
      return;
    }
    positions.push({ draft, confidence });
    const keys = origins.get(draft.id) ?? new Set<string>();
    keys.add(origin);
    origins.set(draft.id, keys);
  }

  /**
   * A mailing-list post that linked no page of its own has nowhere else to
   * read it, so its full text becomes the description, tidied of trailing
   * spaces and runs of blank lines.
   */
  function withFullPostText<T extends RawEvent | RawPosition>(draft: T, text: string): T {
    if (!isLinklessMailingListPost(draft, ctx)) return draft;
    const tidy = text
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { ...draft, description: clip(tidy, FULL_TEXT_MAX) };
  }

  function draftFromFields(fields: ExtractedFields, sourceUrl: string): RawEvent {
    return synthesizeDraft(
      {
        title: fields.title,
        original_title: fields.original_title,
        type: fields.type,
        start_date: fields.start_date,
        end_date: fields.end_date,
        format: fields.format,
        location: fields.location,
        // The model may honestly have no canonical event URL to report
        // (never fabricated) — fall back to the URL the pipeline itself
        // fetched this content from, the same value already used for
        // source_url.
        url: fields.url ?? sourceUrl,
        source_url: sourceUrl,
        organizer: fields.organizer,
        cost: fields.cost,
        fee: fields.fee,
        // The model may pick nothing from the vocabulary (or only
        // off-vocabulary entries, which extractEvent drops); keywords over
        // its own title and summary are a better answer than a dropped event.
        topics:
          fields.topics.length > 0
            ? fields.topics
            : keywordTopics(`${fields.title} ${fields.description}`, vocabulary),
        description: fields.description,
      },
      today,
    );
  }

  /**
   * A single item's extraction/validation failure (a transient LLM API
   * failure, a malformed completion, a context-length error — all routine,
   * expected occurrences) is caught here, logged with enough detail to
   * identify which URL it was, and never rethrown: it must not abort
   * sibling items from the same fetched body, and must not be recorded in
   * `PipelineResult.errors` (that's reserved for genuinely unexpected
   * failures). Returns `false` only for such a real error — "no event
   * found" and "dropped by validation" are normal outcomes and return
   * `true`, same as success, so the caller knows whether it's safe to
   * commit this fetch's page state.
   *
   * `origin` is the `state.pages` key whose fetch produced `input`, which
   * may differ from `input.sourceUrl` (a feed item, a mailbox message).
   *
   * `mode: 'listing'` treats the text as an inline listing: every event it
   * states is extracted in one call, and each becomes its own candidate.
   *
   * `mode: 'post'` is a single item from a feed, channel or mailbox: likely
   * job adverts go to the position extractor first, and only fall through to
   * event extraction when it finds no position.
   */
  async function processInput(
    input: ExtractionInput,
    origin: string,
    mode: 'single' | 'listing' | 'post' = 'single',
  ): Promise<boolean> {
    if (tokensUsed >= options.maxTokens) {
      log(`max tokens (${options.maxTokens}) reached, skipping ${input.sourceUrl}`);
      // Unlike "no event found" or "dropped by validation", this item was
      // never actually looked at — its page state must not commit, or a
      // future run sees the page as unchanged and never retries it,
      // silently losing the event. See fetchAndProcess's doc comment.
      return false;
    }
    if (!looksRelevant(input.text, keywords)) {
      log(`skipping (off-topic): ${input.sourceUrl}`);
      // A genuine "nothing here" outcome, same as "no event found" from
      // the model itself — the page state commits normally.
      return true;
    }
    try {
      if (mode === 'post' && looksLikePosition(input.text)) {
        const position = await extractPosition(truncateForExtraction(input.text), extractOptions);
        if (position) {
          const topics =
            position.topics.length > 0
              ? position.topics
              : keywordTopics(`${position.title} ${position.description}`, vocabulary);
          acceptPosition(
            withFullPostText(
              synthesizePositionDraft(position, input.sourceUrl, topics, today),
              input.text,
            ),
            position.confidence,
            origin,
          );
          log(`position found in ${input.sourceUrl}; event extraction skipped`);
          return true;
        }
      }
      const found =
        mode !== 'listing'
          ? [await extractEvent(truncateForExtraction(input.text), extractOptions)]
          : await extractEvents(
              truncateForExtraction(input.text, LISTING_EXTRACTION_TEXT_LIMIT),
              extractOptions,
            );
      for (const fields of found) {
        if (fields) {
          acceptDraft(
            withFullPostText(draftFromFields(fields, input.sourceUrl), input.text),
            input.sourceUrl,
            origin,
          );
        }
      }
      return true;
    } catch (err) {
      log(
        `extraction failed for ${input.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  function capturePageState(url: string): PageState | undefined {
    const existing = state.pages[url];
    return existing ? { ...existing } : undefined;
  }

  function restorePageState(url: string, previous: PageState | undefined): void {
    if (previous === undefined) delete state.pages[url];
    else state.pages[url] = previous;
  }

  /**
   * Fetches `url` and, if a body came back, runs `process` over it.
   * `politeFetch` (via `fetchPage`) writes the new etag/contentHash/
   * fetchedAt into `state.pages[url]` as soon as the body arrives, before
   * anything is extracted or validated. If `process` throws (a genuinely
   * unexpected failure) or reports that some item from this body could not
   * be fully processed (returns `false`), that write is rolled back to
   * whatever `state.pages[url]` was before this call — so a future run
   * re-fetches and retries instead of treating the URL as permanently
   * "seen" from a fetch whose content was never fully handled. A normal
   * empty/no-event/dropped-by-validation outcome is not an error and
   * commits the new fetch state as usual.
   */
  async function fetchAndProcess(
    url: string,
    budget: SourceBudget,
    process: (body: string) => Promise<boolean>,
  ): Promise<void> {
    const previous = capturePageState(url);
    const body = await fetchPage(url, budget);
    if (body === undefined) return;
    previousStates.set(url, previous);
    let ok: boolean;
    try {
      ok = await process(body);
    } catch (err) {
      restorePageState(url, previous);
      throw err;
    }
    if (!ok) restorePageState(url, previous);
  }

  async function processSource(source: Source): Promise<void> {
    const budget: SourceBudget = { pagesFetched: 0 };
    switch (source.kind) {
      case 'ical': {
        // A feed carries no topics, and the schema requires at least one;
        // nor a structured location, which an in-person event requires.
        // Keywords first — free, no LLM call. Only an event that still
        // isn't a valid candidate goes to the model, as the same
        // hostile-text extraction as any page (relevance pre-filter included).
        await fetchAndProcess(source.url, budget, async (body) => {
          let allOk = true;
          for (const event of parseICalEvents(body, source.url, today)) {
            const { draft } = event;
            const keyed = {
              ...draft,
              topics: keywordTopics(`${draft.title} ${event.description ?? ''}`, vocabulary),
            };
            if (keyed.topics.length > 0 && validationErrors(keyed).length === 0) {
              addCandidate(keyed, source.url);
            } else if (
              !(await processInput(
                { text: icalExtractionText(event), sourceUrl: source.url },
                source.url,
              ))
            ) {
              allOk = false;
            }
          }
          return allOk;
        });
        return;
      }
      case 'rss': {
        await fetchAndProcess(source.url, budget, async (body) => {
          let allOk = true;
          for (const input of parseFeedItems(body, source.url)) {
            if (!(await processInput(input, source.url, 'post'))) allOk = false;
          }
          return allOk;
        });
        return;
      }
      case 'event-page': {
        await fetchAndProcess(source.url, budget, (body) =>
          processInput(extractionInputFromPage(body, source.url), source.url),
        );
        return;
      }
      case 'inline-listing': {
        await fetchAndProcess(source.url, budget, (body) =>
          processInput(extractionInputFromPage(body, source.url), source.url, 'listing'),
        );
        return;
      }
      case 'cecam-api': {
        // The API supplies what the event page, rendered without
        // JavaScript, lacks (dates, organisers); the page supplies the
        // description. Each event page is fetched politely and its state
        // kept like any other page, so an event already handled is
        // "unchanged" next run and not re-extracted.
        for (const event of await fetchCecamEvents(options.userAgent, options.fetchImpl)) {
          const url = cecamEventUrl(event);
          await fetchAndProcess(url, budget, (body) =>
            processInput(
              {
                text: `${cecamEventText(event)}\n\n${extractionInputFromPage(body, url).text}`,
                sourceUrl: url,
              },
              url,
            ),
          );
        }
        return;
      }
      case 'listing-page':
      case 'mailing-list-archive': {
        // Page 1, then each `rel="next"` page in turn. An unchanged (or
        // failed) page stops the walk: later pages only shift when page 1
        // gains a post, so they are unchanged too.
        let listingUrl: string | undefined = source.url;
        for (let n = 0; listingUrl && n < MAX_LISTING_PAGES; n++) {
          const current: string = listingUrl;
          listingUrl = undefined;
          await fetchAndProcess(current, budget, async (body) => {
            for (const link of findEventPageLinks(body, current)) {
              await fetchAndProcess(link, budget, (pageBody) =>
                processInput(extractionInputFromPage(pageBody, link), link),
              );
            }
            listingUrl = findNextListingPage(body, current);
            // A child page's own failure is handled (and retried) at that
            // child's own URL via the nested fetchAndProcess above; it does
            // not make the listing page itself un-"seen".
            return true;
          });
        }
        return;
      }
      case 'aggregator': {
        // Another site's curated list: only the official pages it links to
        // are extracted, so every candidate's url and source_url is the
        // event's own page, never the aggregator.
        await fetchAndProcess(source.url, budget, async (body) => {
          for (const link of findAggregatorLinks(body, source.url)) {
            await fetchAndProcess(link, budget, (pageBody) =>
              processInput(extractionInputFromPage(pageBody, link), link),
            );
          }
          return true;
        });
        return;
      }
      case 'position-listing': {
        // A job board: each advert page is a post (position gate first,
        // falling through to event extraction), fetched once and then left
        // alone by the usual unchanged-page state.
        await fetchAndProcess(source.url, budget, async (body) => {
          for (const link of findPositionLinks(body, source.url, today)) {
            await fetchAndProcess(link, budget, (pageBody) =>
              processInput(extractionInputFromPage(pageBody, link), link, 'post'),
            );
          }
          return true;
        });
        return;
      }
      case 'group-listing': {
        // Fetched every run (force): the leads it holds are resolved a few
        // per run under MAX_SEARCHES, so an unchanged page still has work.
        const result = await politeFetch(source.url, { ...fetchOpts, force: true });
        if (result.status === 'fetched') {
          pagesFetched += 1;
          groupLeads.push(...parseGroupListing(result.body, source.url));
        } else if (result.status === 'error') {
          errors.push({ source: source.url, message: result.error });
        }
        return;
      }
      case 'telegram-channel': {
        await fetchAndProcess(source.url, budget, async (body) => {
          let allOk = true;
          for (const input of extractionInputsFromChannel(body)) {
            if (!(await processInput(input, source.url, 'post'))) allOk = false;
          }
          return allOk;
        });
        return;
      }
      case 'mailbox': {
        if (!options.mailbox) {
          log(`mailbox source "${source.name}" has no IMAP credentials configured, skipping`);
          return;
        }
        // Defaults to 'discovery', not INBOX: a dedicated account's mail
        // filters route every mailing list's traffic into one shared
        // label/folder rather than a distinct one per list — see
        // docs/discovery-agent.md's *Mailing lists* section.
        const folder = source.folder ?? 'discovery';
        const fetchImpl = options.mailboxFetchImpl ?? fetchNewMailboxMessages;
        const alreadySeen = (messageId: string) =>
          state.pages[`mailbox:${folder}:${messageId}`] !== undefined;

        let messages: ParsedMailMessage[];
        try {
          messages = await fetchImpl(options.mailbox, folder, alreadySeen);
        } catch (err) {
          errors.push({
            source: source.url,
            message: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        // Each message is a synthetic "page" keyed by its Message-ID, reusing
        // the same capture/restore idempotence as a real fetched page: a
        // transient extraction failure rolls back and retries next run, but
        // once fully handled (accepted, dropped, or off-topic) a message
        // stays seen forever — Message-IDs are permanent, unlike page content.
        for (const message of messages) {
          const url = `mailbox:${folder}:${message.messageId}`;
          const previous = capturePageState(url);
          previousStates.set(url, previous);
          state.pages[url] = { fetchedAt: new Date().toISOString() };
          let ok: boolean;
          try {
            // A mailing-list message is exactly as hostile as a web page —
            // same extraction pipeline, no exceptions. `sourceUrl` is the
            // source's own info page (not this message specifically): unlike
            // every other kind, a post has no per-message URL of its own,
            // and the schema requires source_url to be https://. This is
            // safe because source_url is only used for the blocklist host
            // check and PR-body display, never for dedup identity.
            ok = await processInput({ text: message.text, sourceUrl: source.url }, url, 'post');
          } catch (err) {
            restorePageState(url, previous);
            throw err;
          }
          if (!ok) restorePageState(url, previous);
        }
        return;
      }
    }
  }

  // A fixed pool of workers pulling from one queue: at most
  // SOURCE_CONCURRENCY sources in flight, each started as soon as a slot frees.
  const queue = [...sources];
  async function worker(): Promise<void> {
    for (let source = queue.shift(); source; source = queue.shift()) {
      try {
        await processSource(source);
      } catch (err) {
        errors.push({
          source: source.url,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: SOURCE_CONCURRENCY }, worker));

  saveState(options.statePath, state);

  function requeue(candidateIds: readonly string[]): void {
    for (const id of candidateIds) {
      for (const key of origins.get(id) ?? []) {
        if (previousStates.has(key)) restorePageState(key, previousStates.get(key));
      }
    }
    saveState(options.statePath, state);
  }

  return { candidates, positions, errors, tokensUsed, groupLeads, pagesFetched, requeue };
}
