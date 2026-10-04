# Decision log

Short running log: date, decision, reason. Newest last.

## 2026-09-20 — v1 covers phases 0-3 only

Phase 4 (link-check cron, rebuild cron, duplicate-detection CI, issue forms,
Playwright) is deferred. It is infrastructure around a site that does not exist
yet, and several parts cannot be verified until a GitHub repository and a
Cloudflare deploy hook exist. Spec D1.

## 2026-09-20 — System font stack retained; CLAUDE.md typography rule overridden

`CLAUDE.md` instructs against system fonts. `TASK.md` section 4 mandates them.
The maintainer chose the system stack: zero font bytes and absolute privacy
purity outweigh typographic range here. **Do not reopen this.** Spec D2.

## 2026-09-20 — Seed data is 3 fixtures plus 10-15 verified real events

`TASK.md` asked for 15-30. Every real entry costs a verified page fetch under
AGENTS.md rule 1, and the curation policy holds that a missing listing costs
less than an under-verified one. 10-15 exercises every code path. Spec D3.

## 2026-09-20 — Filters combine OR within a category, AND across categories

`TASK.md` lists the controls but not their combination. This is standard
faceted-search behaviour and the only reading under which "Clear filters" has an
obvious meaning. Spec D4.

## 2026-09-20 — `/events.json` emits `schema_version: 1` from day one

`docs/data-schema.md` promises the field exists for future bumps but omits it
from the example. Emitting it immediately avoids a breaking addition later.
Spec D5.

## 2026-09-20 — `regionOf(country)` stays geographic; `Online` derived in the loader

`docs/data-schema.md` asks one function to depend on both country and format.
Splitting keeps the lookup table testable against ISO codes alone. Spec D6.

## 2026-09-20 — Ratings and reactions deferred, not rejected

Reactions need state outliving a page load, which a static site cannot hold. The
cheapest honest option (Cloudflare Pages Function plus KV) would amend AGENTS.md
rule 3. Ratings additionally collide with the neutrality section of the curation
policy and are statistically meaningless at this site's expected sample size.
Event ids are stable unique keys, so adding reactions later touches only the
event page template and a storage layer. Spec D9.

## 2026-09-20 — Site name is "CompChem Events"

Chosen by the maintainer. The domain is still undecided, so `site.url` stays a
placeholder. Spec section 12 item 1 is half resolved.

## 2026-09-20 — `yaml` chosen over `js-yaml`

js-yaml follows YAML 1.1 and converts bare `YYYY-MM-DD` scalars into JavaScript
`Date` objects in the local timezone, breaking the UTC date invariant at the
parse step. The `yaml` package's default YAML 1.2 core schema leaves them as
strings.

## 2026-09-20 — `.nvmrc` pinned to Node 26, not 24

The plan assumed Node 24. `node --version` on the build machine reported a
26.x runtime, so `.nvmrc` records `26` to match what is actually installed and
what CI's `actions/setup-node` (reading `node-version-file: '.nvmrc'`) will
provision. `package.json` `engines.node` keeps the `>=24` floor from the plan,
which a 26.x runtime still satisfies.

## 2026-09-20 — Installed a newer major of Astro, ESLint, TypeScript and Vitest than the plan assumed

`npm install` with no version pins resolved astro@7, typescript@6, eslint@10
and vitest@5 — all newer majors than the plan's examples anticipated. The
plan's `eslint.config.js`, `astro.config.ts`, `tsconfig.json` and
`vitest.config.ts` contents worked unchanged against these versions (flat
config, `astro/tsconfigs/strict`, and the Vitest `test.include`/`environment`
shape are all still current), so no config-shape adaptation was needed. Noted
here because the plan's dependency-justification text names specific
ecosystem behaviour (e.g. js-yaml vs yaml) that predates these majors; nothing
in that reasoning changes with the newer versions.

## 2026-09-20 — Repository default branch renamed from `master` to `main`

The repository was initialised with `master` as its default branch, which did
not match the plan's merge steps, the design spec, or the already-committed
CI workflow (`.github/workflows/ci.yml`, `push: branches: [main]`) — all of
which name `main`. Rather than retarget the CI workflow to `master`, the
local default branch was renamed to `main` during Task 1, immediately after
this entry was first written. The repository is local-only with no remote
configured, so the rename had no push, PR or collaborator to coordinate
around.

**Closed 2026-09-20.** `git branch -a` lists only `main` and the
`feat/phase-*` branches; no `master` branch exists. `ci.yml`'s
`branches: [main]` has named the correct branch ever since the rename. No
maintainer action is required.

## 2026-09-20 — Three seed events take `location.city` from a CECAM node page, not the event page

`location.city` is required for any event that is not `online`, but three CECAM
event pages state only the node code for their location. The city was read from
CECAM's own node page in each case:

| Event id                                   | Field                     | Secondary page                                                                  |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| `mlip-model-development-applications-2026` | `location.city` = Taipei  | `https://www.cecam.org/cecam-tw` ("Academia Sinica, Taipei, Taiwan")            |
| `computational-electrochemistry-ai-2027`   | `location.city` = Beijing | `https://www.cecam.org/cecam-bj` ("Central location: Beijing, P.R. China")      |
| `fleur-all-electron-dft-tutorial-2027`     | `location.city` = Jülich  | `https://www.cecam.org/cecam-de-juelich` ("Location: Forschungszentrum Jülich") |

`source_url` is deliberately **not** used for these. `docs/data-schema.md`
defines it as the page where the _dates_ were verified; the dates for all three
came from the cited `url`, and a node page supplying a city does not fit that
field's meaning. Recording the second hop here keeps it visible without
stretching the schema. The node pages are on the organiser's own site, so this
is a lookup of what CECAM's own node code denotes rather than an inference.

## 2026-09-20 — MolSSI AI-assisted development workshop considered and declined

The MolSSI "AI-Assisted Development Best Practices" workshop (online,
15-16 October 2026, `https://molssi.org/the-molssi-ai-assisted-development-best-practices-workshop-returns-in-october/`)
was verified and drafted, then removed before release.

`docs/curation-policy.md` scopes listings to events "whose main subject is
computational or theoretical chemistry". This workshop's subject is software
engineering practice — containerised agent execution, requirements-driven
workflows, static and LLM-based code analysis, technical debt. Its organiser and
audience are computational chemists, but the policy's test is the subject of the
event, not the affiliation of the organiser. Listing it would imply that anything
a chemistry-software institute runs qualifies by association. AGENTS.md rule 10
settles the borderline toward fewer listings.

Recorded rather than dropped silently so the call is reversible: if the policy is
later widened to cover research-software practice for the field, this is the
first event to reconsider.

## 2026-09-20 — `/about/` ships without a "Feeds and exports" section

`/events.ics`, `/deadlines.ics`, `/feed.xml` and `/events.json` do not exist yet
(they land in the phase 3 export tasks). Listing them on `/about/` would promise
a feature the site does not have, and this site's value rests on its claims
being reliable, so the section was omitted rather than shipped with dead links.

`Base.astro`'s footer already links three of the same four endpoints
(`/events.ics`, `/feed.xml`, `/events.json`) site-wide, so those links are dead
for the same reason until the same moment: one fact, two symptoms, resolved
together.

Reverse this once phase 3 ships the endpoints: restore the "Feeds and exports"
section on `/about/` listing all four, and the footer's links become live at
the same time.

**Closed 2026-09-21.** Task 16 shipped `/events.ics` and `/deadlines.ics`; this
task ships `/feed.xml` and `/events.json`, the last two of the four. All four
endpoints now exist, so the condition above is met: the "Feeds and exports"
section is restored on `/about/` listing all four, and the footer's
previously-dead `/feed.xml` and `/events.json` links are now live.

## 2026-09-20 — `.prettierignore` excludes pre-existing Markdown docs

The phase-0 tooling scaffold added `.prettierignore` covering `/*.md` and the
pre-existing `docs/curation-policy.md`, `docs/data-schema.md`,
`docs/discovery-agent.md` and `docs/superpowers/` — files that predate this
project's tooling and were not part of that task's file list. Reformatting
them wholesale would be a large, unreviewable diff with no functional benefit;
new docs written by this project (`docs/decisions.md` and code) are still
checked by Prettier. The rationale lived only as a comment inside
`.prettierignore` itself; recorded here per Task 18's sweep for unrecorded
decisions.

## 2026-09-20 — Validation logic lives in `src/lib/validation.ts`; `scripts/validate.ts` re-exports it

`TASK.md` §7 promises the discovery agent (`docs/discovery-agent.md`) a stable
`import { validateEvent }` entry point as a library obligation that outlives
this v1. Putting the schema and semantic checks in `src/lib/validation.ts`
keeps that logic importable and unit-testable without pulling in Node's `fs`
CLI concerns; `scripts/validate.ts` stays a thin CLI wrapper that reads
`data/events/`, calls into `src/lib/validation.ts`, and re-exports
`validateEvent`, `validateCollection`, `loadValidationContext` and their
types, so both `npm run validate` and `import { validateEvent } from
'../scripts/validate'` resolve to the same implementation.

## 2026-09-21 — Countdown island appends beside the server-rendered date

Task 18 adds `src/scripts/countdown.ts`, which finds every
`time[data-countdown]` element and appends a relative-time phrase (`closes in
3 days`, `closes today`, `closed`) as a separate `<span class="countdown">`
after the element, rather than rewriting the `<time>` element's own text. This
follows spec §6 directly: the server-rendered date remains complete and
correct on its own, so a reader with JavaScript disabled loses only the
relative phrase, never the date itself.

## 2026-09-21 — The `/deadlines/` page is removed; deadline data stays everywhere else

The redesign makes the upcoming-events list the whole front of the site, so the
standalone index of deadlines goes. Every other surface that carries deadline
information stays: `/deadlines.ics`, the deadline pill on each event row, the
deadline table on each event page, the countdown island and the "has an open
deadline" filter. No event data and no schema field changed.

## 2026-09-21 — The filter island says "event" directly

`src/scripts/filters.ts` read `data-noun-singular`, `data-noun-plural` and
`data-empty-adjective` off `#result-count` so the `/deadlines/` page could say
"open deadlines". With that page deleted, no caller sets those attributes and
the branch was configuration for a fixed value, so it and its regression test
were removed with the page.

## 2026-09-21 — `/policy/` is merged into `/about/`

With the top navigation bar gone, the footer would otherwise point at two
long-form pages. `docs/curation-policy.md` now renders inside `/about/` and
`/policy/` no longer exists; inbound links became `/about/#curation-policy`.
The markdown file remains the single source of the text.

Its headings were demoted one level in the file itself (`# Curation policy`
became `## Curation policy`) so they nest under the about page's `<h1>`. The
alternative was a build-time heading transform, which Astro 7 only exposes
through the Sätteri processor's `hastPlugins`, requiring an import from a
package the project does not depend on directly. A one-time text edit to the
document costs nothing and keeps `astro.config.ts` empty of pipeline code; the
file still reads correctly on GitHub, starting at a level-two heading. The
anchor is the heading's own generated id, so the page has no duplicate ids.

## 2026-09-21 — Dark-only palette built on the two orbital phase lobes

The 2026-09-20 spec's section 8 specified dark-first with a warm-paper light
mode. The redesign drops the light mode: the site's visual metaphor is a
rendered isosurface on a dark ground, and a second theme that contradicts it
costs more to maintain than it returns. Tokens are now `--lobe-neg` (blue,
aliased as `--link`) and `--lobe-pos` (red, aliased as `--time`), with a new
`--control` token for interactive borders because the old `--rule-strong`
missed WCAG 1.4.11's 3:1 boundary requirement. `tests/styles/contrast.test.ts`
asserts every ratio against the shipped values, so a future colour edit that
breaks AA fails the suite.

## 2026-09-21 — Light theme restored behind a toggle, and a sampled orbital plate

This reverses the dark-only decision recorded above, on the same day, at the
maintainer's request. Two things changed the calculus. The first is reader
control: a theme is not only a house style, and readers who work on paper-white
screens were given no way out. The second is that the argument for dark-only
rested on the metaphor — an isosurface render needs a dark ground — and the
metaphor no longer depends on it.

The background is no longer a stack of radial gradients standing in for an
isosurface. `src/lib/orbital.ts` draws a Monte-Carlo sample of |ψ|² for a real
hydrogenic 3d(z²) orbital, the same construction the poster art this borrows
from uses, and `src/components/OrbitalField.astro` emits it as inline SVG at
build time. Because the dots take their colour from `--lobe-pos` and
`--lobe-neg`, the plate repaints with the theme, which a background image could
not do — that is why it is inline markup rather than a cached asset.

It lives in the masthead rather than behind the whole page, which the browser
decided rather than the plan. Three measured attempts at a full-page wash: thin
enough to sit under the event list, it reads as speckle and not as an orbital;
dense enough to read (9000 dots) it textures the body copy and costs 39 kB
gzipped a page; dense and masked away from the text, it is invisible again. A
whole-page cloud can be legible, quiet or cheap — not all three, because the
listing leaves no empty region for a picture to occupy. The masthead has one.

Two numbers govern how the plate is drawn, and both were wrong in the first
attempt. The sampling ball runs to 20 a₀ so the dusty tail survives, but |ψ|²
peaks at 6 a₀, so scaling the frame to the ball drew the orbital into the
middle third and left it reading as dust; the frame is scaled to a 15 a₀ plot
window instead and samples outside it are dropped, as a plot clipped to its
axes drops them. And stroke widths are viewport-relative: at the plate's scale
the original 1.3–2.6 viewBox units rendered under half a device pixel, so every
dot came out a grey smudge. They are 4.5–9 now. The plate costs about 11 kB
gzipped; 1900 dots saves 3 kB and visibly thins the lobes, so `DOT_COUNT` stays
at 2600.

Tiers are cut against the orbital's global peak density, so the equatorial torus
never reaches the top tier — the axial lobes really are denser, and the render
says so rather than flattering the shape.

The light palette is warm paper (`#f4efe4`), never white, and keeps blue for
links and red for time so the semantics of the two lobes survive the repaint. It
has to be declared twice, once under `prefers-color-scheme: light` and once
under `[data-theme='light']`, because CSS cannot share a block between a media
query and an attribute selector; `tests/styles/contrast.test.ts` asserts the two
copies are identical and checks every WCAG pair in both themes.

The toggle in the masthead writes `localStorage.theme` and is unhidden by
`src/scripts/theme.ts`, so it never appears when it could not work. A small
inline script in `<head>` applies a stored choice before first paint. With
JavaScript off, the system preference still decides.

## 2026-09-23 — Discovery sources verified by fetch; `METADATA.md` owns the layout

`data/sources.yaml` now exists with sixteen entries, each fetched and read
before it was added, per AGENTS.md rule 1. Three URLs suggested in
`docs/discovery-agent.md` were already dead (`cecam.org/workshop-list`,
`molssi.org/events/`, `acscomp.org`) and `www.ictp.it` refuses a scripted user
agent, so a list written from memory would have shipped four broken sources out
of twenty. Checked-but-unusable candidates stay in a commented block in that
file so the finding is not re-derived.

Two source kinds were added to the four the spec listed. `ical` earns its place
because a calendar feed needs no LLM call at all, and `mailbox` because Psi-k
forced the question: it mirrors its mailing list to a forum whose post URLs all
return HTTP 200 serving the homepage to an anonymous fetch, and whose public RSS
was ten months stale when checked. Its traffic is unreachable except by
subscribing. The IMAP path is specified in `docs/discovery-agent.md` and
deliberately not built — the agent it would feed does not exist yet, and mail is
just another text source into the same pipeline.

No validator or CI check for `sources.yaml`. Nothing reads the file yet;
validating it would be scaffolding for an absent consumer.

`METADATA.md` describes every file and folder and is now the single place that
does. The layout block in `AGENTS.md` shrank to a pointer and `README.md` links
it, so the three copies that would have drifted are one.

## 2026-09-23 — Discovery candidate classifier: bigram-Dice fuzzy title match, jev-latest, threshold 0.5

`docs/superpowers/specs/2026-09-23-discovery-event-classifier-design.md` left
the fuzzy-title-match algorithm as an open follow-up. It is implemented as a
Sørensen-Dice coefficient over character bigrams of `normaliseTitle()`'s
output (`src/lib/discovery/classify-candidate.ts`, `titleSimilarity()`),
threshold `0.8`: dependency-free, and it reuses the same normalisation
`src/lib/validation.ts` already applies for the build-time exact
title-plus-date duplicate check, so the two dedupe passes cannot disagree
about what "the same title" means.

`normaliseTitle` and `isBlocked` were exported from `src/lib/validation.ts`
(previously private) so the classifier reuses the build validator's own
duplicate-detection and blocklist logic rather than re-implementing it.

jev is called as `~typesafe/jev-latest` rather than a pinned version, per the
design spec. `ADD_THRESHOLD` is `0.5`, a single named constant in
`classify-candidate.ts`, tunable without a design change.

This ships only the classification step, the spec's stated scope. Wiring it
into the fetch/extract/PR pipeline remains a separate, later task.

## 2026-09-23 — Discovery source parsing: `source_url` is never requested from the extraction model

`docs/superpowers/specs/2026-09-23-discovery-source-parsing-design.md`'s
_Extraction_ section listed `source_url` among the fields the LLM's JSON
schema returns, mirroring `docs/discovery-agent.md`'s step 4 wording ("plus
... the exact `source_url`"). The implementation
(`src/lib/discovery/extract-client.ts`) does not ask the model for it: the
pipeline (`src/lib/discovery/pipeline.ts`) already knows, with certainty,
which URL a given extraction input came from — it just fetched it — so
asking the model to reproduce that value would only open a channel for
prompt-injected text to misattribute a candidate's source. `source_url` is
set directly from the fetch, never from model output.

**Amendment (final fix wave):** for `rss`/Atom items specifically, "set
directly from the fetch" is narrower than it sounds: the pipeline never
independently fetches each item's own page, only the feed itself.
`source_url` there is derived from the feed's own per-item `<link>`
(resolved against the feed's URL and validated as http/https, falling back
to the feed's own URL when that resolution fails or isn't http(s) — see
`parseFeedItems` in `src/lib/discovery/parsers/rss.ts`) rather than from an
independent pipeline fetch of that exact URL. This is a narrower provenance
guarantee than for `event-page`/`listing-page`/`ical`/`telegram-channel`,
where `source_url` is always the URL the pipeline itself just fetched —
worth stating accurately rather than overclaiming.

## 2026-09-25 — Licence chosen: MIT for code, CC0 1.0 for event data

TASK.md item 5 (Human-only steps) asked the maintainer to choose licences
before `LICENSE` files could be added. The maintainer chose MIT for the code
(matching TASK.md's suggestion) and CC0 1.0 Universal, not CC BY 4.0, for the
event data in `data/` — no attribution requirement on reuse, which fits a
dataset meant to be mirrored and republished freely. `LICENSE` (root, MIT)
and `data/LICENSE` (CC0) are separate files because the two grants apply to
disjoint parts of the repository; each cross-references the other.

## 2026-09-25 — Rebuild cron implemented (deferred piece of Phase 4)

The GitHub repository and a Cloudflare deploy hook now exist (see the
2026-09-20 "v1 covers phases 0-3 only" entry, which deferred this exact piece
for that reason). Added `.github/workflows/rebuild.yml`: daily cron plus a
manual `workflow_dispatch` (needed to verify the secret and hook actually
work without waiting for the schedule), POSTing to `CF_DEPLOY_HOOK` and
skipping with a log message when that secret is absent. The site's
deployment is a git-connected Cloudflare Worker with static assets (see
`wrangler.jsonc`), not classic Pages; Cloudflare's deploy-hook feature
(originally Pages-only) now covers Workers Builds the same way, so the
mechanism TASK.md specified applies unchanged. The rest of Phase 4
(link-check cron, duplicate-detection CI, issue forms, Playwright smoke
test) remains deferred.

## 2026-09-25 — Remainder of Phase 4 shipped

The four pieces the previous entry deferred:

- **Duplicate detection** turned out already done: `src/lib/validation.ts`
  rejects a matching `id`, `url`, or normalised title plus start date, and
  runs on every PR through `npm run validate` in `ci.yml`. TASK.md §4 phase 4
  lists it as if it were a separate check; it needed no new job, just this
  note.
- **Link checking** is one script, `scripts/check-links.ts`, used two ways.
  `.github/workflows/links.yml` runs it weekly (and on `workflow_dispatch`)
  over every `url`/`source_url` in `data/events/` and files or updates a
  single issue (title "Dead links in event data", label `dead-links`) listing
  what didn't resolve, closing it once everything resolves again. A new
  `link-check` job in `ci.yml` runs the same script against only the
  `data/events/` files a pull request changed, warning-only by design — the
  script always exits 0, so a dead link is visible in the job's log without
  blocking the merge. Identical URLs across events are fetched once, HEAD
  first with a GET fallback for servers that reject HEAD, 10s timeout.
- **Issue forms**: `.github/ISSUE_TEMPLATE/event-submission.yml` and
  `correction.yml`, both referenced already from `CONTRIBUTING.md` and
  `src/pages/submit.astro` (`?labels=event-submission`) before either file
  existed. Fields mirror `docs/data-schema.md`; nothing is validated
  server-side since these feed a human turning the issue into a pull request,
  not the build.
- **Playwright smoke test**: `@playwright/test` added as a devDependency,
  `playwright.config.ts` runs `npm run preview` against a production build
  (so fixtures are excluded, matching what ships), and
  `tests/e2e/smoke.spec.ts` covers the acceptance text exactly — home page
  loads, choosing a topic reduces the list, the URL updates — plus asserts
  the displayed count, since the app already renders one and a test that
  never reads it would miss a mismatch. It walks the topic checkboxes
  looking for one that actually narrows the list rather than asserting on a
  hard-coded topic slug, so it does not need updating as seed data changes.
  New `npm run test:e2e` script; not part of `npm test` or the main `check`
  CI job, since it needs a browser binary (`npx playwright install
--with-deps chromium`) and a full build first — it runs as its own `e2e`
  job in `ci.yml`.

One correction made while writing the smoke test: the URL's query parameter
for topics is `topics` (plural, comma-joined — see `src/lib/filter.ts`), not
`topic` (the singular `name` on each checkbox `<input>`). An earlier draft of
the test asserted `topic=`, which never matched and would have masked a real
regression by always taking the "not reduced yet" branch until it either
found a checkbox whose value happened to also appear as a substring of some
other topic's slug or exhausted the list and failed outright. Caught by
running the test against the real build rather than trusting it after
writing it.

TASK.md §5 phase 4's acceptance criterion — "CI, link-check and rebuild
workflows run" — is now met by all three workflows existing and passing
locally (`npm run lint && npm run typecheck && npm run validate && npm test
&& npm run build && npm run test:e2e` all green). Only the human-only steps
in TASK.md §6 remain: a report form, a submission form, and the custom
domain / Cloudflare Pages-vs-Workers connection is already resolved (see the
"Rebuild cron implemented" entry above).

## 2026-09-25 — Report and submission forms: Tally

TASK.md item 3 (Human-only steps) is resolved. The maintainer created two
Tally forms and `site.config.ts` now points at them instead of
`placeholder.example`:

- `reportForm.url` is `https://tally.so/r/ODvo7M` ("Report an event": reason
  dropdown, details, optional email). Its two hidden fields are named
  `event_id` and `event_url` to match `reportForm.eventIdParam` /
  `eventUrlParam` exactly, so no code change was needed beyond the URL — Tally
  passes a query parameter straight into a hidden field of the same name.
  Confirmed against a production build: `src/pages/events/[id].astro`'s
  generated links carry both parameters correctly.
- `submissionFormUrl` is `https://tally.so/r/RGpV04` ("Add an event"), fields
  matching `docs/data-schema.md`.

Only two human-only items remain open: a custom domain (the site still
serves from `compchem-events.beregdsk.workers.dev`) and `contactEmail` in
`site.config.ts`, still `placeholder@example.org`.

## 2026-09-28 — Event map: d3-force

The event map (`/graph/`, spec `docs/superpowers/specs/2026-09-28-event-graph-design.md`)
adds `d3-force` v3 (ISC; pulls d3-dispatch, d3-quadtree, d3-timer; about
15 kB gzipped) and `@types/d3-force` as a devDependency. It is the standard,
small, maintained force-simulation implementation, and one dependency covers
both uses: the seeded layout at build time (`src/lib/graph-layout.ts`) and the
draggable simulation in the browser (`src/scripts/graph.ts`), which share one
force configuration. Astro bundles it into the page's own script — no CDN, no
runtime network calls. It loads only on `/graph/`, so the home page's 30 kB JS
budget is untouched. Pan and zoom are hand-rolled on the SVG viewBox rather than
adding d3-zoom.

## 2026-09-28 — Topic pages and feeds, series pages, travel-grant filter, `cost` shown

- **Topic pages and feeds.** `/topics/<slug>/` lists a topic's upcoming and
  past events, with `/topics/<slug>.ics` and `/topics/<slug>.xml` beside it;
  `/topics/` indexes them. They are built for every slug in `data/topics.yaml`,
  including topics with no events yet, so a feed can be subscribed to before
  its first event arrives. They reuse `eventsCalendar` and `atomFeed`, which
  now take a scope (calendar name; feed title, self link and id), so there is
  one builder per format rather than two. Each topic feed has its own Atom
  `<id>` (the topic page's URL). Event-page topic chips now link to the topic
  page rather than to a filtered home page, and the home page shows a link to
  the topic page when exactly one topic is selected.
- **Series pages** (`/series/<slug>/`) are built only for a series with two
  or more listed editions: with one, the page would repeat the event page.
  At the time of writing no series has two editions, so none ships yet; the
  event page links to its series page only when one exists.
- **Travel-grant filter** (`?grant=open`): events with a `travel_grant`
  deadline that is still open. It is shown only when an upcoming event has
  one, following the home page's rule of offering only options the data
  contains. At the time of writing none does, so the checkbox is hidden.
- **`cost`** already existed as an optional free-text field (added with
  discovery's cost extraction) but was undocumented and never shown. It is
  now in `docs/data-schema.md` and on the event page.

## 2026-09-28 — `data/sources.yaml` is validated in CI

The 2026-09-23 entry declined a validator because nothing read the file. The
discovery agent now does, and `loadSources` skips a malformed entry silently,
so a typo such as `last_check:` or `kind: listing` would drop a source from
every run with no signal anywhere. `validateSources`
(`src/lib/discovery/sources.ts`) is the gate, run by `npm run validate`. It
rejects an unknown field or kind, a non-https or repeated url, a `folder` on a
non-mailbox source, and a missing or impossible `last_checked` (required,
since the file's own rule is that nothing goes in unfetched). `loadSources`
keeps its skip-don't-throw behaviour at run time.

## 2026-09-28 — `fee: free | paid` field and cost filter

The maintainer asked for a free/paid filter. `cost` is free text as the
organiser words it, and parsing it into a category would put words in the
organiser's mouth, so the category is its own optional field, `fee`, stated
by whoever verifies the event, alongside `cost` rather than derived from it.
`paid` covers any registration fee, waivers or not; an event whose page says
nothing has no `fee` and matches only "any" in the filter, never "free" —
unknown is not free. The extraction model returns `fee` only when the text
states it; the prompt forbids guessing from the kind of event, and the value
is shown in the discovery PR body for the reviewer to check. An event with
`fee: free` carries `isAccessibleForFree` in its JSON-LD.

The home-page select appears only once some upcoming event has a `fee`, like
every other option there. At the time of writing none does: existing events
need their fees checked on the organisers' pages before any can be set.

## 2026-09-28 — Masthead plate: contour plot replaces the point cloud

The Monte-Carlo plate from 2026-09-21 is replaced by isovalue contours of the same
3d(z²) orbital on the xz plane, traced at build time with `d3-contour`. The maintainer
disliked the plate and the masthead ground; looking at the render, three things were
wrong. The plate was cropped: an absolutely positioned SVG given a width takes its
height from its aspect ratio and ignores the bottom inset, so the square plate ran past
the masthead and the lower lobe was cut by the rule. Equal-sized dots gave no depth, so
at a distance the cloud read as static. And the 34 px grid and the ring pattern behind it
competed with the plate.

Contours fix the reading without leaving the chemistry: they are the figure a quantum
chemistry paper prints for a d orbital, the two colours are still the two signs of ψ,
and the torus still gets fewer rings than the lobes because its peak |ψ| on the plane
is half theirs. The nodal cones are drawn as dashed lines at ±35.3°. The grid and rings
are gone. The plate is now sized by the masthead's height, and a test asserts every
contour closes at least 3% inside the frame. The outermost level (4% of peak) was
dropped because it ran off the frame at any window that kept the lobes a useful size.

`d3-contour` over a hand-written marching-squares routine: it is the standard
implementation, it runs only at build time so no bytes reach the browser, and it is the
same family as the `d3-force` already in use. A 120-point grid with whole-unit
coordinates costs about 7 kB gzipped, against 11 kB for the cloud. Strokes use
`vector-effect: non-scaling-stroke`, so their widths are pixels whatever size the plate
draws at, which removes the viewBox-unit tuning the dot widths needed.

The page glow now pools behind the plate and scrolls with the page, rather than
being fixed to the viewport, so the masthead rule crosses it instead of ending it. Its
strength is a token (`--glow`), lower in the light theme because a blue wash turns
paper grey. The wordmark moved up to `--step-2`, since at body size it was outranked
by every page heading.

## 2026-09-28 — Renamed to CompChem Observer, served from compchem.observer

The site is now **CompChem Observer** at `https://compchem.observer`, and the repository
is `beregdsk/compchem-observer`. This supersedes the 2026-09-20 name decision and closes
the custom-domain item left open in the 2026-09-25 entry. The name follows the domain the
maintainer bought.

`site.url` is the single source for canonical links, the sitemap, feed URLs and ids, and
the iCalendar UID domain, so all of them moved with it. That re-keys every calendar UID
and Atom id, which would duplicate every event for an existing subscriber. There were
none at the time of the switch, so the ids were allowed to move rather than being frozen
on the old host. After this, changing `site.url` does carry that cost.

The domain is attached to the Worker as a Custom Domain in `wrangler.jsonc` (apex and
www), so Cloudflare manages DNS and certificates on deploy. `workers_dev` is false, which
retires `compchem-events.beregdsk.workers.dev` at the maintainer's request. `preview_urls`
is set explicitly to true because preview URLs otherwise follow the workers.dev setting,
and Workers Builds gives every PR branch one. The Worker was renamed
to `compchem-observer` the same day, through the API first and `wrangler.jsonc` straight
after, because Workers Builds fails a build whose `wrangler.jsonc` name differs from the
Worker in the dashboard. The custom domains and the build trigger are keyed to the
Worker's immutable id, so they followed the rename.

## 2026-09-28 — Contact address: contacts@compchem.observer via Email Routing

`contactEmail` is `contacts@compchem.observer`, closing the last open item from the
2026-09-25 entry. It is shown on the about and sources pages and sent in the discovery
crawler's user agent. Cloudflare Email Routing forwards it to the maintainer's inbox: one
literal rule on the zone, no mailbox and no cost. It only receives. Replying from the
address would need an outbound provider, which nothing here needs yet.

## 2026-09-29 — `last_verified` removed from the event schema

The maintainer asked to drop the field. Nobody re-checked events on a schedule,
so the date only ever recorded when a file was written — the same as `added` —
and the 90-day "check the official page" notes it drove were noise rather than
a signal. Removed with it: the future-date and added-after-verified errors, the
stale-verification warning, `isStale` and both visitor-facing notes, the date
field on the submission issue form, and the field in discovery drafts. The
trust rule stands without it: `AGENTS.md` rule 1 still requires an official
`url`/`source_url` read at the time of adding. Old specs and plans keep their
references as history. A file that still carries the field now fails
validation as an unknown property.

## 2026-09-29 — Positions: a second data type, discovered from posts

The discovery sources also carry job adverts, which the event extractor threw
away. They now go to `/positions/`, as `data/positions/<added-year>/<id>.yaml`
under `schema/position.schema.json` (`docs/position-schema.md`). Scope is PhD,
postdoc and permanent academic roles; industry jobs are out because they are
recruiter-heavy and hard to screen. A position with no deadline stays listed:
marked "may already be filled" at 45 days and archived at 90; with a deadline,
it is archived the day after. Only RSS items, Telegram posts and mailbox
messages are routed: a keyword gate (`looksLikePosition`) sends likely adverts
to a separate extractor, and anything it rejects falls through to the
unchanged event extractor, so an event that mentions PhD students is not lost.
Positions skip the jev classifier, whose criteria (programme, registration
cost) do not fit an advert; mechanical duplicate and blocklist checks plus the
0.5 confidence floor apply, and a human still merges every PR. A `url` equal
to its `source_url` is the fallback for a post without an advert link and is
not treated as a duplicate on its own. A post advertising several positions
yields only the first, and a post that yields a position is not also extracted
as an event. Rendered rows are covered by a container-API test
(`tests/components/position-row.test.ts`), since production builds carry no
position data.

## 2026-09-29 — Dates are calendar-checked; open position PRs are not rewritten

Both schemas now give their `date` type `format: date` as well as the
`YYYY-MM-DD` pattern, so `2027-02-30` fails `npm run validate` with a field
error instead of passing it and crashing the build with a bare `RangeError`.
A position whose PR is already open is left alone when the advert is seen
again (skip reason `already proposed`), and so is one proposed under last
year's id: rewriting the PR would move `added`, the "first seen" date that the
45/90-day clock counts from, and a re-sighting after 1 January would otherwise
open a second PR. Event PRs still refresh as before.

## 2026-09-29 — Groups registry: one registry with a `kind`

`data/groups/` lists research groups, institutes, networks and societies in
one registry with a `kind` field, rather than PI-led groups only: most event
organisers are networks and societies (CECAM, CCP5, MolSSI), and the
registry is meant to standardise the `organizer` field later. `location` is
optional for networks and societies, which have no single city. Ids have no
year: a group is not dated, and the id must stay stable for events to point
at it. See docs/superpowers/specs/2026-09-29-groups-registry-design.md.

## 2026-09-29 — Other aggregators are allowed as sources

The rule "coverage comparison only; do not scrape another site's curation"
is dropped. Curated lists such as labinitio.org's are useful leads, so they
are read as sources, but only the official pages they link to are extracted:
every fact is rechecked there, and none of the aggregator's text is copied.
The new source kind `aggregator` does this for events.

## 2026-09-29 — Group homepages found by OpenRouter web search, citations only

The groups pass finds a group's website with OpenRouter's `web` plugin on the
existing `LLM_API_KEY`: no new credential or dependency, and the key's
spending cap covers it. It is the first discovery call with a tool, so only
the response's citation URLs are used, never URLs in its prose, and each
page is fetched and verified by the no-tools extractor before a draft
exists. `MAX_SEARCHES` (default 20) caps searches per run, and names that
found nothing are not searched again for 90 days.

## 2026-09-30 — Duplicates checked against open and rejected PRs, near misses flagged

Duplicate checks used to see only `main` and the current run, so a second
source on a later night opened a second PR for the same event (PRs #53 and
#85), and an event a reviewer closed could come back under another id. They
now also see the drafts in open discovery PRs and in PRs closed without
merging. Near misses are not skipped on a guess: they are scored and, at 0.6
or more, opened with a `possible-duplicate` label and a line naming the match,
so the maintainer only checks those. The score uses shared title words, not
the mechanical skip's character bigrams, which score unrelated titles up to
0.55. No LLM judge for now: add one for the flagged band only if it stays
noisy.

## 2026-09-30 — OpenAlex statistics per topic, two-level topics

`/topics/` shows literature statistics from OpenAlex (CC0), refreshed monthly
into `data/topic-stats.json` through a PR, so the site stays static. Site
topics stay broad filters; each maps to OpenAlex topics underneath (the
`openalex` field), and nothing on events, groups or positions is re-tagged.
The trend is papers per year: OpenAlex topics have no per-year citation
counts, so citations are a total, summed over a slug's topics (a paper under
two of them counts twice, and the page says so). See
docs/superpowers/specs/2026-09-30-openalex-topics-design.md.

## 2026-09-30 — Groups found by crawling institution sites for group directories

To cover far more groups than events and positions name, the discovery agent
crawls institution sites from known seeds to the pages that list many
groups, and verifies each linked group with the existing resolver. Crawling
directories needs no per-name web search, so it scales; a model looks only
at pages that already look like directories, and answers with link numbers,
never URLs. Seeds include the institutions OpenAlex ranks highest per site
topic. Groups arrive in batched PRs of at most 50 for human review. A paid
model is allowed for the one big crawl, the nightly slice stays on the free
model. See docs/superpowers/specs/2026-09-30-groups-crawler-design.md.

## 2026-10-02 — Rules 3 and 4 dropped: a Worker script, and no blanket no-tracking rule

The maintainer dropped AGENTS.md rule 3 ("static only") and rule 4 ("no
tracking"). This supersedes the static-only and privacy lines of TASK.md §4
and the 2026-09-20 reactions entry's reason for deferring. Pages stay static
files; a Worker script (`src/worker/`) now answers only the paths listed under
`run_worker_first`, so every other request still costs no Worker invocation
and the site reads the same if the script fails. The new rule 4 keeps one
obligation: anything that stores or sends visitor data is described on
`/about/` in the same PR. First use: a live calendar for any list-page filter
(`/feed/events.ics?<filter>`), which a build cannot prebuild for every
combination. The Worker reads the build's `/events.json` through the assets
binding, so the YAML stays the only source of truth, and it recomputes
"upcoming" per request. `wrangler` is a dev dependency for `npm run dev:worker`.

## 2026-10-02 — Saved preferences: a cookie, D1, and a personal calendar

A browser can save one list-page filter as its default. The list opens with it
when the URL has no filter of its own, and `/feed/my/<feed_id>.ics` serves it as
a calendar that follows later changes to the saved filter. Identity is a random
`visitor` cookie (HttpOnly, Secure, SameSite=Lax), set only when someone saves:
no accounts, so nothing to log in to and no personal data beyond the filter.
The feed id is separate from the visitor id, so a calendar URL that leaks
cannot be used to overwrite the filter. Storage is D1, the smallest Cloudflare
store with a uniqueness constraint (the feed id), and the same database will
hold reaction counts. Writes check `Origin` against the site's own, since the
cookie alone would let any page change a visitor's filter. Filters are
normalised through `filter.ts` and capped at 2,000 characters. Previews bind a
separate staging database. Described on `/about/` under rule 4.

## 2026-10-02 — "Interested" counts on event pages

The 2026-09-20 entry deferred reactions for two reasons: they need runtime
state, and ratings would collide with the curation policy's neutrality. Runtime
state is now allowed (rules 3 and 4 above). For neutrality, the reaction is a
single "I'm interested" mark, not a rating: no scale, no comments, and the
count never orders or filters listings (stated in the curation policy). One
mark per visitor cookie per event, enforced by the table's primary key;
clearing cookies lets someone mark twice, which is accepted at this scale
rather than adding accounts. Marks are stored in the same D1 database and
under the same cookie as saved preferences, only for event ids the build
lists, and only upcoming events show the control.

## 2026-10-04 — Longer descriptions, and full text for linkless mailing-list posts

280 characters cut most descriptions short (the clipped "…" endings in the
registry show it), so the own-words limit is now 600, for events, positions and
groups. A mailing-list post that links no page of its own is different: the
entry's `url` can only point at the list's page, so a reader has nowhere to
read the announcement. Its full text becomes the description instead. This
is an exception to rule 2 made on the maintainer's request; it is narrow by
construction, since the validator allows a description over 600 characters
only when `url` and `source_url` both equal a `kind: mailbox` source's `url`.
The schemas' `maxLength` is therefore 8,000 for events and positions (the
full-text cap) and 600 for groups; the 600 limit itself lives in the validator.

## 2026-10-04 — A group `pi` names each head in full

A group PR proposed `pi: Sam` and was flagged high-confidence; the extractor's
confidence is about the page, not each field. `pi` must now give each head's
given and family name (`isFullPersonName`), as a validator error, so such a PR
fails CI and is never flagged. The extractor drops a partial name rather than
losing the whole draft. Two entries on main ("Prof. Shinoda", "Prof Yu") were
corrected from their groups' own member pages.

## 2026-10-04 — A daily data audit, reported as a PR

Entries on main drift (pages change, extraction mistakes slip through review),
so a daily job re-checks 40 of them against their own pages and proposes fixes
in one PR. A model may change only text fields, and only to values the page
gives; every fix must validate. Findings without a fix are listed for a human
in the same PR, or, when nothing changed, in an issue (a PR needs a diff).

## 2026-10-04 — High-confidence discovery PRs merge themselves

The maintainer asked for high-confidence PRs to merge without a click. The
auto-approve pass now merges a discovery PR with confidence ≥ 0.90, green
`check` and `e2e`, no `possible-duplicate` label, and data files that pass
the validator on `main`. The last condition exists because a PR's CI can
predate a stricter rule (#202 passed CI, then `isFullPersonName` landed and
its `pi` would have broken `main`). Re-running CI on every behind PR instead
would let only one PR merge per night, since each merge puts the rest behind.
The merge is pinned to the head sha whose checks were read.

## 2026-10-04 — Graph views draw clusters, not one blob

Linking every pair over 0.35 gave the groups graph ~1,000 edges (a shared
country alone came close), and with short-range repulsion and a strong pull to
the centre every graph view drew one even disc. Now each item keeps only its
four strongest links (`MAX_LINKS`; ties go to the next items in cyclic order,
so no hubs form). The layout finds communities by modularity (Louvain's local
moves, deterministic) and pulls each to its own anchor on a sunflower spiral,
largest in the middle. Links between communities are slack and drawn faint.
Groups and events show modularity of about 0.6 and 0.7, so the clusters are real.
