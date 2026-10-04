# Discovery agent (follow-up, phase 5)

**Status: implemented.** All steps (load sources, fetch, extract, validate, deduplicate/screen, open a PR) exist: fetch/extract/validate is `src/lib/discovery/pipeline.ts`, deduplicate/screen is `src/lib/discovery/classify-candidate.ts`, and PR-opening is `src/lib/discovery/orchestrator.ts`, composed by the cron entrypoint `scripts/discovery/run.ts` — see *Deployment* below. Mailbox/IMAP ingestion (see *Mailing lists*) is also implemented (`src/lib/discovery/mailbox-client.ts`) and live: the mailbox account, its `discovery` folder, and the Psi-k subscription were all confirmed working end-to-end 2026-09-27 (see `data/sources.yaml`'s live `kind: mailbox` entry).

## Purpose

Find candidate events on known sources, extract them into the event schema, and open **pull requests for review**. A PR is merged automatically only when it clears the high-confidence bar below; everything else waits for a human.

## Where it runs

A small VDS owned by the maintainer, as a scheduled job (daily or weekly cron). It is a batch script, not a long-running service. It uses an external LLM API for extraction only, so no local model or GPU is needed.

## Pipeline

1. **Load sources** from `data/sources.yaml`: a list of `{name, url, kind, notes}` entries, where `kind` is one of `SOURCE_KINDS` in `src/lib/discovery/sources.ts` (see *Sources* below).
2. **Fetch** each source politely: identify with a User-Agent that includes the project URL and a contact address, honour `robots.txt`, rate-limit per host, cache with ETag or content hash, and skip unchanged pages (state in a local JSON or SQLite file, not in the repo).
3. **Find candidates**: extract links to event pages from listing pages, then fetch each new event page once.
4. **Extract**: send the page text to the LLM with a fixed prompt asking for JSON matching the event schema, plus a `confidence` value and the exact `source_url`. Use structured output or JSON mode where available.
5. **Validate**: run the output through `validateEvent` from `scripts/validate.ts`. Discard anything that fails, and log why.
6. **Deduplicate** against existing events and blocklist (same URL, or same title plus start date, or fuzzy title match on the same dates). Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
7. **Screen** against `docs/curation-policy.md`: apply the blocklist, and flag events with red-flag signals for the reviewer instead of silently dropping them. Implemented in `src/lib/discovery/classify-candidate.ts`; see `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`.
8. **Open a PR** on a branch named `discovery/YYYY-MM-DD`, one YAML file per candidate event, with a body listing for each event the source URL, confidence and any flags. Add the label `needs-review`. Set `added` to the run date.

## Security model

Web pages are hostile input. The extraction step must be unable to do anything except return JSON.

- The extraction call has **no tools**, no browsing, and no access to secrets beyond the API key. Page text is passed as clearly delimited data, and the prompt says instructions inside it must be ignored.
- Never execute, evaluate or render fetched content. Fetch text only.
- **One call has a tool.** The groups pass's search call uses OpenRouter's `web` plugin to find candidate homepages. Only the URLs in the response's `url_citation` annotations are used, filtered to public `https://` DNS names; the response text is discarded. Every page reached this way goes through the same no-tools extraction as any other page, as untrusted data, and the draft must pass schema validation. Search is billed to `LLM_API_KEY`, under its spending cap.
- Output is accepted only if it validates against the schema. Free-text fields are length-limited and stripped of markup.
- Run the job as an unprivileged user or in a container with no other credentials on the machine.
- **Credentials:** the LLM API key must have a spending cap set in the provider console. The GitHub token must be fine-grained, limited to this one repository, with only the permissions needed to push a branch, open a PR and file the failure-tracking issue (contents write, pull requests write, issues write). It must not be able to merge or change settings. Store both as environment variables or a root-only file, never in the repo.
- **Caps per run:** maximum pages fetched, maximum tokens, maximum PRs opened. The job stops and logs when any cap is hit.

## Configuration

All configuration by environment variables, validated by `scripts/discovery/run.ts`'s `buildConfig`, which fails fast with a clear message if any required value is missing or malformed:

| Variable | Required | Default |
|---|---|---|
| `LLM_API_KEY` | yes | — |
| `LLM_MODEL_EXTRACT` | yes (e.g. `dots-studio/dots-3-note-preview:free`) | — |
| `STATE_PATH` | yes | — |
| `GITHUB_TOKEN` | yes | — |
| `GITHUB_REPO` | yes (`owner/repo`) | — |
| `LLM_BASE_URL` | no | extraction (chat-completions) endpoint's default |
| `LLM_BASE_URL_CLASSIFY` | no | classification (Decisions API) endpoint's default — a different endpoint from `LLM_BASE_URL`, so proxying one does not proxy the other |
| `LLM_MODEL` | no | the classifier's own default model |
| `MAX_PAGES` | no | 200 |
| `MAX_TOKENS` | no | 500000 |
| `MAX_PRS` | no | 20 |
| `MAX_SEARCHES` | no | 20 |
| `IMAP_HOST` | no (all three or none — see below) | — |
| `IMAP_USER` | no | — |
| `IMAP_PASSWORD` | no | — |
| `IMAP_PORT` | no | 993 |
| `IMAP_SECURE` | no | `true` (anything but the literal string `false`) |

`IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD` must be set all together or not at all — setting only some fails fast (a likely typo), same as every other required-together value here. With none set (for example, a local dry run), every `kind: mailbox` source is skipped with a log line and nothing else about the run changes. The production deployment sets all three (see *Mailing lists*).

## Sources

`data/sources.yaml` holds them. The first seventeen entries were compiled and fetched on 2026-09-23, and more have been added since, each fetched first. That file documents its own format and keeps checked-but-unusable candidates in a commented block at the bottom. `npm run validate` checks it in CI (`validateSources` in `src/lib/discovery/sources.ts`): an unknown field or kind, a non-https or repeated url, or a missing `last_checked` fails the build, where `loadSources` would otherwise skip the entry silently at run time.

Three of the URLs this document originally suggested were already dead when the list was compiled (`cecam.org/workshop-list`, `molssi.org/events/`, `acscomp.org`), and `www.ictp.it` refuses a scripted user agent. Hence the rule in that file: every entry is fetched before it is added, and `last_checked` says when.

Several source kinds were added beyond the four the original version of this document listed:

- `inline-listing` — a page that lists several events as text rather than as links to per-event pages (CCL's announcements, CCPBioSim, the EuChemS division's conferences, SCM). The page's own text goes to the model once, in a listing mode that returns every in-field event it states; each is then validated and screened like any other candidate.
- `cecam-api` — CECAM's program, which its page renders in the browser from a JSON API (`src/lib/discovery/cecam-client.ts`). The API gives each event's dates and organisers; the event's own page, fetched like any other, gives its description, and both go to the model together.
- `aggregator` — another site's curated list of events (labinitio.org's conference list). Links to other hosts are followed (`findAggregatorLinks` in `src/lib/discovery/parsers/listing.ts`) and only those official pages are extracted; the aggregator's own text never reaches the model.
- `ical` — a calendar feed, parsed directly, since dates and titles arrive already typed. A feed carries no topics, so each event's topics come from keyword matches against `data/topics.yaml` (`src/lib/discovery/keyword-topics.ts`); only an event no keyword places goes to the extraction model, like any page. Telluride Science publishes one.
- `mailbox` — a list we are subscribed to, read over IMAP (`src/lib/discovery/mailbox-client.ts`). See below. Psi-k is the live entry.
- `telegram-channel` — a public channel, fetched at its anonymous web-preview path (`t.me/s/<channel>`, not `t.me/<channel>`, which redirects to the app). No login or bot token needed. Treat it like a listing-page: low precision, screen every post against `docs/curation-policy.md`. A post is exactly as hostile as a web page — same extraction pipeline in *Security model*, no exceptions. `data/sources.yaml` has a live example.

Other aggregators may be sources (kind `aggregator`): another site's curated
list points us at events, but only the pages it links to are fetched and
extracted, so every fact is rechecked on, and linked to, the event's
official page. None of the aggregator's own text is copied, and the
aggregator is recorded in neither `url` nor `source_url`.

## Mailing lists

Much of this field's event traffic moves by mailing list rather than by web page. Where a list has an open web archive, it is an ordinary source and needs nothing special: CCL's conference announcements are a plain public page and are listed as `listing-page`.

Where it does not, the archive is useless to us. Psi-k is the case that decided this. It used to mirror its list to a forum at `psi-k.net/wps-forums/events/`, and the sitemap advertised thousands of post URLs — but every one of them returned HTTP 200 serving the *homepage* to an anonymous fetch. The posts were login-gated, and the public RSS feed carried only a fraction of the traffic. (The list itself moved again in 2025, to JISCMail — see the commented note in `data/sources.yaml` — which changes nothing about the reasoning below: it is still an ordinary subscriber mailing list with no open archive.)

So for lists like Psi-k, **subscribe and read the mail**:

- A dedicated address subscribed to the lists, never the maintainer's personal mailbox, is the ideal — one account, one purpose, revocable. Where that's not practical (as deployed: a personal Gmail account, chosen after the phone-verification and OAuth-only walls hit on several dedicated-mailbox providers), the credential still grants full-mailbox access regardless of which folder the code reads — a filter that routes every list's mail into one shared `discovery` label/folder (see `data/sources.yaml`'s format comment) is the minimum substitute isolation, never reading INBOX directly.
- Read-only IMAP. The agent never sends, replies, deletes or marks. Credentials by environment variable (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`), alongside the others, and an app password rather than the account password where the provider offers one.
- **A message body is exactly as hostile as a web page.** It goes into the same extraction step, as clearly delimited data, with no tools and no ability to act — see *Security model*. Mail is in fact worse than a page: anyone can send to a list, and the `From` header is not evidence. Attachments and HTML parts are not fetched or rendered; take `text/plain` and fall back to stripped HTML.
- Deduplicate on `Message-ID`, and keep the same state file as the web sources. A list that cross-posts a CECAM workshop must not produce a second candidate.
- Everything else is unchanged: schema validation, blocklist, curation screening, one pull request for human review.

A post that links no page of its own (the model reports no `url`) has nowhere else for a reader to see it, so its full text, tidied of trailing spaces and blank-line runs, becomes the entry's `description` instead of a summary; cards show its opening and fold the rest into a "Full announcement" disclosure. This is the one exception to AGENTS.md rule 2, and the validator allows it only when `url` and `source_url` are both a `kind: mailbox` source's `url`.

Implemented as `src/lib/discovery/mailbox-client.ts` (IMAP + MIME parsing), wired into the `kind: 'mailbox'` case in `pipeline.ts`. It was deliberately cheap to add: just another text source feeding the same extract → validate → screen → PR pipeline. The mailbox account, its `discovery` folder and the Psi-k subscription were confirmed working end to end on 2026-09-27, and `data/sources.yaml` has the live `kind: mailbox` entry.

## Human review

Every discovered PR gets the `needs-review` label. Its body is the raw
candidate fields plus the classifier's confidence and per-criterion scores —
group PRs use the same layout, with where the name was found and which pages
were fetched folded into a "How it was found" section —
no separate checklist, since one would only restate the fields already shown
above it. A reviewer checks those fields against the event's official page
and `docs/curation-policy.md` directly before merging.

### Duplicates

Every event and position candidate is compared with what is on `main`, with
the drafts in every open discovery PR, with the drafts of discovery PRs
closed without merging (a reviewer rejected them), and with what this run
already accepted (`src/lib/discovery/duplicates.ts`, `pr-drafts.ts`). A
candidate's own open PR is left out, so it can still be refreshed; a rejected
PR is not, so a rejected event never returns under its own or another id.
Open PRs are read each run; a rejected PR's files are read once and kept in
the state file's `rejectedPrs`.

- The mechanical skips above drop a clear duplicate (same URL, same title and
  date, fuzzy title on the same dates; for positions also a score of 0.95 or
  more, `duplicate-likely`, such as the same advert read twice from one post).
  The log names what it duplicates, e.g. `duplicate-url of #85 (open)`.
- Anything else is scored 0–1 against its closest match: shared title words
  on start dates within three days for events; shared title and institution
  words, plus a shared source post, for positions. At 0.6 or more the PR body
  gets a `**Possible duplicate** (0.63) of main: …` line and the
  `possible-duplicate` label, and auto-merge never merges it.

After each run, a separate pass (`auto-approve.ts`) revisits every currently
open discovery PR — not just this run's candidates, since CI on a PR opened
days ago finishes long after that run has exited — and **merges** any whose
recorded confidence is at least 0.90, whose `check`/`e2e` CI jobs both passed
on its current head, which is not labelled `possible-duplicate`, and whose
data files still pass the validator on `main` (the run's own checkout). That
last check matters because a PR's CI may predate a stricter rule on `main`;
merging it would break `main`'s build. A qualifying PR is labelled
`high-confidence` first, so auto-merged PRs stay findable; the merge is pinned
to the head commit whose checks were read. A PR GitHub refuses to merge (a
conflict, a new push) is reported in the run's output and retried next run.
Everything below the bar still waits for a human to review and merge.

## Positions

Discovery also finds academic job adverts (PhD, postdoc, permanent), which go
to `/positions/` instead of being dropped. Four source kinds are routed:
`rss`, `telegram-channel`, `mailbox`, and `position-listing` (a job board whose
linked adverts are each read as a post; adverts dated over 45 days ago are not
followed). For each such post the pipeline runs
the keyword gate `looksLikePosition` first; a post that passes goes to
`extractPosition`. If the gate rejects it, or the extractor finds no position,
the post continues to the normal event extraction, so an event that merely
mentions PhD students is not lost. The extractor keeps an advert URL only if
it appears in the post text; otherwise the draft's `url` falls back to the
item's own URL.

The orchestrator handles positions after events, sharing the same `MAX_PRS`
and `MAX_TOKENS` budgets. Positions skip the jev classifier. Each candidate
is checked mechanically and skipped for one of these reasons: `low confidence`
(below 0.5), `duplicate-url`, `duplicate-title-institution`, `duplicate-likely`, `blocklisted`,
`already reviewed`, `already proposed`, or `MAX_PRS reached`. `already
proposed` means a PR for the same id is still open, or the advert was proposed
under last year's id: an open position PR is never rewritten, so its `added`
date stays the day the advert was first seen. Survivors become PRs on the branch
`discovery/position/<id>`, labelled `needs-review` and `position`, with
`Confidence: 0.xx` as the first line of the body. `auto-approve.ts` reads that
line, so high-confidence position PRs are merged like event PRs.

## Groups

After events and positions, the run resolves group names into registry
drafts (`src/lib/discovery/groups-pass.ts`, `groups.ts`). Leads come from the
organisers of events the classifier accepted, from the `group` of accepted
positions, and from every `group-listing` source. A `group-listing` source is
one page, fetched on every run even when unchanged, and parsed
deterministically with no LLM: each link in its main content is a lead with the
anchor text as the name and the nearest heading or table caption as context.
Each name is matched whole against `name`, `aliases` and `pi` of `data/groups/`
and of every open `discovery/group/*` (or `discovery/groups-backfill`) PR; a
name that matches is done. Otherwise one no-tools call splits the unmatched
text into people and organisations.

For each unknown name the pass tries the listing's own link first (unless it is
a profile page such as Google Scholar, a reference site (Wikipedia, Wikidata,
GitHub) or the listing's own host), then one web
search (`MAX_SEARCHES`, default 20). It fetches up to two candidate URLs
through the normal polite-fetch path (robots.txt, rate limit, `MAX_PAGES`,
blocklist) and asks the extraction model whether the page is that group's
homepage and inside the site's scope. The draft's `website` is the final URL
after redirects. The draft then goes through `validateGroup`. A name that finds
nothing, or is invalid, is not looked up again for 90 days; a name cut off by
`MAX_SEARCHES`, `MAX_PAGES`, `MAX_TOKENS` or `MAX_PRS`, or whose PR failed on a
GitHub error, is left out of that cache so the next run tries it.

Survivors become PRs on `discovery/group/<id>`, labelled `needs-review` and
`group`, with `Confidence: 0.xx` as the first line of the body (so
`auto-approve.ts` handles them like any other PR), followed by the text as it
appeared, the event, position or listing it came from, and every URL
considered with its verdict. Skip reasons: `low confidence` (below 0.5),
`duplicate-website`, `duplicate-name`, `blocklisted`, `already reviewed`,
`already proposed`, and `MAX_PRS reached`. An open group PR is never rewritten.
The pass never rejects: a failure is logged and reported under `groups` in the
run's JSON output. A pass that fails as a whole is also added to the
failure-tracking issue; per-name failures are only logged and in that JSON.

**Backfill.** `npm run discover:groups-backfill [--max-searches N] [--max-pages N] [--max-tokens N]`
(defaults 200 searches, 500 pages, `MAX_TOKENS`) proposes an entry for every
organiser of a merged event, every group of a merged position and every
`group-listing` source entry, as one PR from the branch
`discovery/groups-backfill` (labels `needs-review` and `group`). Its body is a
table of entries followed by the skipped names, and has no `Confidence:` line,
so auto-merge never merges the batch. Run once by hand, not by cron; a re-run
updates the same PR. It needs the same environment as `discover:run`.

## Groups crawler

The groups pass only reaches groups named by events, positions and the
group-listing sources. The crawler (`src/lib/discovery/crawl/`,
`scripts/discovery/groups-crawl.ts`) finds the pages that *list* many
groups — a department's "research groups" page, a network's members — and
feeds their group links into the same resolver. Spec:
`docs/superpowers/specs/2026-09-30-groups-crawler-design.md`.

- **Seeds**, re-added every run (recently visited ones are ignored):
  registry and open-PR group websites and their parent paths; the host of
  each position advert (not job boards or `t.me`); `group-listing`
  sources; the homepages of the institutions publishing most in each
  mapped site topic, from OpenAlex (cached 30 days); and up to
  `--max-searches` web searches, whose citation URLs are seeds only.
- **Scope:** a link is crawled only on its seed's host or that host's
  subdomains (`umich.edu` admits `chem.umich.edu`), depth ≤ 3, ≤ 40 pages
  per host a run. Every URL is upgraded to https and must be public;
  a page that redirects out of scope or to a private host is dropped.
- **Classifier:** only pages with ≥ 8 directory-like links or two strong
  words in the title or headings reach the model. It has no tools, reads
  the page as data, and answers `directory`, `group-homepage` or `neither`
  plus the *numbers* of the group links, so no URL ever comes from it.
- **Proposing:** leads go to the resolver with no searches; verified
  groups not already in the registry or an open group PR go out in
  batches of at most 50, ordered by the directory they came from, on
  `discovery/groups-crawl/<date>-<n>` (labels `needs-review`, `group`, no
  `Confidence:` line). Groups beyond `--max-prs` are left for the next run.
- **State:** `crawl-state.json` next to `STATE_PATH` (or
  `CRAWL_STATE_PATH`): the queue (≤ 50,000), visited pages (180 days;
  directories re-queued after 30), and the leads found but not yet
  proposed, so a killed run resumes them. Saved atomically every 50 pages.
  A 4xx page is gone (not retried); timeouts, 429 and 5xx are retried on
  up to three later runs. The crawl never writes its page or robots state
  into `state.json`; it merges only the group lookups it changed onto the
  file as it is then, so the nightly run's entries survive. The crawl phase
  uses at most half of `--max-tokens`, leaving the rest for verifying.
  `crawl.lock` holds the running crawl's pid; a second crawl, including the
  nightly slice, skips while it is held. Crawled leads may be on the
  directory's own site, and their lookups are cached by link.
- **Nightly slice:** `run.ts` runs it last before auto-approve with the
  defaults (200 pages, 40 classifications, 5 searches, at most one PR, the
  free model), only when `MAX_PRS` has room left.
- **Big crawl**, by hand on the host, in the background, never alongside a
  manual `run.sh`:
  `npm run discover:groups-crawl -- --max-pages 20000 --max-classify 3000 --max-searches 50 --max-prs 20 --model <paid model id> --max-tokens <n>`.
  `--max-tokens` is the hard stop; check the model's price first.
- **Daily free slices** (since 2026-10-01, after the first paid crawl used
  the key's $5 monthly limit): `~/discovery-agent/crawl-slice.sh` runs at
  05:37 local, after OpenRouter's free-model daily cap resets, with the free
  model, `--max-pages 300 --max-classify 200 --max-searches 0 --max-prs 2`.
  That is at most about 500 model calls (200 classifications, up to 300
  verifications, pending leads first), leaving the rest of the 1,000 free
  calls a day to the nightly run. `--max-searches 0` turns off the paid web
  searches.

## Testing

- Record real pages as fixtures in `tests/discovery/fixtures/` and test extraction with a stubbed LLM client returning canned JSON. CI must never call the real API.
- Include adversarial fixtures: pages containing prompt-injection text, invalid dates, missing fields, and duplicate events. Assert the pipeline drops or flags them and never produces an invalid file.
- Test idempotence: running twice on unchanged sources opens no second PR.

## Data audit

`scripts/audit/run.ts` (`npm run audit`) re-checks entries already on main, run daily by cron
(`~/discovery-agent/audit.sh`, 40 entries a day on the free model). For each upcoming event,
open position and group it fetches the entry's own page (none for a linkless mailing-list post)
and collects findings from two places (`src/lib/discovery/audit.ts`):

- mechanical checks: the validator's warnings, and text that `clip` cut off mid-sentence
  (flagged only; cutting back to the last full stop loses too much, so the model rewrites it,
  and a flag it fixed is dropped);
- a model that compares the entry with its page and reports contradictions, partial names,
  wrong locations, broken descriptions and descriptions under 250 characters when the page says
  more, with a fix only when the page gives it. When a title or group name is an English
  translation, it adds the page's original-language one to `aliases`.

A model may only fix text fields (`title`, `aliases`, `organizer`, `cost`, `description` for
events; `title`, `aliases`, `institution`, `group`, `description` for positions; `name`,
`aliases`, `pi`, `parent`, `description` for groups), and a fix is kept only when the entry
still validates. An `aliases` fix appends one alias. `--files <list>` audits the entries named
in a file (one path per line) whether or not they are due, for a one-off re-check. The fixes go
to one PR on `audit/<date>-<n>` (labels `needs-review`, `audit`; never on a `discovery/` branch,
so auto-merge leaves it alone), whose body lists every change and every finding that needs a
human. A run with findings but no fixes has nothing to commit, so it opens an issue with the same
report instead. Each entry is recorded in `audit-state.json` (next to `STATE_PATH`) with a hash of
its content, and is audited again only when it changes or after 90 days; entries that errored are
retried next run and listed in the `Data audit failures` issue.

## Failure handling

- One source failing must not stop the run. Log the error and continue.
- Sources run four at a time (`SOURCE_CONCURRENCY` in `pipeline.ts`). Page budgets are reserved before each fetch, per-host politeness slots are reserved before each wait, and a URL is fetched at most once per run, so concurrency never overshoots `MAX_PAGES` or hits one host faster than the per-host interval. `MAX_TOKENS` is checked before each LLM call, so calls already in flight in other sources can overshoot it slightly.
- Extraction retries a malformed response, a timeout, a dropped connection, a 5xx or a 429 up to three attempts; a 429 waits until the rate limit's stated reset (OpenRouter's free tier allows 20 requests a minute per account).
- A listing page's links are followed only when they plausibly lead to one event: links in site chrome (nav, header, footer, sidebar, menus), downloads, site pages (about, contact, privacy, membership…), past-event pages and the listing's own or ancestor pages are skipped (`parsers/listing.ts`). The filter is structural only, never by topic — a missed event is worse than a wasted fetch. A listing that marks a next page (`rel="next"`) is followed up to five pages deep, since sites that announce months ahead push in-field events off page 1.
- The relevance pre-filter before each LLM call knows English, Russian, Italian/French/German and Chinese/Japanese terms, and the model is told to return English titles and descriptions whatever the source language.
- Repeated failures on a source produce a single tracking issue, not a new one each run.
- The job exits non-zero only on configuration errors, so a cron wrapper can alert on real problems and ignore transient network noise.
- Every outbound HTTP call (page fetches, robots.txt, the extraction/classification/GitHub APIs) goes through `fetchWithTimeout` (`src/lib/discovery/http.ts`, 60s default, 90s for LLM calls) rather than a bare `fetch`. Plain `fetch` has no timeout of its own, so a server that accepts a connection and never responds hangs that call — and, with no timeout, the whole run — forever; this was observed live, not theoretical.

## Deployment

The pipeline (`src/lib/discovery/pipeline.ts`), the classifier
(`src/lib/discovery/classify-candidate.ts`) and the PR-opening orchestrator
(`src/lib/discovery/orchestrator.ts`) are composed by
`scripts/discovery/run.ts`, the actual cron entrypoint. `Dockerfile.discovery`
builds it into an image that runs as the unprivileged `discovery` user with
no credentials baked in — everything comes from the environment at
`docker run` time:

```
docker build -f Dockerfile.discovery -t discovery-agent .
mkdir -p /var/lib/discovery-agent
docker run --rm \
  --env-file /etc/discovery-agent.env \
  -v /var/lib/discovery-agent:/state \
  discovery-agent
```

The `-v` mount is required, not optional: `--rm` discards the container's
own filesystem on exit, so without it `STATE_PATH` (below) would reset on
every run — no page would ever look "unchanged", so every run would
re-extract and re-spend tokens on every source, and push a redundant
update commit to every open PR.

`/etc/discovery-agent.env` (root-only, never in the repo) holds
`LLM_API_KEY`, `LLM_MODEL_EXTRACT`, `STATE_PATH=/state/state.json` (inside
the mounted volume above, so state survives between runs), `GITHUB_TOKEN`,
`GITHUB_REPO`, and optionally `LLM_BASE_URL` (extraction only),
`LLM_BASE_URL_CLASSIFY` (classification only — these are two different
endpoints and must be set independently when proxying either one),
`LLM_MODEL`, `MAX_PAGES`, `MAX_TOKENS`, `MAX_PRS`, `MAX_SEARCHES`, and — for the
`kind: mailbox` sources (see *Mailing lists*) — `IMAP_HOST`, `IMAP_USER`,
`IMAP_PASSWORD` and optionally `IMAP_PORT`/`IMAP_SECURE` — see
*Configuration* above for what each does and its default.

Two credentials stay human-only operational steps, per this document's
*Security model*:

- Set a spending cap on the LLM API key in the provider's console before
  the first run.
- Mint `GITHUB_TOKEN` as a fine-grained personal access token scoped to
  this one repository only, with **contents: write**,
  **pull requests: write** and **issues: write** (the last one is needed
  to file and close the source-failure tracking issue) — never admin,
  never merge.

The cron entry itself (e.g. a daily line in the `discovery` user's
crontab running the `docker run` command above) is set up on the VDS by
the maintainer; it is infrastructure outside this repository.

### Topic statistics (monthly)

The same host refreshes the literature statistics on `/topics/`
(`docs/topic-stats.md`) once a month. `~/discovery-agent/topic-stats.sh`
loads `.env`, runs `scripts/topics/snapshot.ts` from the `/home/egor/agg`
checkout and appends to `~/discovery-agent/topic-stats.log`; crontab line
`17 4 2 * * /home/egor/discovery-agent/topic-stats.sh` (the 2nd, 04:17
local, clear of the nightly run). It needs `GITHUB_TOKEN`, `GITHUB_REPO`
and, for the $1/day OpenAlex tier, `OPENALEX_API_KEY` in `.env`. It opens
or updates the PR `data/topic-stats-<YYYY-MM>`; a failed month proposes
nothing, keeps last month's file, and opens or updates its own issue
(label `topic-stats-failures`, separate from the nightly run's
`discovery-failures`, so neither job's run closes the other's); a good
month closes it.

### Running without Docker

If the VDS has no Docker (and no root to install it), run `run.ts`
directly under a dedicated, non-root system account instead — the same
unprivileged-execution requirement, without a container:

```
mkdir -p ~/discovery-agent && chmod 700 ~/discovery-agent
```

Put the same variables from *Configuration* into `~/discovery-agent/.env`
(`chmod 600`, never committed), with `STATE_PATH=~/discovery-agent/state.json`.
A small wrapper script loads it and runs the agent, since plain `cron` has
no `--env-file` equivalent:

```bash
#!/usr/bin/env bash
set -euo pipefail
AGENT_DIR="$HOME/discovery-agent"
REPO_DIR="$HOME/agg"          # path to this repo's checkout

set -a
source "$AGENT_DIR/.env"
set +a

cd "$REPO_DIR"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "$AGENT_DIR/run.log"
./node_modules/.bin/tsx scripts/discovery/run.ts >> "$AGENT_DIR/run.log" 2>&1 \
  || echo "discovery agent exited non-zero: $?" >> "$AGENT_DIR/run.log"
```

`chmod 700` that script, then add one crontab line (`crontab -e`) pointing
at it, at whatever cadence *Where it runs* calls for. **Caution:** `buildConfig`
only checks that each required variable is non-empty, not that it holds a
real credential — a still-placeholder `.env` will make each run genuinely
fetch every source and fail every extraction call with a 401, rather than
failing fast before touching the network. Fill in real secrets before the
first scheduled fire, or run the script once by hand to confirm it fails
the way you expect.
