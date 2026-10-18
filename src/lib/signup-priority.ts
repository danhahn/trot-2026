import type { Bag, Participant } from './types.js';

/** Registrations submitted on or before this date are guaranteed a shirt. */
export const SHIRT_GUARANTEE_CUTOFF = '2026-10-06';

/** Parse the source submission date into a sortable timestamp. Invalid/missing dates sort last. */
export function parseSubmissionTimestamp(value: string | undefined | null): number | null {
  if (!value?.trim()) return null;
  const input = value.trim();
  // CSV exports currently use ISO timestamps (e.g. 2026-10-11T20:45:18.607Z).
  // Explicitly support date-only ISO values too, and reject invalid calendar dates.
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(input);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  }
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getBagSignupTimestamp(bag: Bag, participants: Record<string, Participant>): number | null {
  const dates = bag.participantIds
    .map(id => parseSubmissionTimestamp(participants[id]?.submissionDate))
    .filter((date): date is number => date !== null);
  return dates.length ? Math.min(...dates) : null;
}

/** Chronological order, with missing dates last and bag number as deterministic tie-breaker. */
export function sortBagsBySignupDate(bags: Bag[], participants: Record<string, Participant>): Bag[] {
  return [...bags].sort((a, b) => {
    const aDate = getBagSignupTimestamp(a, participants);
    const bDate = getBagSignupTimestamp(b, participants);
    if (aDate === null && bDate !== null) return 1;
    if (aDate !== null && bDate === null) return -1;
    if (aDate !== null && bDate !== null && aDate !== bDate) return aDate - bDate;
    return a.bagNumber - b.bagNumber || a.id.localeCompare(b.id);
  });
}

export type ShirtPriority = 'guaranteed' | 'extra' | 'unknown';
export function getParticipantShirtPriority(participant: Participant): ShirtPriority {
  const timestamp = parseSubmissionTimestamp(participant.submissionDate);
  if (timestamp === null) return 'unknown';
  // Compare calendar dates in UTC to avoid local timezone shifting the cutoff.
  const submittedDate = new Date(timestamp).toISOString().slice(0, 10);
  return submittedDate <= SHIRT_GUARANTEE_CUTOFF ? 'guaranteed' : 'extra';
}

export function getBagShirtPriority(bag: Bag, participants: Record<string, Participant>): ShirtPriority | 'mixed' {
  const priorities = new Set(bag.participantIds.map(id => getParticipantShirtPriority(participants[id] ?? ({} as Participant))));
  if (priorities.size > 1) return 'mixed';
  const onlyPriority = [...priorities][0];
  return onlyPriority ?? 'unknown';
}

export function formatSignupDate(value: string | undefined | null): string {
  const timestamp = parseSubmissionTimestamp(value);
  return timestamp === null ? 'Unknown' : new Date(timestamp).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
}
