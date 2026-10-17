import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDashCSV, parseFamilyCSV, parseIndividualCSV } from './parsers.js';
import { groupParticipantsIntoBags } from './grouping.js';
import { calculateShirtInventory } from './inventory.js';

describe('End to End Data Reconciliation', () => {
  const rawDir = path.resolve(process.cwd(), 'raw_data');

  it('guarantees 0 lost shirts and 0 silent drops from CSV raw files', () => {
    const dashText = fs.readFileSync(path.join(rawDir, 'Dash.csv'), 'utf-8');
    const familyText = fs.readFileSync(path.join(rawDir, 'Family.csv'), 'utf-8');
    const indivText = fs.readFileSync(path.join(rawDir, 'Individual .csv'), 'utf-8');

    const dashRes = parseDashCSV(dashText);
    const familyRes = parseFamilyCSV(familyText);
    const indivRes = parseIndividualCSV(indivText);

    expect(dashRes.errors).toHaveLength(0);
    expect(familyRes.errors).toHaveLength(0);
    expect(indivRes.errors).toHaveLength(0);

    const all = [...dashRes.participants, ...familyRes.participants, ...indivRes.participants];
    expect(all).toHaveLength(57);

    const { bags, participants, issues } = groupParticipantsIntoBags(all);

    // Check all participants present in participants map
    expect(Object.keys(participants)).toHaveLength(57);

    // Sum of participants in all bags
    let totalInBags = 0;
    for (const b of Object.values(bags)) {
      totalInBags += b.participantIds.length;
    }
    expect(totalInBags).toBe(57);

    // Inventory calculation
    const inv = calculateShirtInventory(participants, bags);
    expect(inv.totalShirts).toBe(57);
    expect(inv.sizeCounts['Youth S']).toBe(20);
    expect(inv.sizeCounts['Youth M']).toBe(10);
    expect(inv.sizeCounts['Youth L']).toBe(4);
    expect(inv.sizeCounts['Adult S']).toBe(9);
    expect(inv.sizeCounts['Adult M']).toBe(7);
    expect(inv.sizeCounts['Adult L']).toBe(7);
    expect(inv.sizeCounts['Unknown']).toBe(0);

    // Ensure raw_data files are strictly untouched
    const dashStat = fs.statSync(path.join(rawDir, 'Dash.csv'));
    expect(dashStat.size).toBe(3184);
  });
});
