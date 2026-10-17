import type { Bag, Participant, ShirtSize } from './types.js';

export interface ShirtInventorySummary {
  sizeCounts: Record<ShirtSize, number>;
  totalShirts: number;
  totalParticipants: number;
  activeShirts: number;
  activeParticipants: number;
  pendingOrderIdCount: number;
  totalBags: number;
  packedBags: number;
  unpackedBags: number;
  pickedUpBags: number;
  unpickedUpBags: number;
  waiversSignedCount: number;
  waiversMissingCount: number;
}

export const ALL_SHIRT_SIZES: ShirtSize[] = [
  'Youth S',
  'Youth M',
  'Youth L',
  'Adult S',
  'Adult M',
  'Adult L',
  'Adult XL',
  'Adult 2XL',
  'Unknown',
];

export function calculateShirtInventory(
  participants: Record<string, Participant>,
  bags: Record<string, Bag>
): ShirtInventorySummary {
  const sizeCounts: Record<ShirtSize, number> = {
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

  let waiversSignedCount = 0;
  let waiversMissingCount = 0;
  let pendingOrderIdCount = 0;
  let activeCount = 0;

  const pList = Object.values(participants);
  for (const p of pList) {
    if (p.hasOrderId === false) {
      pendingOrderIdCount++;
    } else {
      activeCount++;
      if (sizeCounts[p.shirtSize] !== undefined) {
        sizeCounts[p.shirtSize]++;
      } else {
        sizeCounts['Unknown']++;
      }
    }

    if (p.waiverSigned) {
      waiversSignedCount++;
    } else {
      waiversMissingCount++;
    }
  }

  const bagList = Object.values(bags);
  const packedBags = bagList.filter(b => b.packed).length;
  const pickedUpBags = bagList.filter(b => b.pickedUp).length;

  return {
    sizeCounts,
    totalShirts: pList.length,
    totalParticipants: pList.length,
    activeShirts: activeCount,
    activeParticipants: activeCount,
    pendingOrderIdCount,
    totalBags: bagList.length,
    packedBags,
    unpackedBags: bagList.length - packedBags,
    pickedUpBags,
    unpickedUpBags: bagList.length - pickedUpBags,
    waiversSignedCount,
    waiversMissingCount,
  };
}

export function getBagShirtSummary(bag: Bag, participants: Record<string, Participant>): Record<ShirtSize, number> {
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

  bag.participantIds.forEach(id => {
    const p = participants[id];
    if (p && counts[p.shirtSize] !== undefined) {
      counts[p.shirtSize]++;
    }
  });

  return counts;
}
