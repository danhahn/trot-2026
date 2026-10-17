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
