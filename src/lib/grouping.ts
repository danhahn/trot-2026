import type { Participant, Bag, ReviewIssue } from './types.js';

export interface GroupingResult {
  bags: Record<string, Bag>;
  participants: Record<string, Participant>;
  issues: Record<string, ReviewIssue>;
}

/**
 * Builds family bags and assigns participants.
 *
 * Rules:
 * 1. Family registrations form base bags: all runners in a single Family row stay in one family bag.
 * 2. Individual / Dash registrations:
 *    - If exact reliable contact match (normalized email AND normalized phone, or non-empty exact email where phone is blank/matches)
 *      matches an existing family bag primary contact: auto-merge into that family bag.
 *    - If ONLY email matches, or ONLY phone matches, but last name or other info differs or is ambiguous:
 *      create a bag for them AND create an ambiguous_family_match review issue.
 *    - If multiple participants share contact info but NO Family registration exists:
 *      group them into a shared bag (e.g. siblings in Dash, or Individual + Dash child).
 *    - NEVER merge solely based on last name! If last name matches but contact info differs:
 *      keep separate, and flag as suspected_duplicate or ambiguous if appropriate.
 * 3. Flagging:
 *    - Suspected duplicate registrations: same first name, same last name, same contact or birthdate.
 *    - Missing or unknown shirt sizes.
 *    - Unsigned waivers (e.g. 3 Dash participants who left waiver blank).
 */
export function groupParticipantsIntoBags(
  rawParticipants: Participant[],
  existingBags: Record<string, Bag> = {},
  existingIssues: Record<string, ReviewIssue> = {}
): GroupingResult {
  const participants: Record<string, Participant> = {};
  const bags: Record<string, Bag> = {};
  const issues: Record<string, ReviewIssue> = { ...existingIssues };

  // Make deep copies of incoming participants
  rawParticipants.forEach(p => {
    participants[p.id] = { ...p };
  });

  // Check for participants without Order ID (hasOrderId === false)
  // These rows must NOT be assigned to bags or packed; they should be flagged to check with the person!
  const participantsWithoutOrderId = Object.values(participants).filter(p => p.hasOrderId === false);
  participantsWithoutOrderId.forEach(p => {
    const issueId = `missing-order-${p.id}`;
    if (!issues[issueId]) {
      issues[issueId] = {
        id: issueId,
        type: 'missing_order_id',
        severity: 'error',
        title: `Missing Order ID / Payment: ${p.fullName}`,
        description: `${p.fullName} (${p.source}) has no Order ID or confirmed transaction record. Filtered out of packing bags pending verification.`,
        participantIds: [p.id],
        suggestedAction: 'Contact participant to verify payment / Order ID before packing.',
        resolved: false,
      };
    }
  });

  // Only assign participants with confirmed Order ID to packing bags
  const validParticipants = Object.values(participants).filter(p => p.hasOrderId !== false);

  let nextBagNumber = 1;

  // Step 1: Create Bags for Family registrations
  // Group Family participants by their registration index
  const familyGroups: Record<number, Participant[]> = {};
  validParticipants.forEach(p => {
    if (p.source === 'Family') {
      if (!familyGroups[p.sourceRowIndex]) {
        familyGroups[p.sourceRowIndex] = [];
      }
      familyGroups[p.sourceRowIndex].push(p);
    }
  });

  // Create bag for each Family registration
  for (const [rowIndexStr, familyMembers] of Object.entries(familyGroups)) {
    const rowIndex = Number(rowIndexStr);
    const bagId = `BAG-FAM-${rowIndex}`;
    const primary = familyMembers[0];
    const familyName = primary.lastName || 'Family';

    bags[bagId] = {
      id: bagId,
      bagNumber: nextBagNumber++,
      familyName: `${familyName} Family`,
      primaryContactName: primary.fullName,
      primaryEmail: primary.email,
      primaryPhone: primary.phone,
      participantIds: familyMembers.map(m => m.id),
      packed: false,
      pickedUp: false,
    };

    familyMembers.forEach(m => {
      participants[m.id].assignedBagId = bagId;
    });
  }

  // Step 2: Process non-family participants (Dash & Individual)
  const nonFamilyParticipants = validParticipants.filter(p => p.source !== 'Family');

  // We group non-family participants by reliable contact info:
  // Key = normalizedEmail if present, or normalizedPhone if present, or individual ID if neither
  // But watch out: what if someone matches an existing family bag?
  const familyBags = Object.values(bags);

  for (const p of nonFamilyParticipants) {
    if (p.assignedBagId) continue;

    // Check against existing Family bags
    let exactFamilyBagMatch: Bag | null = null;
    let ambiguousFamilyBagMatch: Bag | null = null;

    for (const fb of familyBags) {
      const fbEmailNorm = (fb.primaryEmail || '').trim().toLowerCase();
      const fbPhoneNorm = (fb.primaryPhone || '').replace(/\D/g, '').replace(/^1/, '');
      const emailMatch = p.normalizedEmail && p.normalizedEmail === fbEmailNorm;
      const phoneMatch = p.normalizedPhone && p.normalizedPhone === fbPhoneNorm;
      const lastNameMatch = p.lastName.toLowerCase() === fb.familyName.replace(/ family$/i, '').trim().toLowerCase();

      if (emailMatch && phoneMatch) {
        exactFamilyBagMatch = fb;
        break;
      } else if (emailMatch && !fbPhoneNorm && !p.normalizedPhone) {
        exactFamilyBagMatch = fb;
        break;
      } else if (emailMatch || phoneMatch) {
        // One matches but not both or names differ
        ambiguousFamilyBagMatch = fb;
      } else if (lastNameMatch) {
        // Last name matches but contact info differs! NEVER merge automatically.
        // We will create an ambiguous/review flag for this.
        const issueId = `ambiguous-name-${p.id}-${fb.id}`;
        if (!issues[issueId]) {
          issues[issueId] = {
            id: issueId,
            type: 'ambiguous_family_match',
            severity: 'info',
            title: `Shared Last Name: ${p.fullName} vs ${fb.familyName}`,
            description: `${p.fullName} (${p.source}) shares last name with ${fb.familyName} but contact details differ (Email: "${p.email}" vs "${fb.primaryEmail}", Phone: "${p.phone}" vs "${fb.primaryPhone}"). Not merged automatically.`,
            participantIds: [p.id, ...fb.participantIds],
            suggestedAction: 'Review whether to combine this bag into the family bag.',
            resolved: false,
          };
        }
      }
    }

    if (exactFamilyBagMatch) {
      // Reliable contact match: merge into family bag!
      exactFamilyBagMatch.participantIds.push(p.id);
      p.assignedBagId = exactFamilyBagMatch.id;
    } else if (ambiguousFamilyBagMatch) {
      // Ambiguous contact match: create its own bag and flag for review!
      const bagId = `BAG-${nextBagNumber}`;
      bags[bagId] = {
        id: bagId,
        bagNumber: nextBagNumber++,
        familyName: `${p.lastName} (${p.source})`,
        primaryContactName: p.fullName,
        primaryEmail: p.email,
        primaryPhone: p.phone,
        participantIds: [p.id],
        packed: false,
        pickedUp: false,
      };
      p.assignedBagId = bagId;

      const issueId = `ambiguous-contact-${p.id}-${ambiguousFamilyBagMatch.id}`;
      issues[issueId] = {
        id: issueId,
        type: 'ambiguous_family_match',
        severity: 'warning',
        title: `Ambiguous Contact Match: ${p.fullName}`,
        description: `${p.fullName} has partially matching contact info with ${ambiguousFamilyBagMatch.familyName}. They have been kept in separate bags pending manual review.`,
        participantIds: [p.id, ...ambiguousFamilyBagMatch.participantIds],
        suggestedAction: 'Verify if they belong in the same bag and use "Combine Bags" if confirmed.',
        resolved: false,
      };
    }
  }

  // Step 3: Group remaining non-family participants who share exact contact info with each other
  const unassignedNonFamily = nonFamilyParticipants.filter(p => !p.assignedBagId);

  // Cluster by contact key (email if available, else phone)
  const contactClusters: Record<string, Participant[]> = {};
  for (const p of unassignedNonFamily) {
    let key = '';
    if (p.normalizedEmail && p.normalizedPhone) {
      key = `em_ph:${p.normalizedEmail}|${p.normalizedPhone}`;
    } else if (p.normalizedEmail) {
      key = `em:${p.normalizedEmail}`;
    } else if (p.normalizedPhone) {
      key = `ph:${p.normalizedPhone}`;
    } else {
      key = `single:${p.id}`;
    }

    if (!contactClusters[key]) {
      contactClusters[key] = [];
    }
    contactClusters[key].push(p);
  }

  for (const cluster of Object.values(contactClusters)) {
    const primary = cluster[0];
    const bagId = `BAG-${nextBagNumber}`;
    const familyName = cluster.length > 1 ? `${primary.lastName} Family` : primary.lastName;

    bags[bagId] = {
      id: bagId,
      bagNumber: nextBagNumber++,
      familyName,
      primaryContactName: primary.fullName,
      primaryEmail: primary.email,
      primaryPhone: primary.phone,
      participantIds: cluster.map(c => c.id),
      packed: false,
      pickedUp: false,
    };

    cluster.forEach(c => {
      participants[c.id].assignedBagId = bagId;
    });
  }

  // Step 4: Detect suspected duplicate registrations
  // E.g. same full name in Dash multiple times
  const allList = Object.values(participants);
  for (let i = 0; i < allList.length; i++) {
    for (let j = i + 1; j < allList.length; j++) {
      const p1 = allList[i];
      const p2 = allList[j];

      const sameName = p1.fullName.toLowerCase() === p2.fullName.toLowerCase();
      const sameContact = (p1.normalizedEmail && p1.normalizedEmail === p2.normalizedEmail) ||
                          (p1.normalizedPhone && p1.normalizedPhone === p2.normalizedPhone);

      if (sameName && sameContact) {
        const issueId = `dup-${p1.id}-${p2.id}`;
        if (!issues[issueId]) {
          issues[issueId] = {
            id: issueId,
            type: 'suspected_duplicate',
            severity: 'warning',
            title: `Suspected Duplicate: ${p1.fullName}`,
            description: `${p1.fullName} appears multiple times (${p1.id} [${p1.shirtSize}] and ${p2.id} [${p2.shirtSize}]). Both participants and shirts are preserved; please review to see if a second shirt was intentionally ordered or if registration was submitted twice.`,
            participantIds: [p1.id, p2.id],
            suggestedAction: 'Check with registrant or mark resolved if both shirts are needed.',
            resolved: false,
          };
        }
      }
    }
  }

  // Step 5: Detect missing shirt sizes & unsigned waivers
  for (const p of allList) {
    if (p.shirtSize === 'Unknown' || !p.rawShirtSize) {
      const issueId = `shirt-missing-${p.id}`;
      if (!issues[issueId]) {
        issues[issueId] = {
          id: issueId,
          type: 'missing_or_unknown_shirt',
          severity: 'error',
          title: `Missing Shirt Size: ${p.fullName}`,
          description: `${p.fullName} (${p.source}) has an unknown or missing shirt size ("${p.rawShirtSize}").`,
          participantIds: [p.id],
          suggestedAction: 'Contact runner to confirm shirt size and update manually.',
          resolved: false,
        };
      }
    }

    if (!p.waiverSigned) {
      const issueId = `waiver-missing-${p.id}`;
      if (!issues[issueId]) {
        issues[issueId] = {
          id: issueId,
          type: 'unsigned_waiver',
          severity: 'warning',
          title: `Unsigned Waiver: ${p.fullName}`,
          description: `${p.fullName} (${p.source}) did not have a checked waiver in the CSV import.`,
          participantIds: [p.id],
          suggestedAction: 'Collect paper or electronic waiver at bib/shirt pickup.',
          resolved: false,
        };
      }
    }
  }

  return { bags, participants, issues };
}
