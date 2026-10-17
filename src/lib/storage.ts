import type { AppState, Bag, Participant, ReviewIssue, ShirtSize } from './types.js';
import { groupParticipantsIntoBags } from './grouping.js';

const STORAGE_KEY = 'mtpef_turkey_trot_2026_state';

const initialEmptyState: AppState = {
  version: 1,
  lastUpdated: new Date().toISOString(),
  participants: {},
  bags: {},
  issues: {},
  importedFiles: {
    dash: false,
    family: false,
    individual: false,
  },
};

export function loadStoredState(): AppState {
  if (typeof window === 'undefined') return initialEmptyState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialEmptyState;
    const parsed = JSON.parse(raw);
    return parsed as AppState;
  } catch (e) {
    console.error('Failed to load state from localStorage:', e);
    return initialEmptyState;
  }
}

export function saveStoredState(state: AppState): void {
  if (typeof window === 'undefined') return;
  try {
    state.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state to localStorage:', e);
  }
}

export function clearStoredState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
