The JSON Schema in `schema/position.schema.json` must implement this document exactly.

# Position schema

One YAML file per position at `data/positions/<added-year>/<id>.yaml`. Unknown fields are errors. To close a position early, set `deadline` to a past date.

| Field         | Type     | Required | Rules                                                                                                                                  |
| ------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string   | yes      | `^[a-z0-9]+(-[a-z0-9]+)*-\d{4}$`, ending with the year of `added`. Equals the file name without `.yaml`.                               |
| `title`       | string   | yes      | 5-140 characters.                                                                                                                      |
| `aliases`     | string[] | no       | Other titles, 2-140 characters each, unique, different from `title`; the original-language title when `title` is a translation.        |
| `level`       | enum     | yes      | `phd`, `postdoc`, `permanent` (research scientist, lecturer, faculty).                                                                 |
| `institution` | string   | yes      | 2-140 characters.                                                                                                                      |
| `group`       | string   | no       | Research group or PI, 2-140 characters.                                                                                                |
| `location`    | object   | yes      | `city` (string, 1–100 characters, required), `country` (ISO 3166-1 alpha-2, uppercase, required).                                      |
| `url`         | string   | yes      | The advert, `https://`. Host not on `data/blocklist.yaml`. Falls back to the post it was found in when that post links no advert.      |
| `source_url`  | string   | no       | Where it was found. `https://`. Equals `url` when the post linked no advert; that equality is how shared fallback URLs are recognised. |
| `deadline`    | date     | no       | Application deadline, `YYYY-MM-DD`, a real calendar date (as is `added`). Omitted when the advert states none.                         |
| `topics`      | string[] | yes      | 1-5 unique slugs from `data/topics.yaml`.                                                                                              |
| `description` | string   | yes      | Own words, plain text, 1–600 characters; a linkless mailing-list post keeps its full text (up to 8,000), as for events.                |
| `added`       | date     | yes      | Date first seen. Not in the future.                                                                                                    |
| `fixture`     | boolean  | no       | Development data; excluded from production builds.                                                                                     |

## Derived status

Computed for a given `today` (UTC calendar dates, never local time), never stored:

- **open**: `deadline >= today`, or no deadline and `today - added < 45` days.
- **stale**: no deadline and `45 <= today - added < 90` days.
- **archived**: `deadline < today`, or no deadline and `today - added >= 90`.

## Validation rules

- The id, the file name and the `added`-year folder agree.
- `added` is not in the future.
- Every topic is in the vocabulary (`data/topics.yaml`).
- The country is in the region table (`src/lib/regions.ts`).
- `url` and `source_url` are https and their hosts are not blocklisted.
- No duplicate id.
- No duplicate `url`, unless the `url` equals its own `source_url` (the fallback for a post that linked no advert, which many positions may share).
- No duplicate title at the same institution.
- Warning: a description over 200 characters with no full stop looks copied.
