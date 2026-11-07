import type { NewBook } from '@higalibra/scraping';

export type MatchOperator = 'and' | 'or';

export interface ReservationCriterion {
  operator: MatchOperator;
  values: string[];
}

export interface ReservationSettings {
  publishers: ReservationCriterion;
  authors: ReservationCriterion;
  titleKeywords: ReservationCriterion;
}

export const EMPTY_RESERVATION_SETTINGS: ReservationSettings = {
  publishers: { operator: 'or', values: [] },
  authors: { operator: 'or', values: [] },
  titleKeywords: { operator: 'or', values: [] },
};

export function reservationSettingsObjectKey(
  prefix: string,
  cardNo: string,
): string {
  return `${prefix}/${encodeURIComponent(cardNo)}.json`;
}

const MAX_VALUES_PER_CRITERION = 20;
const MAX_VALUE_LENGTH = 100;

export function parseReservationSettings(value: unknown): ReservationSettings {
  if (!isRecord(value)) {
    throw new Error('Reservation settings must be a JSON object.');
  }
  return {
    publishers: parseCriterion(value.publishers, 'publishers'),
    authors: parseCriterion(value.authors, 'authors'),
    titleKeywords: parseCriterion(value.titleKeywords, 'titleKeywords'),
  };
}

export function hasActiveReservationSettings(
  settings: ReservationSettings,
): boolean {
  return (
    settings.publishers.values.length > 0 ||
    settings.authors.values.length > 0 ||
    settings.titleKeywords.values.length > 0
  );
}

export function matchesReservationSettings(
  book: NewBook,
  settings: ReservationSettings,
): boolean {
  if (!hasActiveReservationSettings(settings)) return false;
  return (
    matchesCriterion(book.publisher, settings.publishers, false) &&
    matchesCriterion(book.author, settings.authors, false) &&
    matchesCriterion(book.title, settings.titleKeywords, true)
  );
}

function matchesCriterion(
  actualValue: string,
  criterion: ReservationCriterion,
  substring: boolean,
): boolean {
  if (criterion.values.length === 0) return true;
  const actual = normalize(actualValue);
  const valueMatches = criterion.values.map((value) => {
    const expected = normalize(value);
    return substring ? actual.includes(expected) : actual === expected;
  });
  return criterion.operator === 'and'
    ? valueMatches.every(Boolean)
    : valueMatches.some(Boolean);
}

function parseCriterion(value: unknown, name: string): ReservationCriterion {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    throw new Error(`Reservation setting ${name} must include a values array.`);
  }
  if (value.operator !== 'and' && value.operator !== 'or') {
    throw new Error(`Reservation setting ${name} has an invalid operator.`);
  }
  if (value.values.length > MAX_VALUES_PER_CRITERION) {
    throw new Error(
      `Reservation setting ${name} supports at most ${MAX_VALUES_PER_CRITERION} values.`,
    );
  }
  const values = value.values.map((item, index) => {
    if (typeof item !== 'string') {
      throw new Error(
        `Reservation setting ${name} value ${index + 1} must be a string.`,
      );
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_VALUE_LENGTH) {
      throw new Error(
        `Reservation setting ${name} values must contain 1-${MAX_VALUE_LENGTH} characters.`,
      );
    }
    return trimmed;
  });
  return { operator: value.operator, values };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('ja-JP');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
