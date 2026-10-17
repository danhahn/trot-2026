import Papa from 'papaparse';
import type { Participant } from './types.js';
import { normalizeEmail, normalizePhone, normalizeName, normalizeShirtSize, isWaiverSigned } from './normalizers.js';

export interface ParseResult {
  participants: Participant[];
  errors: string[];
  warnings: string[];
}

export function parseDashCSV(csvText: string): ParseResult {
  const parsed = Papa.parse<string[]>(csvText.trim(), {
    header: false,
    skipEmptyLines: true,
  });

  const errors: string[] = [];
  const warnings: string[] = [];
  const participants: Participant[] = [];

  if (parsed.errors.length > 0) {
    parsed.errors.forEach(err => errors.push(`Dash parse error (row ${err.row}): ${err.message}`));
  }

  const rows = parsed.data;
  if (rows.length < 2) {
    errors.push('Dash CSV contains no data rows.');
    return { participants, errors, warnings };
  }

  const header = rows[0].map(h => (h || '').trim());
  const dateCol = header.findIndex(h => /submission date/i.test(h));
  const firstCol = header.findIndex(h => /first name/i.test(h));
  const lastCol = header.findIndex(h => /last name/i.test(h));
  const emailCol = header.findIndex(h => /email/i.test(h));
  const phoneCol = header.findIndex(h => /phone/i.test(h));
  const gradeCol = header.findIndex(h => /grade/i.test(h));
  const shirtCol = header.findIndex(h => /shirt|size/i.test(h));
  const teacherCol = header.findIndex(h => /teacher/i.test(h));
  const waiverCol = header.findIndex(h => /waiver/i.test(h));
  const feeCol = header.findIndex(h => /dash/i.test(h));
  const orderIdCol = header.findIndex(h => /order(\s*id)?|transaction(\s*id)?/i.test(h));

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(cell => !cell.trim())) continue;

    const firstName = normalizeName(firstCol >= 0 ? row[firstCol] : '');
    const lastName = normalizeName(lastCol >= 0 ? row[lastCol] : '');
    const email = (emailCol >= 0 ? row[emailCol] : '').trim();
    const phone = (phoneCol >= 0 ? row[phoneCol] : '').trim();
    const rawShirt = (shirtCol >= 0 ? row[shirtCol] : '').trim();
    const rawWaiver = (waiverCol >= 0 ? row[waiverCol] : '').trim();
    const submissionDate = (dateCol >= 0 ? row[dateCol] : '').trim();
    const grade = (gradeCol >= 0 ? row[gradeCol] : '').trim();
    const teacher = (teacherCol >= 0 ? row[teacherCol] : '').trim();
    const registrationFee = (feeCol >= 0 ? row[feeCol] : '').trim();
    const rawOrderId = orderIdCol >= 0 && orderIdCol < row.length ? row[orderIdCol].trim() : '';

    if (!firstName && !lastName) {
      warnings.push(`Dash row ${i + 1} skipped because name is empty.`);
      continue;
    }

    const participant: Participant = {
      id: `dash-${i}`,
      source: 'Dash',
      sourceRowIndex: i + 1,
      submissionDate,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email,
      normalizedEmail: normalizeEmail(email),
      phone,
      normalizedPhone: normalizePhone(phone),
      orderId: rawOrderId,
      hasOrderId: orderIdCol >= 0 ? Boolean(rawOrderId) : true, // If no Order ID column exists in this CSV, default true
      rawShirtSize: rawShirt,
      shirtSize: normalizeShirtSize(rawShirt, 'Dash'),
      waiverSigned: isWaiverSigned(rawWaiver),
      rawWaiver,
      grade,
      teacher,
      registrationFee,
      assignedBagId: '',
    };

    participants.push(participant);
  }

  return { participants, errors, warnings };
}

export function parseIndividualCSV(csvText: string): ParseResult {
  const parsed = Papa.parse<string[]>(csvText.trim(), {
    header: false,
    skipEmptyLines: true,
  });

  const errors: string[] = [];
  const warnings: string[] = [];
  const participants: Participant[] = [];

  if (parsed.errors.length > 0) {
    parsed.errors.forEach(err => errors.push(`Individual parse error (row ${err.row}): ${err.message}`));
  }

  const rows = parsed.data;
  if (rows.length < 2) {
    errors.push('Individual CSV contains no data rows.');
    return { participants, errors, warnings };
  }

  const header = rows[0].map(h => (h || '').trim());
  const dateCol = header.findIndex(h => /submission date/i.test(h));
  const firstCol = header.findIndex(h => /first name/i.test(h));
  const lastCol = header.findIndex(h => /last name/i.test(h));
  const emailCol = header.findIndex(h => /email/i.test(h));
  const phoneCol = header.findIndex(h => /phone/i.test(h));
  const bdayCol = header.findIndex(h => /birthday|age/i.test(h));
  const genderCol = header.findIndex(h => /gender/i.test(h));
  const shirtCol = header.findIndex(h => /shirt|size/i.test(h));
  const waiverCol = header.findIndex(h => /waiver/i.test(h));
  const feeCol = header.findIndex(h => /individual/i.test(h));
  const orderIdCol = header.findIndex(h => /order(\s*id)?|transaction(\s*id)?/i.test(h));

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(cell => !cell.trim())) continue;

    const firstName = normalizeName(firstCol >= 0 ? row[firstCol] : '');
    const lastName = normalizeName(lastCol >= 0 ? row[lastCol] : '');
    const email = (emailCol >= 0 ? row[emailCol] : '').trim();
    const phone = (phoneCol >= 0 ? row[phoneCol] : '').trim();
    const rawShirt = (shirtCol >= 0 ? row[shirtCol] : '').trim();
    const rawWaiver = (waiverCol >= 0 ? row[waiverCol] : '').trim();
    const submissionDate = (dateCol >= 0 ? row[dateCol] : '').trim();
    const age = (bdayCol >= 0 ? row[bdayCol] : '').trim();
    const gender = (genderCol >= 0 ? row[genderCol] : '').trim();
    const registrationFee = (feeCol >= 0 ? row[feeCol] : '').trim();
    const rawOrderId = orderIdCol >= 0 && orderIdCol < row.length ? row[orderIdCol].trim() : '';

    if (!firstName && !lastName) {
      warnings.push(`Individual row ${i + 1} skipped because name is empty.`);
      continue;
    }

    const participant: Participant = {
      id: `individual-${i}`,
      source: 'Individual',
      sourceRowIndex: i + 1,
      submissionDate,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email,
      normalizedEmail: normalizeEmail(email),
      phone,
      normalizedPhone: normalizePhone(phone),
      orderId: rawOrderId,
      hasOrderId: orderIdCol >= 0 ? Boolean(rawOrderId) : true,
      rawShirtSize: rawShirt,
      shirtSize: normalizeShirtSize(rawShirt, 'Individual'),
      waiverSigned: isWaiverSigned(rawWaiver),
      rawWaiver,
      age,
      gender,
      registrationFee,
      assignedBagId: '',
    };

    participants.push(participant);
  }

  return { participants, errors, warnings };
}

/**
 * Parses Family.csv.
 * CRITICAL DETAIL:
 * In Family.csv, there are up to 6 runners:
 * Runner 1: first name col 4, age col 5, gender col 6, shirt col 7 ('Runner 1 Shirt')
 * Runner 2: first name col 8, age col 9, gender col 10, shirt col 11 ('Runner 2 Shirt')
 * Runner 3: first name col 12, age col 13, grade col 14, teacher col 15, shirt col 16 ('Runner 3 Shirt')
 * Runner 4: first name col 17, age col 18, grade col 19, teacher col 20, shirt col 21 ('Runner 4 Shirt')
 * Runner 5: first name col 22, age col 23, grade col 24, teacher col 25, shirt col 26 (DUPLICATE HEADER: 'Runner 4 Shirt')
 * Runner 6: first name col 27, age col 28, grade col 29, teacher col 30, shirt col 31 (DUPLICATE HEADER: 'Runner 4 Shirt')
 *
 * We identify runner slots by their specific position or finding the 'Runner N first name' columns
 * and mapping the subsequent shirt column relative to that runner section.
 */
export function parseFamilyCSV(csvText: string): ParseResult {
  const parsed = Papa.parse<string[]>(csvText.trim(), {
    header: false,
    skipEmptyLines: true,
  });

  const errors: string[] = [];
  const warnings: string[] = [];
  const participants: Participant[] = [];

  if (parsed.errors.length > 0) {
    parsed.errors.forEach(err => errors.push(`Family parse error (row ${err.row}): ${err.message}`));
  }

  const rows = parsed.data;
  if (rows.length < 2) {
    errors.push('Family CSV contains no data rows.');
    return { participants, errors, warnings };
  }

  const header = rows[0].map(h => (h || '').trim());
  const dateCol = header.findIndex(h => /submission date/i.test(h));
  const familyLastCol = header.findIndex(h => /^last name/i.test(h));
  const emailCol = header.findIndex(h => /email/i.test(h));
  const phoneCol = header.findIndex(h => /phone/i.test(h));
  const waiverCol = header.findIndex(h => /waiver/i.test(h));
  const feeCol = header.findIndex(h => /^family/i.test(h));
  const orderIdCol = header.findIndex(h => /order(\s*id)?|transaction(\s*id)?/i.test(h));

  // Runner column definitions:
  // Runner 1: [fn: 4, age: 5, gender: 6, shirt: 7]
  // Runner 2: [fn: 8, age: 9, gender: 10, shirt: 11]
  // Runner 3: [fn: 12, age: 13, grade: 14, teacher: 15, shirt: 16]
  // Runner 4: [fn: 17, age: 18, grade: 19, teacher: 20, shirt: 21]
  // Runner 5: [fn: 22, age: 23, grade: 24, teacher: 25, shirt: 26]
  // Runner 6: [fn: 27, age: 28, grade: 29, teacher: 30, shirt: 31]
  const runnerSlots = [
    { runnerNum: 1, fnCol: 4, shirtCol: 7, ageCol: 5, genderCol: 6, gradeCol: -1, teacherCol: -1 },
    { runnerNum: 2, fnCol: 8, shirtCol: 11, ageCol: 9, genderCol: 10, gradeCol: -1, teacherCol: -1 },
    { runnerNum: 3, fnCol: 12, shirtCol: 16, ageCol: 13, genderCol: -1, gradeCol: 14, teacherCol: 15 },
    { runnerNum: 4, fnCol: 17, shirtCol: 21, ageCol: 18, genderCol: -1, gradeCol: 19, teacherCol: 20 },
    { runnerNum: 5, fnCol: 22, shirtCol: 26, ageCol: 23, genderCol: -1, gradeCol: 24, teacherCol: 25 },
    { runnerNum: 6, fnCol: 27, shirtCol: 31, ageCol: 28, genderCol: -1, gradeCol: 29, teacherCol: 30 },
  ];

  // Also dynamically verify with header text if possible
  runnerSlots.forEach(slot => {
    const fnIdx = header.findIndex(h => new RegExp(`runner\\s*${slot.runnerNum}\\s*first`, 'i').test(h));
    if (fnIdx >= 0) slot.fnCol = fnIdx;
  });

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || row.every(cell => !cell.trim())) continue;

    const familyLastName = normalizeName(familyLastCol >= 0 ? row[familyLastCol] : '');
    const email = (emailCol >= 0 ? row[emailCol] : '').trim();
    const phone = (phoneCol >= 0 ? row[phoneCol] : '').trim();
    const rawWaiver = (waiverCol >= 0 ? row[waiverCol] : '').trim();
    const submissionDate = (dateCol >= 0 ? row[dateCol] : '').trim();
    const registrationFee = (feeCol >= 0 ? row[feeCol] : '').trim();
    const rawOrderId = orderIdCol >= 0 && orderIdCol < row.length ? row[orderIdCol].trim() : '';

    let populatedCount = 0;

    for (const slot of runnerSlots) {
      if (slot.fnCol >= row.length) continue;
      const rawRunnerName = row[slot.fnCol]?.trim();
      if (!rawRunnerName) continue;

      populatedCount++;

      // Some family runners include both first and last name in the first name box (e.g. "Emmanuel DeJesus", "Rosangela Disla")
      // If the runner entered two words, let us handle it thoughtfully
      let runnerFirst = rawRunnerName;
      let runnerLast = familyLastName;

      const parts = rawRunnerName.split(/\s+/);
      if (parts.length > 1) {
        // e.g. "Emmanuel DeJesus"
        runnerFirst = parts[0];
        runnerLast = parts.slice(1).join(' ');
      }

      const rawShirt = (slot.shirtCol < row.length ? row[slot.shirtCol] : '').trim();
      const age = slot.ageCol >= 0 && slot.ageCol < row.length ? row[slot.ageCol].trim() : '';
      const gender = slot.genderCol >= 0 && slot.genderCol < row.length ? row[slot.genderCol].trim() : '';
      const grade = slot.gradeCol >= 0 && slot.gradeCol < row.length ? row[slot.gradeCol].trim() : '';
      const teacher = slot.teacherCol >= 0 && slot.teacherCol < row.length ? row[slot.teacherCol].trim() : '';

      const participant: Participant = {
        id: `family-${i}-runner-${slot.runnerNum}`,
        source: 'Family',
        sourceRowIndex: i + 1,
        submissionDate,
        firstName: runnerFirst,
        lastName: runnerLast,
        fullName: `${runnerFirst} ${runnerLast}`.trim(),
        email,
        normalizedEmail: normalizeEmail(email),
        phone,
        normalizedPhone: normalizePhone(phone),
        orderId: rawOrderId,
        hasOrderId: orderIdCol >= 0 ? Boolean(rawOrderId) : true,
        rawShirtSize: rawShirt,
        shirtSize: normalizeShirtSize(rawShirt, 'Family'),
        waiverSigned: isWaiverSigned(rawWaiver),
        rawWaiver,
        age,
        gender,
        grade,
        teacher,
        registrationFee: populatedCount === 1 ? registrationFee : '', // assign fee to primary
        notes: `Family Registration #${i} (${familyLastName}), Runner #${slot.runnerNum}`,
        assignedBagId: '',
      };

      participants.push(participant);
    }

    if (populatedCount === 0) {
      warnings.push(`Family row ${i + 1} (${familyLastName}) had no populated runners.`);
    }
  }

  return { participants, errors, warnings };
}
