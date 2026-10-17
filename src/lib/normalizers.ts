import type { ShirtSize } from './types.js';

export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  // Keep only digits
  const digits = phone.replace(/\D/g, '');
  // If it starts with 1 and is 11 digits, strip leading 1
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1);
  }
  return digits;
}

export function formatPhone(phone: string | null | undefined): string {
  const norm = normalizePhone(phone);
  if (norm.length === 10) {
    return `(${norm.slice(0, 3)}) ${norm.slice(3, 6)}-${norm.slice(6)}`;
  }
  return phone?.trim() || '';
}

export function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes shirt size.
 * In Dash: 'Youth Shirt Size' column contains 'S', 'M', 'L' which are youth sizes,
 * or 'Other: As' / 'Other: AS' which are Adult Small!
 * In Family: values are 'YS', 'YM', 'YL', 'S', 'M', 'L'
 * In Individual: 'T-Shirt Size' contains 'S', 'M', 'L' (Adult sizes)
 */
export function normalizeShirtSize(raw: string | null | undefined, source: 'Dash' | 'Family' | 'Individual'): ShirtSize {
  if (!raw) return 'Unknown';
  const val = raw.trim();
  const lower = val.toLowerCase();

  // Explicit 'Other: AS' or 'Other: As' or 'AS'
  if (lower === 'other: as' || lower === 'as' || lower === 'adult s' || lower === 'adult small') {
    return 'Adult S';
  }
  if (lower === 'other: am' || lower === 'am' || lower === 'adult m' || lower === 'adult medium') {
    return 'Adult M';
  }
  if (lower === 'other: al' || lower === 'al' || lower === 'adult l' || lower === 'adult large') {
    return 'Adult L';
  }
  if (lower === 'other: axl' || lower === 'axl' || lower === 'xl' || lower === 'adult xl') {
    return 'Adult XL';
  }
  if (lower === 'other: a2xl' || lower === '2xl' || lower === 'xxl' || lower === 'adult 2xl') {
    return 'Adult 2XL';
  }

  // Check youth prefixes
  if (lower === 'ys' || lower === 'youth s' || lower === 'youth small') {
    return 'Youth S';
  }
  if (lower === 'ym' || lower === 'youth m' || lower === 'youth medium') {
    return 'Youth M';
  }
  if (lower === 'yl' || lower === 'youth l' || lower === 'youth large') {
    return 'Youth L';
  }

  // Context-dependent single letters 'S', 'M', 'L'
  if (source === 'Dash') {
    // In Dash, column is literally named "Youth Shirt Size"
    if (lower === 's' || lower === 'small') return 'Youth S';
    if (lower === 'm' || lower === 'medium') return 'Youth M';
    if (lower === 'l' || lower === 'large') return 'Youth L';
  } else if (source === 'Individual') {
    // In Individual 5k, column is "T-Shirt Size" and participants are 5k runners (adult sizing standard)
    if (lower === 's' || lower === 'small') return 'Adult S';
    if (lower === 'm' || lower === 'medium') return 'Adult M';
    if (lower === 'l' || lower === 'large') return 'Adult L';
  } else if (source === 'Family') {
    // In Family, YS/YM/YL are explicitly prefixed. Plain S/M/L denote Adult S/M/L
    if (lower === 's' || lower === 'small') return 'Adult S';
    if (lower === 'm' || lower === 'medium') return 'Adult M';
    if (lower === 'l' || lower === 'large') return 'Adult L';
  }

  return 'Unknown';
}

export function isWaiverSigned(rawWaiver: string | null | undefined): boolean {
  if (!rawWaiver) return false;
  const val = rawWaiver.trim().toLowerCase();
  return val === 'checked' || val === 'yes' || val === 'true' || val === 'signed';
}
