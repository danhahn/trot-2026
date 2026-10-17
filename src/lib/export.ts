import Papa from 'papaparse';
import type { AppState, Bag, Participant, ShirtSize } from './types.js';
import { ALL_SHIRT_SIZES } from './inventory.js';

export function exportParticipantsCSV(participants: Record<string, Participant>, bags: Record<string, Bag>): string {
  const rows = Object.values(participants).map(p => {
    const bag = bags[p.assignedBagId];
    return {
      'Participant ID': p.id,
      'Source Registration': p.source,
      'First Name': p.firstName,
      'Last Name': p.lastName,
      'Full Name': p.fullName,
      'Shirt Size': p.shirtSize,
      'Raw Shirt Size': p.rawShirtSize,
      'Waiver Signed': p.waiverSigned ? 'Yes' : 'No',
      'Assigned Bag Number': bag ? bag.bagNumber : '',
      'Assigned Bag Name': bag ? bag.familyName : '',
      'Email': p.email,
      'Phone': p.phone,
      'Age/Birthday': p.age || '',
      'Grade': p.grade || '',
      'Teacher': p.teacher || '',
      'Gender': p.gender || '',
      'Notes': p.notes || '',
    };
  });

  return Papa.unparse(rows);
}

export function exportBagsCSV(bags: Record<string, Bag>, participants: Record<string, Participant>): string {
  const rows = Object.values(bags).sort((a, b) => a.bagNumber - b.bagNumber).map(b => {
    const bagParticipants = b.participantIds.map(id => participants[id]).filter(Boolean);
    const shirtSummary = bagParticipants.map(p => `${p.fullName} (${p.shirtSize})`).join('; ');
    const allWaiversSigned = bagParticipants.every(p => p.waiverSigned);

    return {
      'Bag Number': b.bagNumber,
      'Bag ID': b.id,
      'Family / Label': b.familyName,
      'Primary Contact': b.primaryContactName,
      'Primary Email': b.primaryEmail,
      'Primary Phone': b.primaryPhone,
      'Total Shirts': bagParticipants.length,
      'Participants & Shirts': shirtSummary,
      'Packed': b.packed ? 'Yes' : 'No',
      'Picked Up': b.pickedUp ? 'Yes' : 'No',
      'All Waivers Signed': allWaiversSigned ? 'Yes' : 'No',
      'Packed Timestamp': b.packedAt || '',
      'Picked Up Timestamp': b.pickedUpAt || '',
    };
  });

  return Papa.unparse(rows);
}

export function exportInventoryCSV(participants: Record<string, Participant>): string {
  const counts: Record<ShirtSize, number> = {
    'Youth S': 0,
    'Youth M': 0,
    'Youth L': 0,
    'Adult S': 0,
    'Adult M': 0,
    'Adult L': 0,
    'Adult XL': 0,
    'Adult 2XL': 0,
    'Unknown': 0,
  };

  Object.values(participants).forEach(p => {
    counts[p.shirtSize] = (counts[p.shirtSize] || 0) + 1;
  });

  const rows = ALL_SHIRT_SIZES.map(size => ({
    'Shirt Size': size,
    'Count': counts[size] || 0,
  }));

  rows.push({
    'Shirt Size': 'TOTAL' as any,
    'Count': Object.values(counts).reduce((a, b) => a + b, 0),
  });

  return Papa.unparse(rows);
}

export function exportFullBackupJSON(state: AppState): string {
  return JSON.stringify(state, null, 2);
}

export function validateAndParseBackupJSON(jsonStr: string): AppState {
  const parsed = JSON.parse(jsonStr);
  if (!parsed.participants || !parsed.bags || !parsed.issues) {
    throw new Error('Invalid backup file: missing required state properties (participants, bags, issues).');
  }
  return parsed as AppState;
}
