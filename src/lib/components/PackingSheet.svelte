<script lang="ts">
  import type { Bag, Participant } from '$lib/types.js';
  import { formatSignupDate, getBagSignupTimestamp, getBagShirtPriority, getParticipantShirtPriority } from '$lib/signup-priority.js';

  interface Props {
    bag: Bag;
    participants: Record<string, Participant>;
    printDate?: string;
  }

  let { bag, participants, printDate = new Date().toLocaleDateString() }: Props = $props();

  let bagParticipants: Participant[] = $derived(
    bag.participantIds.map(id => participants[id]).filter(Boolean)
  );

  let shirtSizeSummary: () => Record<string, number> = $derived(() => {
    const counts: Record<string, number> = {};
    for (const p of bagParticipants) {
      counts[p.shirtSize] = (counts[p.shirtSize] || 0) + 1;
    }
    return counts;
  });

  let anyUnsignedWaiver: boolean = $derived(
    bagParticipants.some(p => !p.waiverSigned)
  );
  let earliestSignupDate = $derived.by(() => {
    const timestamp = getBagSignupTimestamp(bag, participants);
    return timestamp === null ? 'Unknown' : formatSignupDate(new Date(timestamp).toISOString());
  });
  let bagPriority = $derived(getBagShirtPriority(bag, participants));
  let priorityLabel = $derived(bagPriority === 'guaranteed' ? 'GUARANTEED SHIRTS' : bagPriority === 'extra' ? 'EXTRA SHIRTS ONLY' : bagPriority === 'mixed' ? 'MIXED SIGNUP DATES — REVIEW' : 'SIGNUP DATE UNKNOWN — REVIEW');
</script>

<div class="packing-sheet">
  <div class="sheet-header">
    <div class="header-left">
      <div class="event-title">MTPEF Turkey Trot 2026</div>
      <div class="sheet-subtitle">T-Shirt & Bib Packing Slip</div>
    </div>
    <div class="bag-badge">
      <div class="badge-label">FAMILY BAG #</div>
      <div class="badge-number">{bag.bagNumber}</div>
    </div>
  </div>

  <div class="meta-section">
    <div class="meta-row">
      <div class="meta-item">
        <span class="label">Family / Registrant:</span>
        <span class="val strong">{bag.familyName}</span>
      </div>
      <div class="meta-item">
        <span class="label">Primary Contact:</span>
        <span class="val">{bag.primaryContactName || 'N/A'}</span>
      </div>
    </div>
    <div class="meta-row">
      <div class="meta-item">
        <span class="label">Email:</span>
        <span class="val">{bag.primaryEmail || 'N/A'}</span>
      </div>
      <div class="meta-item">
        <span class="label">Phone:</span>
        <span class="val">{bag.primaryPhone || 'N/A'}</span>
      </div>
      <div class="meta-item">
        <span class="label">Earliest Signup:</span>
        <span class="val">{earliestSignupDate}</span>
      </div>
      <div class="meta-item">
        <span class="label">Total Shirts:</span>
        <span class="val badge-count">{bagParticipants.length}</span>
      </div>
    </div>
  </div>

  <div class="signup-priority {bagPriority}">{priorityLabel} <span>Guaranteed through Oct 6, 2026</span></div>

  {#if anyUnsignedWaiver}
    <div class="waiver-alert">
      ⚠️ <strong>ATTENTION:</strong> At least one participant in this bag has not signed an online waiver. Verify paper waiver before hand-off.
    </div>
  {/if}

  <div class="table-container">
    <table class="participants-table">
      <thead>
        <tr>
          <th style="width: 45px;">Packed</th>
          <th>Participant Name</th>
          <th>Event</th>
          <th>Details / Signup Priority</th>
          <th style="width: 110px;">Shirt Size</th>
          <th style="width: 70px;">Waiver</th>
        </tr>
      </thead>
      <tbody>
        {#each bagParticipants as p}
          <tr>
            <td class="checkbox-col">
              <div class="square-box"></div>
            </td>
            <td class="name-col">
              <strong>{p.fullName}</strong>
            </td>
            <td>
              <span class="event-tag {p.source.toLowerCase()}">{p.source}</span>
            </td>
            <td class="details-col">
              <span class="signup-date">Signed up: {formatSignupDate(p.submissionDate)}</span>
              <span class="participant-priority {getParticipantShirtPriority(p)}">{getParticipantShirtPriority(p) === 'guaranteed' ? 'Guaranteed' : getParticipantShirtPriority(p) === 'extra' ? 'Extra shirts, if available' : 'Date needs review'}</span>
              {#if p.grade || p.teacher}
                <span class="school-info">Grade: {p.grade || '-'} | Teacher: {p.teacher || '-'}</span>
              {:else if p.age}
                <span class="school-info">Age: {p.age}</span>
              {:else}
                <span class="school-info">-</span>
              {/if}
            </td>
            <td class="size-col">
              <span class="size-pill">{p.shirtSize}</span>
            </td>
            <td class="waiver-col">
              {#if p.waiverSigned}
                <span class="waiver-yes">✓ Signed</span>
              {:else}
                <span class="waiver-no">⚠️ MISSING</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="sheet-summary">
    <div class="summary-box">
      <div class="summary-title">Bag Shirt Manifest</div>
      <div class="summary-chips">
        {#each Object.entries(shirtSizeSummary()) as [size, count]}
          <span class="chip"><strong>{count}x</strong> {size}</span>
        {/each}
      </div>
    </div>
    <div class="signoff-box">
      <div class="signoff-line">
        <span class="sig-label">Packed By: __________________</span>
        <span class="sig-label">Date: ________</span>
      </div>
      <div class="signoff-line">
        <span class="sig-label">Picked Up By: __________________</span>
        <span class="sig-label">Date: ________</span>
      </div>
    </div>
  </div>

  <div class="sheet-footer">
    <span>MTPEF Turkey Trot Packing App • Bag ID: {bag.id} • Printed: {printDate}</span>
    <span>Page 1 of 1</span>
  </div>
</div>

<style>
  .packing-sheet {
    box-sizing: border-box;
    width: 8.5in;
    min-height: 5.5in;
    max-height: 11in;
    padding: 0.4in;
    margin: 0 auto;
    background: #ffffff;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    page-break-after: always;
    page-break-inside: avoid;
    break-after: page;
    border: 1px solid #e5e7eb;
  }

  @media screen {
    .packing-sheet {
      margin-bottom: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border-radius: 8px;
    }
  }

  @media print {
    .packing-sheet {
      border: none !important;
      box-shadow: none !important;
      padding: 0.3in !important;
      margin: 0 !important;
      width: 100% !important;
      height: 100% !important;
    }
  }

  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #1e293b;
    padding-bottom: 12px;
  }

  .event-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.02em;
  }

  .sheet-subtitle {
    font-size: 14px;
    color: #64748b;
    font-weight: 500;
  }

  .bag-badge {
    text-align: right;
    background: #0f172a;
    color: #ffffff;
    padding: 6px 14px;
    border-radius: 6px;
    min-width: 140px;
  }

  .badge-label {
    font-size: 10px;
    letter-spacing: 0.1em;
    font-weight: 700;
    color: #94a3b8;
  }

  .badge-number {
    font-size: 26px;
    font-weight: 900;
    line-height: 1.1;
  }

  .meta-section {
    margin-top: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
  }

  .meta-row {
    display: flex;
    gap: 20px;
    margin-bottom: 6px;
  }
  .meta-row:last-child {
    margin-bottom: 0;
  }

  .meta-item {
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .label {
    color: #64748b;
    font-weight: 500;
  }

  .val {
    color: #0f172a;
  }

  .val.strong {
    font-size: 16px;
    font-weight: 700;
  }

  .badge-count {
    background: #e0e7ff;
    color: #3730a3;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .waiver-alert {
    margin-top: 10px;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    color: #92400e;
    padding: 8px 12px;
    font-size: 12px;
    border-radius: 4px;
  }

  .table-container {
    margin-top: 14px;
  }

  .participants-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .participants-table th {
    background: #f1f5f9;
    color: #334155;
    text-align: left;
    padding: 8px 10px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-top: 1px solid #cbd5e1;
    border-bottom: 1px solid #cbd5e1;
  }

  .participants-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: middle;
  }

  .checkbox-col {
    text-align: center;
  }

  .square-box {
    width: 18px;
    height: 18px;
    border: 2px solid #475569;
    border-radius: 3px;
    margin: 0 auto;
    background: #ffffff;
  }

  .name-col {
    font-size: 14px;
  }

  .event-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f1f5f9;
    color: #475569;
  }
  .event-tag.family {
    background: #dbeafe;
    color: #1e40af;
  }
  .event-tag.dash {
    background: #fef3c7;
    color: #92400e;
  }
  .event-tag.individual {
    background: #dcfce7;
    color: #166534;
  }

  .signup-priority { margin: 10px 0; padding: 8px 10px; border: 1px solid #9ca3af; border-radius: 5px; font-weight: 800; font-size: 12px; }
  .signup-priority span { float: right; font-weight: 500; }
  .signup-priority.guaranteed, .participant-priority.guaranteed { color: #166534; }
  .signup-priority.extra, .participant-priority.extra { color: #9a3412; }
  .signup-priority.mixed, .signup-priority.unknown, .participant-priority.unknown { color: #991b1b; }
  .signup-date, .participant-priority { display: block; font-size: 10px; margin-bottom: 2px; }

  .school-info {
    font-size: 12px;
    color: #64748b;
  }

  .size-pill {
    display: inline-block;
    font-weight: 700;
    font-size: 13px;
    background: #0f172a;
    color: #ffffff;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .waiver-yes {
    color: #16a34a;
    font-weight: 600;
    font-size: 12px;
  }
  .waiver-no {
    color: #dc2626;
    font-weight: 700;
    font-size: 11px;
  }

  .sheet-summary {
    display: flex;
    gap: 16px;
    margin-top: 16px;
    border-top: 1px dashed #cbd5e1;
    padding-top: 12px;
  }

  .summary-box {
    flex: 1;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px;
  }

  .summary-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    margin-bottom: 6px;
  }

  .summary-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    background: #e2e8f0;
    color: #1e293b;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .signoff-box {
    flex: 1.2;
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px;
  }

  .signoff-line {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: #475569;
  }

  .sheet-footer {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #94a3b8;
    margin-top: 16px;
    border-top: 1px solid #f1f5f9;
    padding-top: 6px;
  }
</style>
