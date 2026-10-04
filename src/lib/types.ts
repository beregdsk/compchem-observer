import type { ISODate } from './dates';
import type { DisplayRegion } from './regions';

export const EVENT_TYPES = [
  'conference',
  'workshop',
  'school',
  'symposium',
  'webinar',
  'hackathon',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_FORMATS = ['in-person', 'hybrid', 'online'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const DEADLINE_TYPES = [
  'abstract',
  'registration',
  'early_bird',
  'travel_grant',
  'poster',
  'application',
] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];

/** Whether attending costs anything. `cost` says how much; this is what filters use. */
export const EVENT_FEES = ['free', 'paid'] as const;
export type EventFee = (typeof EVENT_FEES)[number];

export const EVENT_STATUSES = ['scheduled', 'postponed', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Derived from the build date, not stored in the YAML. */
export type DerivedStatus = 'upcoming' | 'ongoing' | 'past';

export interface Deadline {
  type: DeadlineType;
  date: ISODate;
  /** `AoE` (default), `UTC`, or an IANA zone name. */
  timezone?: string;
  note?: string;
}

export interface EventLocation {
  city: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string;
  venue?: string;
}

/** An event exactly as it appears in its YAML file. */
export interface RawEvent {
  id: string;
  title: string;
  /** Other titles, such as the original-language one when `title` is a translation. */
  aliases?: string[];
  series?: string;
  type: EventType;
  start_date: ISODate;
  end_date: ISODate;
  format: EventFormat;
  location?: EventLocation;
  url: string;
  source_url?: string;
  organizer?: string;
  /** A short phrase for registration cost or fees, e.g. "Free" or "€200 early bird". */
  cost?: string;
  fee?: EventFee;
  topics: string[];
  description: string;
  deadlines?: Deadline[];
  status?: EventStatus;
  status_note?: string;
  added: ISODate;
  fixture?: boolean;
}

/** A `RawEvent` after the loader has derived display fields. */
export interface LoadedEvent extends RawEvent {
  region: DisplayRegion;
  status_derived: DerivedStatus;
}

export interface Topic {
  slug: string;
  label: string;
  /** OpenAlex topic ids (`T11948`) under this site topic; see docs/topic-stats.md. */
  openalex?: string[];
}

export const POSITION_LEVELS = ['phd', 'postdoc', 'permanent'] as const;
export type PositionLevel = (typeof POSITION_LEVELS)[number];

/** How each level reads on the page. `permanent` covers research scientist, lecturer and faculty. */
export const POSITION_LEVEL_LABELS: Readonly<Record<PositionLevel, string>> = {
  phd: 'PhD',
  postdoc: 'Postdoc',
  permanent: 'Permanent',
};

/** A position exactly as it appears in its YAML file. See docs/position-schema.md. */
export interface RawPosition {
  id: string;
  title: string;
  /** Other titles, such as the original-language one when `title` is a translation. */
  aliases?: string[];
  level: PositionLevel;
  institution: string;
  group?: string;
  location: { city: string; country: string };
  url: string;
  source_url?: string;
  deadline?: ISODate;
  topics: string[];
  description: string;
  added: ISODate;
  fixture?: boolean;
}

/** Derived from the build date, never stored. */
export type PositionStatus = 'open' | 'stale' | 'archived';

export interface LoadedPosition extends RawPosition {
  status_derived: PositionStatus;
  /** Whole days from `added` to the build date. */
  age_days: number;
}

export const GROUP_KINDS = ['group', 'institute', 'network', 'society'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** Section headings on /groups/, in page order. */
export const GROUP_KIND_LABELS: Readonly<Record<GroupKind, string>> = {
  group: 'Research groups',
  institute: 'Institutes',
  network: 'Networks',
  society: 'Societies',
};

/** A registry entry exactly as it appears in its YAML file. See docs/group-schema.md. */
export interface RawGroup {
  id: string;
  name: string;
  aliases?: string[];
  kind: GroupKind;
  pi?: string;
  parent?: string;
  website: string;
  source_url?: string;
  location?: { city: string; country: string };
  topics: string[];
  description: string;
  added: ISODate;
  fixture?: boolean;
}
