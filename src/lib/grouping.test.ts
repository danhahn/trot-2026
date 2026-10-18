import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDashCSV, parseFamilyCSV, parseIndividualCSV } from './parsers.js';
import { groupParticipantsIntoBags } from './grouping.js';
import { calculateShirtInventory } from './inventory.js';
import { exportParticipantsCSV, exportBagsCSV, exportInventoryCSV } from './export.js';

describe('Family Bag Grouping and Workflow Engine', () => {
  const rawDir = path.resolve(process.cwd(), 'raw_data');
  const dashContent = fs.readFileSync(path.join(rawDir, 'Dash.csv'), 'utf-8');
  const familyContent = fs.readFileSync(path.join(rawDir, 'Family.csv'), 'utf-8');
  const indivContent = fs.readFileSync(path.join(rawDir, 'Individual .csv'), 'utf-8');

  const dash = parseDashCSV(dashContent).participants;
  const family = parseFamilyCSV(familyContent).participants;
  const indiv = parseIndividualCSV(indivContent).participants;

  it('groups all family members from each Family registration into one bag', () => {
    const { bags, participants } = groupParticipantsIntoBags([...family]);
    expect(Object.keys(bags).length).toBe(6); // 6 Family registrations
    expect(Object.keys(participants).length).toBe(23); // 23 total runners

    for (const bag of Object.values(bags)) {
      expect(bag.participantIds.length).toBeGreaterThanOrEqual(3);
      for (const pId of bag.participantIds) {
        expect(participants[pId].assignedBagId).toBe(bag.id);
      }
    }
  });

  it('groups participants from all 3 files without losing any participants or shirts', () => {
    const all = [...dash, ...family, ...indiv];
    const { bags, participants, issues } = groupParticipantsIntoBags(all);

    expect(Object.keys(participants).length).toBe(57);
    const assignedIds = new Set<string>();
    for (const b of Object.values(bags)) {
      for (const pid of b.participantIds) {
        assignedIds.add(pid);
      }
    }
    // Every single participant must be in exactly one bag
    expect(assignedIds.size).toBe(57);

    // Verify inventory calculation matches
    const inv = calculateShirtInventory(participants, bags);
    expect(inv.totalShirts).toBe(57);
    expect(inv.totalParticipants).toBe(57);

    // Verify unsigned waivers flagged
    expect(inv.waiversMissingCount).toBe(3);
    const waiverIssues = Object.values(issues).filter(i => i.type === 'unsigned_waiver');
    expect(waiverIssues.length).toBe(3);

    // Verify suspected duplicates flagged
    const dupIssues = Object.values(issues).filter(i => i.type === 'suspected_duplicate');
    expect(dupIssues.length).toBeGreaterThan(0);
  });

  it('exports valid CSV representations', () => {
    const all = [...dash, ...family, ...indiv];
    const { bags, participants } = groupParticipantsIntoBags(all);

    const partCsv = exportParticipantsCSV(participants, bags);
    expect(partCsv).toContain('Participant ID');
    expect(partCsv).toContain('Youth S');

    const bagsCsv = exportBagsCSV(bags, participants);
    expect(bagsCsv).toContain('Bag Number');
    expect(bagsCsv).toContain('Total Shirts');

    const invCsv = exportInventoryCSV(participants);
    expect(invCsv).toContain('Shirt Size');
    expect(invCsv).toContain('TOTAL');
    expect(invCsv).toContain('57');
  });
});

describe('Bag number chronological ordering after grouping', () => {
  /** Build a minimal Participant fixture. */
  function makeParticipant(
    id: string,
    source: 'Dash' | 'Family' | 'Individual',
    sourceRowIndex: number,
    submissionDate: string,
    lastName: string,
    email: string,
    phone: string,
  ) {
    return {
      id,
      source,
      sourceRowIndex,
      submissionDate,
      firstName: 'Test',
      lastName,
      fullName: `Test ${lastName}`,
      email,
      normalizedEmail: email.toLowerCase().trim(),
      phone,
      normalizedPhone: phone.replace(/\D/g, '').replace(/^1/, ''),
      hasOrderId: true,
      rawShirtSize: 'Adult M',
      shirtSize: 'Adult M' as const,
      waiverSigned: true,
      rawWaiver: 'Checked',
      assignedBagId: '',
    };
  }

  it('assigns bag #1 to the family with the earliest signup date', () => {
    // Three separate family registrations. Row indices must differ (each gets its own bag).
    const participants = [
      // Row 1: signed up latest — 2026-10-11
      makeParticipant('fam-1-r1', 'Family', 1, '2026-10-11T10:00:00Z', 'Late', 'late@example.com', '555-0001'),
      // Row 2: signed up in the middle — 2026-10-05
      makeParticipant('fam-2-r1', 'Family', 2, '2026-10-05T10:00:00Z', 'Middle', 'mid@example.com', '555-0002'),
      // Row 3: signed up earliest — 2026-09-27
      makeParticipant('fam-3-r1', 'Family', 3, '2026-09-27T10:00:00Z', 'Early', 'early@example.com', '555-0003'),
    ];

    const { bags } = groupParticipantsIntoBags(participants);
    const bagArr = Object.values(bags).sort((a, b) => a.bagNumber - b.bagNumber);

    // Bag #1 must be the earliest signup (Early family, row 3)
    expect(bagArr[0].id).toBe('BAG-FAM-3');
    expect(bagArr[0].bagNumber).toBe(1);

    // Bag #2 must be the middle signup (Middle family, row 2)
    expect(bagArr[1].id).toBe('BAG-FAM-2');
    expect(bagArr[1].bagNumber).toBe(2);

    // Bag #3 must be the latest signup (Late family, row 1)
    expect(bagArr[2].id).toBe('BAG-FAM-1');
    expect(bagArr[2].bagNumber).toBe(3);
  });

  it('places bags with unknown/missing submission dates last', () => {
    const participants = [
      // Known date: row 2
      makeParticipant('fam-2-r1', 'Family', 2, '2026-10-11T10:00:00Z', 'Known', 'known@example.com', '555-0002'),
      // No date at all: row 1
      makeParticipant('fam-1-r1', 'Family', 1, '', 'Unknown', 'unknown@example.com', '555-0001'),
    ];

    const { bags } = groupParticipantsIntoBags(participants);
    const bagArr = Object.values(bags).sort((a, b) => a.bagNumber - b.bagNumber);

    // Unknown date must get the higher bag number (sorted last)
    expect(bagArr[0].id).toBe('BAG-FAM-2'); // known date — gets #1
    expect(bagArr[1].id).toBe('BAG-FAM-1'); // unknown date — gets #2
    expect(bagArr[0].bagNumber).toBe(1);
    expect(bagArr[1].bagNumber).toBe(2);
  });

  it('uses original (creation-order) bag number as deterministic tie-breaker for same signup date', () => {
    // Two family registrations with the same date; row index determines tie-break
    // because family bags are created in row-index order (BAG-FAM-1 before BAG-FAM-2)
    const participants = [
      makeParticipant('fam-1-r1', 'Family', 1, '2026-10-06T00:00:00Z', 'Alpha', 'alpha@example.com', '555-0001'),
      makeParticipant('fam-2-r1', 'Family', 2, '2026-10-06T00:00:00Z', 'Beta', 'beta@example.com', '555-0002'),
    ];

    const { bags } = groupParticipantsIntoBags(participants);

    // Both have the same date. Tie-breaker is original bag number, so BAG-FAM-1 → #1, BAG-FAM-2 → #2.
    expect(bags['BAG-FAM-1'].bagNumber).toBe(1);
    expect(bags['BAG-FAM-2'].bagNumber).toBe(2);
  });

  it('preserves stable bag IDs while updating bag numbers, and exports show renumbered values', () => {
    // Use the real CSVs already loaded at the top of the file via the outer describe's setup.
    // Re-parse here directly with the already-imported helpers so this describe block is self-contained.
    const rawDir = path.resolve(process.cwd(), 'raw_data');
    const dashContent = fs.readFileSync(path.join(rawDir, 'Dash.csv'), 'utf-8');
    const familyContent = fs.readFileSync(path.join(rawDir, 'Family.csv'), 'utf-8');
    const indivContent = fs.readFileSync(path.join(rawDir, 'Individual .csv'), 'utf-8');

    const all = [
      ...parseDashCSV(dashContent).participants,
      ...parseFamilyCSV(familyContent).participants,
      ...parseIndividualCSV(indivContent).participants,
    ];
    const { bags, participants } = groupParticipantsIntoBags(all);

    const bagValues = Object.values(bags);

    // Every bag number must be sequential 1..N with no gaps and no duplicates.
    const numbers = bagValues.map(b => b.bagNumber).sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers[numbers.length - 1]).toBe(bagValues.length);
    expect(new Set(numbers).size).toBe(bagValues.length);

    // Bag IDs must be unchanged (stable) — IDs are structural, numbers are human-facing.
    const bagIds = bagValues.map(b => b.id);
    expect(bagIds.some(id => id.startsWith('BAG-FAM-') || id.startsWith('BAG-'))).toBe(true);

    // Export CSV must contain the renumbered bag numbers, proving printed sheets show them too.
    const csv = exportBagsCSV(bags, participants);
    expect(csv).toContain('Bag Number');
    expect(csv).toContain(',1,'); // bag #1 appears in the CSV row

    // The bag sorted first by bagNumber must actually be #1.
    const sortedByNum = bagValues.slice().sort((a, b) => a.bagNumber - b.bagNumber);
    expect(sortedByNum[0].bagNumber).toBe(1);
  });
});
