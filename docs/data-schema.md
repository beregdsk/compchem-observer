# Event data schema

One YAML file per event at `data/events/<start-year>/<id>.yaml`. The JSON Schema in `schema/event.schema.json` must implement this document exactly. If they disagree, fix the code, not the document, unless the change is deliberate (see AGENTS.md rule 6).

## Fields

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | Pattern `^[a-z0-9]+(-[a-z0-9]+)*-\d{4}$`, ending with the start year. Must equal the file name without `.yaml`. Example: `euchems-compchem-2027`. |
| `title` | string | yes | Official event name, 5-140 characters. |
| `aliases` | string[] | no | Other names of the event, 2-140 characters each, unique; must differ from `title`. When `title` is an English translation, the original-language title goes here. |
| `series` | string | no | Slug shared by recurring editions (for example `euchems-compchem`). |
| `type` | enum | yes | `conference`, `workshop`, `school`, `symposium`, `webinar`, `hackathon`. |
| `start_date` | date | yes | `YYYY-MM-DD`, a real calendar date (every `date` field is checked this way). |
| `end_date` | date | yes | `YYYY-MM-DD`, on or after `start_date`. Same day is allowed. |
| `format` | enum | yes | `in-person`, `hybrid`, `online`. |
| `location` | object | if `format` is not `online` | `city` (string, required), `country` (ISO 3166-1 alpha-2, uppercase, required), `venue` (string, optional). |
| `url` | string | yes | Official event page. `https://` required. |
| `source_url` | string | no | Page where the dates were verified, if different from `url`. Must be on the organiser's official site. |
| `organizer` | string | no | Organising body or society. |
| `cost` | string | no | Registration cost as the organiser states it, 1-200 characters, e.g. `Free` or `€200 early bird, €300 after 1 May`. Shown on the event page. |
| `fee` | enum | no | `free` or `paid`: whether attending costs anything, as the organiser's page states it. `paid` whenever any registration fee applies, even with waivers or student rates. Omit when the page does not say. Drives the home page's cost filter; an event without it matches only "any". |
| `topics` | string[] | yes | 1-5 unique values from `data/topics.yaml`. |
| `description` | string | yes | Own words, 600 characters or fewer, plain text. A mailing-list post that links no page of its own (`url` and `source_url` both the list's page in `data/sources.yaml`) keeps its full text instead, up to 8,000 characters. |
| `deadlines` | object[] | no | See below. |
| `status` | enum | no | `scheduled` (default), `postponed`, `cancelled`. |
| `status_note` | string | if `status` is not `scheduled` | Short explanation, 200 characters or fewer. |
| `added` | date | yes | Date the entry was first added. |
| `fixture` | boolean | no | `true` for fake development data. Excluded from production builds. |

### Deadline objects

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | enum | yes | `abstract`, `registration`, `early_bird`, `travel_grant`, `poster`, `application`. |
| `date` | date | yes | `YYYY-MM-DD`. |
| `timezone` | string | no | `AoE` (default, Anywhere on Earth), `UTC`, or an IANA zone name. |
| `note` | string | no | 200 characters or fewer. |

Each `type` may appear at most once per event.

## Semantic rules (enforced by `scripts/validate.ts`)

Errors (fail validation):

1. `id` equals the file name stem and ends with the year of `start_date`; the file sits in the folder for that year.
2. `end_date` is on or after `start_date`.
3. `added` is not in the future.
4. `topics` are all in `data/topics.yaml`; `country` is a valid ISO alpha-2 code.
5. No two events share the same `id`, the same `url`, or the same normalised title plus start date.
6. `url` and `source_url` use `https://` and their host is not in `data/blocklist.yaml`.
7. No deadline date falls after `end_date`.
8. `location` is present unless the format is `online`.
9. `description` is at most 600 characters, unless the event is a mailing-list post that linked no page of its own (`url` and `source_url` both equal a `kind: mailbox` source's `url`), whose full text is kept.

Warnings (reported, do not fail):

1. A deadline falls after `start_date`.
2. `description` looks copied (for example, longer than 200 characters with no full stop, or identical to another event's).
3. `url` is a bare homepage with no path, which often means the event page isn't ready.

## Controlled vocabulary (initial `data/topics.yaml`)

`electronic-structure`, `dft`, `wavefunction-methods`, `excited-states`, `photochemistry`, `quantum-dynamics`, `molecular-dynamics`, `enhanced-sampling`, `biomolecular-simulation`, `soft-matter`, `ml-potentials`, `ml-chemistry`, `cheminformatics`, `drug-design`, `materials-modeling`, `catalysis`, `electrochemistry`, `spectroscopy`, `quantum-computing-chemistry`, `software-hpc`, `education-training`.

Each entry has `slug` and a human-readable `label`. Adding a topic is a schema-level change: keep the list short and reject near-duplicates.

An entry may carry `openalex`: a list of OpenAlex topic ids (`T` plus digits) that sit under it, used only for the statistics on `/topics/` (see `docs/topic-stats.md`). The same OpenAlex topic under two slugs is allowed and warned about. Events, groups and positions are never tagged with OpenAlex ids.

## Region derivation

`regionOf(country)` maps ISO alpha-2 codes to one of: `Europe`, `North America`, `Latin America`, `Asia`, `Middle East`, `Africa`, `Oceania`, plus `Online` when the format is online. Keep the lookup table in `src/lib/regions.ts` with a test that every code in the table is valid.

## Example (fictional; do not treat as real)

```yaml
id: example-excited-states-workshop-2027
title: Example Workshop on Excited-State Methods
series: example-excited-states-workshop
type: workshop
start_date: 2027-03-08
end_date: 2027-03-10
format: in-person
location:
  city: Exampleville
  country: NL
  venue: Example Institute
url: https://example.org/excited-states-2027/
organizer: Example Institute
topics: [excited-states, wavefunction-methods, spectroscopy]
description: Three days of talks and tutorials on wavefunction and TDDFT approaches to excited states, aimed at early-career researchers.
deadlines:
  - type: abstract
    date: 2027-01-15
  - type: registration
    date: 2027-02-15
    timezone: UTC
status: scheduled
added: 2026-09-20
fixture: true
```

## Public JSON export (`/events.json`)

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-20T06:00:00Z",
  "count": 0,
  "events": [ /* every non-fixture event, same field names as above, plus "region" and "status_derived" */ ]
}
```

> `schema_version` is `1`. Field names in the export are a public API. Additions are fine; renames and removals need a `schema_version` bump and a note in the README.
