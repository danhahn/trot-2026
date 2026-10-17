import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseDashCSV, parseFamilyCSV, parseIndividualCSV } from './parsers.js';
import { normalizeShirtSize } from './normalizers.js';

describe('CSV Parsers with Real Data', () => {
  const rawDir = path.resolve(process.cwd(), 'raw_data');

  it('correctly parses Dash.csv without modifying raw data', () => {
    const content = fs.readFileSync(path.join(rawDir, 'Dash.csv'), 'utf-8');
    const result = parseDashCSV(content);

    expect(result.errors).toEqual([]);
    expect(result.participants.length).toBe(27);

    // Verify Youth vs Adult S normalization
    // In Dash, "Other: As" and "Other: AS" are Adult S, plain S is Youth S
    const adultSmallParticipants = result.participants.filter(p => p.shirtSize === 'Adult S');
    expect(adultSmallParticipants.length).toBe(3);

    const youthSmallParticipants = result.participants.filter(p => p.shirtSize === 'Youth S');
    expect(youthSmallParticipants.length).toBe(14);

    const youthMedParticipants = result.participants.filter(p => p.shirtSize === 'Youth M');
    expect(youthMedParticipants.length).toBe(7);

    const youthLargeParticipants = result.participants.filter(p => p.shirtSize === 'Youth L');
    expect(youthLargeParticipants.length).toBe(3);

    expect(result.participants.every(p => p.source === 'Dash')).toBe(true);
  });

  it('correctly parses Family.csv and maps duplicate shirt headers to runner 5 and 6 slots', () => {
    const content = fs.readFileSync(path.join(rawDir, 'Family.csv'), 'utf-8');
    const result = parseFamilyCSV(content);

    expect(result.errors).toEqual([]);
    // Total populated runners in Family.csv is 23 (Row 1: 4, Row 2: 4, Row 3: 4, Row 4: 4, Row 5: 3, Row 6: 4)
    expect(result.participants.length).toBe(23);

    // Verify row 5 which only has runner 1, runner 3, runner 4 (runner 2 was blank)
    const row5Runners = result.participants.filter(p => p.id.startsWith('family-5-'));
    expect(row5Runners.length).toBe(3);
    expect(row5Runners.map(r => r.shirtSize)).toEqual(['Adult M', 'Youth M', 'Youth S']);

    // Check sizes across all 23 family runners
    const sizes = result.participants.map(p => p.shirtSize);
    expect(sizes.filter(s => s === 'Adult L').length).toBe(4);
    expect(sizes.filter(s => s === 'Adult M').length).toBe(4);
    expect(sizes.filter(s => s === 'Adult S').length).toBe(5);
    expect(sizes.filter(s => s === 'Youth S').length).toBe(6);
    expect(sizes.filter(s => s === 'Youth M').length).toBe(3);
    expect(sizes.filter(s => s === 'Youth L').length).toBe(1);
    expect(sizes.filter(s => s === 'Unknown').length).toBe(0);
  });

  it('correctly parses Individual .csv with space in filename', () => {
    const content = fs.readFileSync(path.join(rawDir, 'Individual .csv'), 'utf-8');
    const result = parseIndividualCSV(content);

    expect(result.errors).toEqual([]);
    expect(result.participants.length).toBe(7);

    const sizes = result.participants.map(p => p.shirtSize);
    expect(sizes.filter(s => s === 'Adult S').length).toBe(1);
    expect(sizes.filter(s => s === 'Adult M').length).toBe(3);
    expect(sizes.filter(s => s === 'Adult L').length).toBe(3);
  });

  it('reconciles total shirts across all 3 files exactly', () => {
    const dashContent = fs.readFileSync(path.join(rawDir, 'Dash.csv'), 'utf-8');
    const familyContent = fs.readFileSync(path.join(rawDir, 'Family.csv'), 'utf-8');
    const indivContent = fs.readFileSync(path.join(rawDir, 'Individual .csv'), 'utf-8');

    const dash = parseDashCSV(dashContent).participants;
    const family = parseFamilyCSV(familyContent).participants;
    const indiv = parseIndividualCSV(indivContent).participants;

    const totalParticipants = dash.length + family.length + indiv.length;
    // 27 + 23 + 7 = 57
    expect(totalParticipants).toBe(57);

    const all = [...dash, ...family, ...indiv];
    const sizeCounts: Record<string, number> = {};
    for (const p of all) {
      sizeCounts[p.shirtSize] = (sizeCounts[p.shirtSize] || 0) + 1;
    }

    expect(sizeCounts).toEqual({
      'Youth S': 20, // Dash: 14 + Family: 6 = 20
      'Youth M': 10, // Dash: 7 + Family: 3 = 10
      'Youth L': 4,  // Dash: 3 + Family: 1 = 4
      'Adult S': 9,  // Dash: 3 + Family: 5 + Indiv: 1 = 9
      'Adult M': 7,  // Dash: 0 + Family: 4 + Indiv: 3 = 7
      'Adult L': 7,  // Dash: 0 + Family: 4 + Indiv: 3 = 7
    });

    const sumShirts = Object.values(sizeCounts).reduce((a, b) => a + b, 0);
    expect(sumShirts).toBe(57);
  });
});
