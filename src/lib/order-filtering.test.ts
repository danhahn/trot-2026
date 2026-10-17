import { describe, it, expect } from 'vitest';
import { parseDashCSV } from './parsers.js';
import { groupParticipantsIntoBags } from './grouping.js';
import { calculateShirtInventory } from './inventory.js';
import type { Participant } from './types.js';

describe('Order ID Filtering and Verification Requirements', () => {
  it('filters out rows with empty or missing Order ID from active bags and flags them', () => {
    // Simulated CSV where an Order ID column exists and one participant has no order id
    const csvWithOrderId = `Submission date,First name,Last name,Email,Phone,Grade,Youth Shirt Size,Teacher,I have signed the waiver,Dash only,Order ID
2026-10-11T20:45:18.607Z,Alice,Walker,alice@test.com,555-0101,2nd Grade,M,Smith,Checked,25 USD,ORD-1001
2026-10-11T20:45:18.607Z,Bob,Walker,bob@test.com,555-0102,3rd Grade,L,Jones,Checked,25 USD,
2026-10-11T20:45:18.607Z,Charlie,Brown,charlie@test.com,555-0103,1st Grade,S,Brown,Checked,25 USD,ORD-1003`;

    const parsed = parseDashCSV(csvWithOrderId);
    expect(parsed.participants).toHaveLength(3);

    const bob = parsed.participants.find(p => p.firstName === 'Bob')!;
    expect(bob.hasOrderId).toBe(false);
    expect(bob.orderId).toBe('');

    const alice = parsed.participants.find(p => p.firstName === 'Alice')!;
    expect(alice.hasOrderId).toBe(true);
    expect(alice.orderId).toBe('ORD-1001');

    // Grouping
    const { bags, participants, issues } = groupParticipantsIntoBags(parsed.participants);

    // Bob must NOT be assigned to any bag
    expect(participants[bob.id].assignedBagId).toBe('');

    // Alice and Charlie must have bag assignments
    expect(participants[alice.id].assignedBagId).not.toBe('');
    expect(participants['dash-3'].assignedBagId).not.toBe('');

    // Bob must be flagged with missing_order_id
    const missingOrderIssues = Object.values(issues).filter(i => i.type === 'missing_order_id');
    expect(missingOrderIssues).toHaveLength(1);
    expect(missingOrderIssues[0].participantIds).toContain(bob.id);

    // Inventory must separate active from pending
    const inv = calculateShirtInventory(participants, bags);
    expect(inv.totalParticipants).toBe(3);
    expect(inv.activeParticipants).toBe(2);
    expect(inv.pendingOrderIdCount).toBe(1);
  });
});
