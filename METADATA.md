# Repository map

What every file and folder in this repository is for. This is the one place
that describes the layout — `README.md` and `AGENTS.md` point here rather than
repeating it.

If you add a file, add a line here. If a description here disagrees with the
code, the code is right and this file is stale: fix it.

## The shape of the thing

A static site with a thin Worker in front. Event data lives in YAML files, a
validator enforces a JSON Schema over them, Astro renders them to HTML at build
time, and a Cloudflare Worker serves the output. Most paths are plain files that
existed before the visitor arrived; only the paths under `run_worker_first` in
`wrangler.jsonc` run code (`src/worker/`), and that code reads the build's own
`/events.json` rather than the YAML.

Separately, a discovery agent (`scripts/discovery/run.ts` over
`src/lib/discovery/`) runs as a cron job on the maintainer's VDS: it reads
`data/sources.yaml`, finds candidate events and opens pull requests, merging only high-confidence
ones that pass CI and the validator. Nothing in the built site depends on it.

The data flows one way:

```
data/events/*.yaml  →  scripts/validate.ts  (gate: build fails on invalid data)
                    →  src/lib/events.ts    (the single loader)
                    →  src/pages/*          (routes, feeds, exports)
                    →  dist/                (what gets deployed)
```

## Top level

| Path | What it is |
| --- | --- |
| `README.md` | Front door: what the project is, how to run it, where the docs are. |
| `METADATA.md` | This file. |
| `LICENSE` | MIT, for the code. |
| `AGENTS.md` | Rules for coding agents: ground rules, code style, definition of done. Read it before changing anything. |
| `CLAUDE.md` | Frontend aesthetic instructions applied to this repo. |
| `CONTRIBUTING.md` | How a human contributor adds or corrects an event. |
| `TASK.md` | The original build brief, phase by phase. Historical, but phases 4-5 are still the roadmap. |
| `site.config.ts` | Every site-specific setting: name, domain, form URLs. The only place such values belong. |
| `astro.config.ts` | Astro build configuration. |
| `tsconfig.json` | TypeScript configuration (strict). |
| `vitest.config.ts` | Test runner configuration, wrapped in Astro's `getViteConfig` so tests can render `.astro` components. |
| `playwright.config.ts` | Config for the one browser-driven smoke test. Builds against a production build via `npm run preview`. |
| `eslint.config.js` | Lint rules. |
| `.prettierrc.json` / `.prettierignore` | Formatting rules, and the pre-existing docs exempted from them. |
| `.nvmrc` | The Node version the project is built and tested against. |
| `package.json` / `package-lock.json` | Scripts and dependencies, and their locked versions. `npm run` targets are listed in `README.md`. |
| `wrangler.jsonc` | Cloudflare Worker config: serves `dist/` as static assets, and sends only the `run_worker_first` paths to the Worker script in `src/worker/`. Binds the D1 database `DB`, with a separate staging database for previews. |
| `migrations/` | D1 schema migrations, applied with `npx wrangler d1 migrations apply <database> --remote` (production and preview databases both). |
| `Dockerfile.discovery` / `.dockerignore` | Image for the discovery agent's cron job, running as an unprivileged user with no credentials baked in. See *Deployment* in `docs/discovery-agent.md`. |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.astro/`, `.env*`, logs, `.superpowers/`, and the Playwright run artifacts (`test-results/`, `playwright-report/`). |

## `data/` — the source of truth

Everything the site knows. Editing a file here and rebuilding is the whole
publishing workflow.

| Path | What it is |
| --- | --- |
| `data/events/<start-year>/<id>.yaml` | One file per event. The folder must match the event's start year and the filename must match its `id`; the validator enforces both. |
| `data/positions/<added-year>/<id>.yaml` | One file per position (PhD, postdoc or permanent academic job). Created by the first merged position PR; the folder must match the year of `added` and the filename must match its `id`. |
| `data/groups/<id>.yaml` | One file per research group, institute, network or society, listed on `/groups/`. The filename must match its `id`; the folder does not exist until the first group is merged. |
| `data/topics.yaml` | Controlled vocabulary of topic slugs and labels, each with an optional `openalex` list of OpenAlex topic ids for the statistics. Adding a slug is a schema-level change. |
| `data/topic-stats.json` | Per-topic literature statistics from OpenAlex, written monthly by `scripts/topics/snapshot.ts` through a PR; never edited by hand. Absent until the first snapshot. See `docs/topic-stats.md`. |
| `data/blocklist.yaml` | Organiser domains that must never be listed, each with public evidence. Intentionally empty until there is something to add. Matches a registrable host and its subdomains. |
| `data/sources.yaml` | Pages, feeds, channels and mailing lists the discovery agent watches, each verified by fetch. Read by `src/lib/discovery/sources.ts`, listed publicly on `/sources/`, and checked by `npm run validate`. Unusable candidates are kept in a commented block at the bottom so nobody re-checks them. |
| `data/LICENSE` | CC0 1.0, for the event data in this directory. |

## `schema/`

| Path | What it is |
| --- | --- |
| `schema/event.schema.json` | JSON Schema for an event file. The contract. Changing it means changing the validator, `docs/data-schema.md`, the fixtures and the tests in the same pull request. |
| `schema/position.schema.json` | JSON Schema for a position file. Must match `docs/position-schema.md` exactly. |
| `schema/group.schema.json` | JSON Schema for a group file. Must match `docs/group-schema.md` exactly. |
| `schema/topic-stats.schema.json` | JSON Schema for `data/topic-stats.json`. Must match `docs/topic-stats.md`. |

## `scripts/`

| Path | What it is |
| --- | --- |
| `scripts/validate.ts` | CLI entry point for `npm run validate`. Walks `data/events/`, `data/positions/` and `data/groups/` and checks `data/sources.yaml`, reports problems and exits non-zero on any error. Thin: the logic is in `src/lib/validation.ts` and `src/lib/discovery/sources.ts` so the discovery agent can import it as a library. |
| `scripts/discovery/run.ts` | The discovery agent's cron entry point (`npm run discover:run`): validates its environment, then runs fetch → extract → classify → open pull requests → merge high-confidence ones. |
| `scripts/discovery/groups-crawl.ts` | The groups crawler (`npm run discover:groups-crawl`): takes the lock, gathers seeds, crawls, resolves the leads and proposes verified groups in batches of ≤ 50 on `discovery/groups-crawl/<date>-<n>`. Flags for the big crawl; `run.ts` calls it nightly with small defaults. |
| `scripts/audit/run.ts` | The daily data audit (`npm run audit`, `--dry-run` prints the report): checks a slice of the entries on main against their pages and opens one PR with the fixes (or an issue when there are none). |
| `scripts/discovery/config.ts` | `buildConfig`: the discovery agent's settings from the environment, shared by `run.ts` and the runners. |
| `scripts/discovery/groups-backfill.ts` | One-off (`npm run discover:groups-backfill`): resolves the groups behind every merged event, position and group listing and proposes them all as one PR on `discovery/groups-backfill`; a re-run updates that PR. |
| `scripts/topics/propose-map.ts` | By hand (`npm run topics:propose-map`): pulls OpenAlex topics from the compchem-adjacent subfields, places them under site topics by keyword rules and then a no-tools model call, and proposes the `openalex` lists in `data/topics.yaml` as a PR on `data/topic-map-<date>`. |
| `scripts/topics/snapshot.ts` | Monthly on the discovery host (`npm run topics:snapshot`): builds `data/topic-stats.json` from OpenAlex, all or nothing, and proposes it on `data/topic-stats-<YYYY-MM>`; a failure opens or updates its own issue (label `topic-stats-failures`), and a good month closes it. |
| `scripts/discovery/parse-sources.ts` | Dry run (`npm run discover`): fetches and extracts from every source and prints the candidates as JSON. No classification, no GitHub calls. |
| `scripts/discovery/classify.ts` | CLI: reads one candidate event file (YAML or JSON), classifies it against `data/events/` and `data/blocklist.yaml` via `src/lib/discovery/classify-candidate.ts`, prints the verdict as JSON. Useful for checking one candidate by hand; `orchestrator.ts` calls the same classifier in a real run. |
| `scripts/check-links.ts` | CLI: fetches every `url`/`source_url` (or just the files given on the command line) and reports which don't resolve. Never fails — used both by the weekly link-check workflow and the pull-request check on changed files. |

## `src/lib/` — pure logic, unit tested

No DOM, no Astro, no side effects beyond reading files. This is where
behaviour lives and where tests point.

| Path | What it does |
| --- | --- |
| `excerpt.ts` | The opening of a long text, cut at a word boundary, for cards and meta tags. |
| `dates.ts` | The only place dates are parsed. ISO `YYYY-MM-DD` strings handled as UTC calendar dates, never through the local timezone. Parsing, arithmetic, comparison, formatting. |
| `events.ts` | The single data loader. Reads and parses the YAML tree, derives each event's status, and splits upcoming from past. Also computes upcoming deadlines. |
| `validation.ts` | Schema validation (Ajv) plus the semantic rules the schema cannot express — end before start, deadline after end, unknown topic or country, a future `added`, id/filename/folder agreement. Exported as `validateEvent` for reuse. |
| `position-validation.ts` | The same for positions: schema, id/filename/folder agreement, topics, country, blocklist, plus cross-file duplicate checks. Exports `validatePosition`, `validatePositionCollection` and `readPositionFiles`. |
| `positions.ts` | The positions loader. Reads and validates `data/positions/`, derives each position's open, stale or archived status from the build date (45 and 90 days for positions without a deadline), and orders each list. |
| `topic-validation.ts` | Checks `data/topics.yaml`: slugs, labels, and `openalex` ids (a topic under two slugs warns). |
| `topic-stats.ts` | The `data/topic-stats.json` types, its validator (schema, known slugs, https links, consecutive years, stale-mapping warning) and `loadTopicStats`. |
| `topic-coverage.ts` | Counts of upcoming events, groups and open positions per topic, for the topic pages. |
| `charts.ts` | Geometry for the static SVG charts: `barGeometry`, `sparklinePoints`. |
| `topics/openalex.ts` | Minimal OpenAlex client: mailto and optional key on every request, three attempts on 429/5xx, never prints the key. |
| `topics/snapshot.ts` | Builds each topic's statistics from OpenAlex and the monthly PR body. |
| `topics/map-rules.ts`, `topics/propose-map.ts` | Keyword rules, candidate fetching, the model classification and the in-place YAML edit behind `scripts/topics/propose-map.ts`. |
| `group-validation.ts` | The same for groups: schema, id/filename agreement, topics, country, blocklist, plus cross-file duplicate checks. Exports `validateGroup`, `validateGroupCollection` and `readGroupFiles`. |
| `groups.ts` | The groups loader. Reads and validates `data/groups/`, drops fixtures in production builds, and groups the result into sections by kind. |
| `event-graph.ts` | Similarity between events (shared topics, series, organiser) and the graph built from it. Feeds `/graph/` and the related events on each event page. |
| `graph-layout.ts` | Seeded d3-force layout for the event map, run at build time; the browser script reuses its force configuration. |
| `graph-shapes.ts` | SVG path per event type for the map: type is carried by shape, not colour. |
| `discovery/jev-client.ts` | Thin client for OpenRouter's Decisions API (the `jev` model): builds the request, checks for a 2xx response and an `answers` field, otherwise throws. |
| `discovery/classify-candidate.ts` | Decides add/skip for one candidate event: a mechanical dedupe/blocklist pre-filter, then a single jev call scoring relevance, red flags, and credibility as three independent criteria (organiser, programme, cost). Never publishes anything — produces the verdict `orchestrator.ts` acts on. See `docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md`. |
| `discovery/sources.ts` | Loads `data/sources.yaml` (skipping malformed entries at run time) and validates it (`validateSources`, the CI gate). Owns `SOURCE_KINDS`. |
| `discovery/pipeline.ts` | Fetch → parse → extract → validate for every source, four at a time, under page and token caps. Routes RSS, Telegram and mailbox items that look like job adverts to position extraction first. Returns event candidates, position candidates and per-source errors. |
| `discovery/fetch.ts` | Polite fetching: robots.txt, per-host rate limit, ETag/hash caching, and a browser fallback when a page looks like a bot challenge. |
| `discovery/browser-fetch.ts` | Renders a page in the system's Chrome via Playwright, for sites that block plain HTTP clients. |
| `discovery/http.ts` | `fetchWithTimeout`: every outbound call goes through it, since plain `fetch` can hang forever. |
| `discovery/state.ts` | The run-to-run state file: each page's ETag and content hash, each host's robots.txt and last request time. Never throws; a bad file starts from scratch. |
| `discovery/html.ts` | HTML to text, and same-host link extraction. |
| `discovery/parsers/` | One parser per source kind: `listing.ts` (links to follow, including `findPositionLinks` for job boards), `page.ts`, `rss.ts`, `ical.ts`, `telegram.ts`. |
| `discovery/cecam-client.ts` | Reads CECAM's program from the JSON API its page renders from. |
| `discovery/mailbox-client.ts` | Read-only IMAP: plaintext bodies from one folder, deduplicated on `Message-ID`. |
| `discovery/keyword-topics.ts` | Topic slugs from keyword matches against `data/topics.yaml`, so a typed feed needs no LLM call. |
| `discovery/extract-client.ts` | The extraction LLM call (chat completions, JSON output, no tools). Page text goes in as delimited data. |
| `discovery/position-extract.ts` | The position keyword gate and its LLM extraction (own schema and prompt, no tools). Fetched text goes in as data. |
| `discovery/draft.ts` | Turns an extraction into a schema-shaped event: id slug (with Cyrillic transliteration), file path, YAML. |
| `discovery/position-draft.ts` | Turns a position extraction into a schema-shaped `RawPosition`: institution+title id slug with the added year, file path. |
| `discovery/orchestrator.ts` | Classifies candidates and opens one pull request each, with the candidate-controlled text rendered inert in the PR body. |
| `discovery/github-client.ts` | The GitHub REST calls the orchestrator needs: branches, files, pull requests, labels, issues. |
| `discovery/propose.ts` | The `Proposer`: opens (or, for events, refreshes) one branch, file and labelled pull request; shared by events, positions and groups. |
| `discovery/crawl/score.ts` | The crawl's scope (seed host and subdomains) and deterministic link scores. |
| `discovery/crawl/frontier.ts` | The crawl queue and visited map in `crawl-state.json`: revisit periods, the 50,000 cap, atomic saves. |
| `discovery/crawl/seeds.ts` | Crawl seeds: registry websites and parents, position hosts, group listings, OpenAlex institutions, search citations. |
| `discovery/crawl/classify.ts` | The no-tools page classifier and its gate; answers with link numbers only. |
| `discovery/crawl/crawl.ts` | One bounded crawl run: four pages at a time on different hosts, budgets, pauses, saves every 50 pages. |
| `discovery/batch-pr-body.ts` | The table body of a batched registry PR (backfill and crawler). |
| `discovery/group-match.ts` | Matches a name against the registry's `name`, `aliases` and `pi` (and open group drafts), splits organiser strings, and collects group leads from accepted events and positions. |
| `discovery/group-extract.ts` | The two group LLM calls, both with no tools: splitting an organiser string into people and organisations, and verifying that a fetched page is a group's homepage. Page text goes in as delimited data. |
| `discovery/group-search.ts` | The one discovery call with a tool: OpenRouter's `web` plugin, used to find candidate homepages. Keeps only public `https://` URLs from `url_citation` annotations and discards the response text. |
| `discovery/group-draft.ts` | Turns a verified extraction into a schema-shaped `RawGroup`: id slug with a numeric suffix on collision, aliases, `added`, file path. |
| `discovery/groups.ts` | Resolves group leads into validated drafts: registry match, name split, listing link or search, forced fetch, verification, and the 90-day negative cache. Under `MAX_SEARCHES`, `MAX_PAGES` and `MAX_TOKENS`. |
| `discovery/groups-pass.ts` | The groups pass of a scheduled run: reads open group PRs, resolves this run's leads, proposes drafts as pull requests, and forgets cached names whose PR was not opened. Never rejects. |
| `discovery/parsers/group-listing.ts` | Deterministic parser (no LLM) for `group-listing` sources: every link in the main content becomes a group lead with its heading as context. |
| `discovery/audit.ts` | The data audit's checks: which entries are due, mechanical findings, the model's review against the page, fixes kept only when they validate, and the report. |
| `discovery/auto-approve.ts` | Merges open discovery PRs when confidence ≥ 0.90, CI passed, not a possible duplicate, and their files pass main's validator. |
| `types.ts` | The shared vocabulary: event types, formats, deadline types, statuses, and the loaded-event shape. |
| `filter.ts` | Filter state and matching. Parses and serialises the query string, and decides whether a row matches. Shared verbatim between the server render, the browser and the Worker so all three agree; `filterRowFromEvent` builds the row each of them matches. |
| `regions.ts` | Country-to-region mapping and country display names. |
| `deadlines.ts` | `hasOpenDeadline`, `hasOpenTravelGrant`. Kept free of `node:fs` so the Worker can import it. |
| `event-calendar.ts` | `eventsCalendar`: events as iCalendar entries, shared by the build-time feeds and the Worker. |
| `ical.ts` | iCalendar construction: text escaping, 75-octet line folding, date formatting, calendar assembly. RFC compliance lives here. |
| `orbital.ts` | Monte-Carlo point cloud of a real hydrogenic 3d(z²) orbital — the masthead plate. The dots are samples from ∣ψ∣² and their two colours are the two signs of ψ. Runs at build time only. |

## `src/pages/` — routes and outputs

One file per URL. Pages stay thin; they compose `src/lib/`.

| Path | Route |
| --- | --- |
| `index.astro` | `/` — upcoming events with filters. |
| `events/[id].astro` | `/events/<id>` — one event, with its related events. |
| `topics.astro` | `/topics/` — every topic as a sortable table: papers last year, five-year growth, a sparkline and citations from the OpenAlex snapshot, and this site's own counts. |
| `topics/[slug].astro` | `/topics/<slug>/` — the topic's literature statistics (when a snapshot exists), then its upcoming and past events and feeds. |
| `topics/[slug].ics.ts` | `/topics/<slug>.ics` — that topic's upcoming events as a calendar. |
| `topics/[slug].xml.ts` | `/topics/<slug>.xml` — Atom feed of that topic's newly added events. |
| `series/[slug].astro` | `/series/<slug>/` — every edition of a recurring event. Built only for a series with two or more listed editions. |
| `graph.astro` | `/graph/` — the event map: similar events drawn close together. |
| `sources.astro` | `/sources/` — the public list of what the discovery agent reads. |
| `donate.astro` | `/donate/` — what running the site costs, and how to help. |
| `archive.astro` | `/archive` — past events. |
| `positions.astro` | `/positions/` — open positions, plus those that may already be filled. |
| `positions/archive.astro` | `/positions/archive/` — closed positions, grouped by year. |
| `groups.astro` | `/groups/` — research groups, institutes, networks and societies, one section per kind. |
| `about.astro` | `/about` — what this is, plus the curation policy. |
| `submit.astro` | `/submit` — how to add or correct an event. |
| `404.astro` | Not-found page. |
| `events.ics.ts` | `/events.ics` — all upcoming events as all-day calendar entries. |
| `deadlines.ics.ts` | `/deadlines.ics` — upcoming deadlines as calendar entries. |
| `feed.xml.ts` | `/feed.xml` — Atom feed of newly added events, newest first. |
| `events.json.ts` | `/events.json` — the full public dataset with a `generated_at` stamp. |
| `sitemap.xml.ts` | `/sitemap.xml`. |
| `robots.txt.ts` | `/robots.txt`. |

## `src/components/` and `src/layouts/`

| Path | What it is |
| --- | --- |
| `layouts/Base.astro` | The page shell: masthead, footer, metadata, global stylesheet. |
| `components/Description.astro` | A card's description; a full mailing-list post shows its opening with the rest in a "Full announcement" disclosure. |
| `components/EventRow.astro` | One event in a list, with its dates, place and topics. |
| `components/PositionRow.astro` | One position in a list: deadline or "no deadline", level, institution, place, topics, and a stale note. |
| `components/GroupRow.astro` | One group in a list: linked name, PI, parent, place, description and topics. |
| `components/DeadlineList.astro` | An event's deadlines. |
| `components/OrbitalField.astro` | Renders the orbital plate as inline SVG at build time — inline so the dots can follow the theme tokens, which an external image could not. |
| `components/TrendChart.astro` | A static bar chart as inline SVG, with a hidden data table for screen readers. |
| `components/TopicStatsBlock.astro` | A topic page's literature statistics: chart, totals, top institutions, journals and papers, OpenAlex subtopics, this site's coverage. |
| `components/TopicsTable.astro` | The `/topics/` table. |
| `components/PageActions.astro` | The row of per-page actions (subscribe, export, submit). |

## `src/worker/` — the Worker script

Runs on Cloudflare for the paths under `run_worker_first` in `wrangler.jsonc`; every other request goes straight to the static files.

| Path | What it is for |
| --- | --- |
| `index.ts` | The Worker entry: routes `/feed/events.ics`, `/feed/my/<id>.ics`, `/api/prefs` and `/api/interest/<id>`, and hands anything else to the static build (`ASSETS`). `loadBuiltEvents` reads the build's `/events.json`. A thrown error becomes a 503 for that request only. |
| `prefs.ts` | Saved preferences: `/api/prefs` (GET, PUT `{ filter }`, DELETE; writes must come from the site's own origin) and `filterForFeed` for the personal calendar. Filters are normalised through `filter.ts` before they are stored. |
| `interest.ts` | "Interested" marks: `/api/interest/<event id>` (GET count and whether this browser marked it, POST mark, DELETE unmark). Only ids the build lists are accepted. |
| `http.ts` | Shared API helpers: uncached JSON responses and the same-origin check on writes. |
| `visitor.ts` | The `visitor` cookie: random ids, reading it, and the `Set-Cookie` value. |
| `db.ts` | The slice of the D1 binding the Worker uses, declared locally instead of `@cloudflare/workers-types`. |
| `feed.ts` | `filteredCalendar`: the upcoming events matching a list-page filter, as iCalendar. |

## `src/scripts/` — the browser's share

Progressive enhancement only. The site must be readable and usable with
JavaScript disabled; nothing here is load-bearing.

| Path | What it does |
| --- | --- |
| `filters.ts` | Filters the list client-side and keeps the URL in step. Server-rendered results are the fallback. |
| `sort-table.ts` | Sorts a `data-sortable` table (the `/topics/` table) by a header click; without JS it keeps its server order. |
| `interest.ts` | The "I'm interested" toggle and count on an upcoming event's page; hidden unless the API answers. |
| `prefs.ts` | The saved-filter bar on the list page. Hidden unless `/api/prefs` answers; applies a saved filter through the URL and `popstate`, so it never touches the filters island directly. |
| `countdown.ts` | Appends a relative phrase ("closes in 12 days") beside the rendered date, so a static build never serves a stale countdown. Leaves the `<time>` element's machine-readable text alone. |
| `graph.ts` | Brings the event map to life: drag, neighbour highlighting, pan and zoom. The static SVG works without it. |
| `theme.ts` | Reveals and drives the theme toggle. Only unhides the control when it can work, so it never appears uselessly. A small inline script in `<head>` applies a stored choice before first paint. |

## `src/styles/`

| Path | What it is |
| --- | --- |
| `global.css` | The whole stylesheet: colour tokens for both themes, typography, layout. The light and dark palettes are each declared twice — once under `prefers-color-scheme` and once under `[data-theme]` — because CSS cannot share a block between a media query and an attribute selector. A test asserts the two copies stay identical. |

## `tests/`

Vitest. Run with `npm test`.

| Path | What it covers |
| --- | --- |
| `tests/lib/*.test.ts` | One file per `src/lib/` module: dates, events, filter, ical, orbital, regions, validation, and the semantic rules. |
| `tests/components/*.test.ts` | Astro components rendered with the container API (`experimental_AstroContainer`); `position-row.test.ts` covers a position row's level label, advert link, deadline and stale label. Production builds carry no position data, so this is where a rendered row is checked. |
| `tests/worker/*.test.ts` | The Worker: the filtered feed, saved preferences, interest counts and routing, against a fake `ASSETS` and `fake-d1.ts` (D1 over `node:sqlite` with the real migrations applied). |
| `tests/schema/schema.test.ts` | The JSON Schema itself. |
| `tests/endpoints/` | The generated outputs: both `.ics` files parsed with a real iCalendar parser, plus the feed, JSON and sitemap. |
| `tests/pages/links.test.ts` | Internal links resolve. |
| `tests/scripts/filters.test.ts` | Client-side filtering behaviour. |
| `tests/styles/contrast.test.ts` | Every WCAG contrast pair in both themes, and that the duplicated palettes agree. |
| `tests/cli/validate-guard.test.ts` | The validator CLI exits non-zero on bad data. |
| `tests/discovery/*.test.ts` | The discovery agent, one file per module: sources, fetching, parsers, extraction, drafting, classification, the orchestrator and the CLIs. Every LLM, GitHub and IMAP call is stubbed; CI never calls a real API. |
| `tests/discovery/groups-pass.test.ts` | The groups pass: a verified lead opens one PR, open group PRs count as known, MAX_PRS and GitHub failures leave the name out of the negative cache, and a listing failure is returned, not thrown. |
| `tests/discovery/fixtures/candidates/` | Candidate events covering a clean add, each mechanical skip reason, and an adversarial prompt-injection attempt. |
| `tests/discovery/fixtures/posts/` | Raw post texts for position gating and extraction: a PhD advert, a school that only mentions PhD grants, and an injection attempt. |
| `tests/smoke.test.ts` | `site.config.ts` sanity (Vitest, not a browser). |
| `tests/e2e/*.spec.ts` | Playwright, against a production build: `smoke.spec.ts` (the home page loads, choosing a topic reduces the list, the URL updates), `graph.spec.ts` (the event map) and `related.spec.ts` (related events on an event page) and `positions.spec.ts` (the positions pages and their links) and `groups.spec.ts` (the groups page and its navigation link). Run with `npm run test:e2e`; not part of `npm test`. |
| `tests/fixtures/valid/` | Events that must pass, covering the minimal, full and cancelled shapes. |
| `tests/fixtures/invalid/` | One file per rule that must fail, named for the rule it breaks. Add a file here whenever you add a rule. |
| `tests/fixtures/warnings/` | Events that pass but should warn, such as a bare-homepage `url`. |
| `tests/fixtures/groups/` | Valid group files (`valid/`) used by the group tests. |
| `tests/fixtures/positions/` | Valid position files (`valid/<year>/`) used by `tests/lib/position-validation.test.ts`. |
| `tests/fixtures/cli/validate.ts` | Helper for driving the validator in tests. |

## `docs/`

| Path | What it is |
| --- | --- |
| `docs/data-schema.md` | Every event field explained, for contributors. |
| `docs/position-schema.md` | Every position field explained, the derived-status rules and the validation rules. |
| `docs/group-schema.md` | Every group field explained and the validation rules. |
| `docs/curation-policy.md` | What gets listed, what does not, and how the blocklist works. |
| `docs/discovery-agent.md` | The discovery agent: pipeline, security model, configuration, sources and deployment. Implemented and running. Read it with `data/sources.yaml`. |
| `docs/decisions.md` | Running log of decisions and their reasons, newest last. Every deviation from the brief is recorded here. |
| `docs/superpowers/specs/` | Design specs, one per project phase. |
| `docs/superpowers/plans/` | Implementation plans matching those specs. |

## `.github/`

| Path | What it is |
| --- | --- |
| `.github/workflows/ci.yml` | Lint, typecheck, validate (event data and `data/sources.yaml`), test, build and the Playwright e2e test on every push and pull request; a pull request also gets a warning-only link check of the event files it touches. Duplicate detection (same `url`, or same title and start date) is a semantic rule inside `npm run validate`, not a separate job. |
| `.github/workflows/links.yml` | Weekly cron (and manual `workflow_dispatch`) that fetches every `url`/`source_url` in `data/events/` and files or updates one tracking issue listing the dead ones. Never fails the workflow. |
| `.github/workflows/rebuild.yml` | Daily cron (and manual `workflow_dispatch`) that POSTs to the Cloudflare deploy hook in the `CF_DEPLOY_HOOK` secret, so events roll from upcoming to past without a commit. Skips with a log message if the secret isn't set. |
| `.github/pull_request_template.md` | The checklist a pull request must satisfy. |
| `.github/ISSUE_TEMPLATE/event-submission.yml` | Issue form for suggesting an event with no GitHub/coding experience — route 2 in `CONTRIBUTING.md`. |
| `.github/ISSUE_TEMPLATE/correction.yml` | Issue form for reporting a wrong field on a listed event. |

## Not in the repository

- `node_modules/`, `dist/`, `.astro/` — installed or generated. Never committed.
- `.superpowers/` — local agent working notes (task briefs, reports, review
  diffs). Gitignored; not project documentation.
