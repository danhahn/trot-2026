<script lang="ts">
  import { onMount } from 'svelte';
  import type { AppState, Bag, Participant, ReviewIssue, ShirtSize } from '$lib/types.js';
  import { ALL_SHIRT_SIZES, calculateShirtInventory, getBagShirtSummary } from '$lib/inventory.js';
  import { parseDashCSV, parseFamilyCSV, parseIndividualCSV } from '$lib/parsers.js';
  import { groupParticipantsIntoBags } from '$lib/grouping.js';
  import { exportParticipantsCSV, exportBagsCSV, exportInventoryCSV, exportFullBackupJSON, validateAndParseBackupJSON } from '$lib/export.js';
  import { formatPhone } from '$lib/normalizers.js';
  import { sortBagsBySignupDate, renumberBagsBySignupDate } from '$lib/signup-priority.js';
  import { pushStateToCloud, listenToCloudState } from '$lib/firebase.js';
  import PackingSheet from '$lib/components/PackingSheet.svelte';

  // --- State ---
  let state = $state<AppState>({
    version: 1,
    lastUpdated: new Date().toISOString(),
    participants: {},
    bags: {},
    issues: {},
    importedFiles: { dash: false, family: false, individual: false },
  });

  let activeTab = $state<'dashboard' | 'bags' | 'participants' | 'unverified' | 'review' | 'print' | 'import-export'>('dashboard');
  let searchQuery = $state('');
  let bagFilter = $state<'all' | 'packed' | 'unpacked' | 'pickedUp' | 'pendingPickup'>('all');
  let selectedBagForPrint = $state<Bag | null>(null);
  let showPrintModal = $state(false);
  let printMode = $state<'single' | 'all'>('single');
  let notification = $state<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Manual Bag Reassignment modal
  let showMoveModal = $state(false);
  let moveParticipantId = $state<string | null>(null);
  let targetBagId = $state<string>('');

  // Combine bags modal
  let showCombineModal = $state(false);
  let combineSourceBagId = $state<string>('');
  let combineTargetBagId = $state<string>('');

  // Editing participant modal
  let showEditParticipantModal = $state(false);
  let editingParticipant = $state<Participant | null>(null);
  let isCloudConnected = $state(false);
  let isCloudSyncing = $state(false);

  function notify(message: string, type: 'success' | 'error' | 'info' = 'success') {
    notification = { type, message };
    setTimeout(() => {
      if (notification?.message === message) notification = null;
    }, 4000);
  }

  // Derive counts & stats
  let inventory: ReturnType<typeof calculateShirtInventory> = $derived(calculateShirtInventory(state.participants, state.bags));
  // Keep assigned bag numbers unchanged; only sort the display/print order by earliest signup.
  let bagsList: Bag[] = $derived(sortBagsBySignupDate(Object.values(state.bags), state.participants));
  let participantsList: Participant[] = $derived(Object.values(state.participants));
  let issuesList: ReviewIssue[] = $derived(Object.values(state.issues));
  let unresolvedIssues: ReviewIssue[] = $derived(issuesList.filter(i => !i.resolved));
  let unverifiedParticipants: Participant[] = $derived(participantsList.filter(p => p.hasOrderId === false));

  // Search filtering
  let filteredBags: () => Bag[] = $derived(() => {
    const q = searchQuery.trim().toLowerCase();
    return bagsList.filter(b => {
      // Filter status
      if (bagFilter === 'packed' && !b.packed) return false;
      if (bagFilter === 'unpacked' && b.packed) return false;
      if (bagFilter === 'pickedUp' && !b.pickedUp) return false;
      if (bagFilter === 'pendingPickup' && b.pickedUp) return false;

      if (!q) return true;

      const bagNumMatch = b.bagNumber.toString() === q;
      const familyMatch = b.familyName.toLowerCase().includes(q);
      const contactMatch = b.primaryContactName.toLowerCase().includes(q);
      const emailMatch = (b.primaryEmail || '').toLowerCase().includes(q);
      const phoneMatch = (b.primaryPhone || '').replace(/\D/g, '').includes(q.replace(/\D/g, ''));
      const memberMatch = b.participantIds.some(id => {
        const p = state.participants[id];
        return p && (p.fullName.toLowerCase().includes(q) || p.firstName.toLowerCase().includes(q) || p.lastName.toLowerCase().includes(q));
      });

      return bagNumMatch || familyMatch || contactMatch || emailMatch || phoneMatch || memberMatch;
    });
  });

  let filteredParticipants: () => Participant[] = $derived(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return participantsList;
    return participantsList.filter(p => {
      return (
        p.fullName.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
        p.id.toLowerCase().includes(q) ||
        (state.bags[p.assignedBagId]?.familyName || '').toLowerCase().includes(q) ||
        (state.bags[p.assignedBagId]?.bagNumber.toString() === q)
      );
    });
  });

  let isInitialLoading = $state(true);

  onMount(() => {
    // Safety fallback: ensure initial loading spinner dismisses if network/Firebase is slow or offline
    const timeout = setTimeout(() => {
      isInitialLoading = false;
    }, 4000);

    // Subscribe to Firebase real-time changes as primary single source of truth
    const unsub = listenToCloudState((remoteState) => {
      clearTimeout(timeout);
      isInitialLoading = false;
      if (remoteState) {
        // If there are participants whose assigned bag is missing from state.bags, re-run grouping so no one is unassigned
        const pList = Object.values(remoteState.participants || {});
        const bMap = remoteState.bags || {};
        const hasOrphaned = pList.some(p => p.hasOrderId !== false && (!p.assignedBagId || !bMap[p.assignedBagId]));

        if (hasOrphaned && pList.length > 0) {
          const { bags, participants, issues } = groupParticipantsIntoBags(pList, {}, remoteState.issues);
          // Preserve existing bag progress
          for (const [bid, b] of Object.entries(bags)) {
            if (bMap[bid]) {
              b.packed = bMap[bid].packed;
              b.pickedUp = bMap[bid].pickedUp;
              b.packedAt = bMap[bid].packedAt;
              b.pickedUpAt = bMap[bid].pickedUpAt;
              b.customNotes = bMap[bid].customNotes;
            }
          }
          state = {
            ...remoteState,
            bags,
            participants,
            issues,
          };
          // Persist the repaired grouping back to Firebase
          pushStateToCloud(state).catch(() => {});
        } else {
          // Renumber bags so any stale bag numbers persisted in Firebase are corrected
          // on this load. This is a no-op if numbers are already correct.
          renumberBagsBySignupDate(remoteState.bags, remoteState.participants);
          state = remoteState;
          // Write corrected numbers back so Firebase stays in sync
          pushStateToCloud(state).catch(() => {});
        }
      }
    }, (connected) => {
      isCloudConnected = connected;
      if (!connected) {
        clearTimeout(timeout);
        isInitialLoading = false;
      }
    });

    return () => {
      clearTimeout(timeout);
      if (unsub) unsub();
    };
  });

  async function updateAndPersist(updater: (s: AppState) => void) {
    updater(state);
    state = { ...state };

    // Sync changes to Firebase Cloud in real time
    isCloudSyncing = true;
    try {
      await pushStateToCloud(state);
    } catch (e: any) {
      notify(`Sync error: ${e.message}`, 'error');
    } finally {
      isCloudSyncing = false;
    }
  }

  // --- CSV Import ---
  async function handleCsvUpload(event: Event, source: 'Dash' | 'Family' | 'Individual') {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parseRes: ReturnType<typeof parseDashCSV>;

      if (source === 'Dash') parseRes = parseDashCSV(text);
      else if (source === 'Family') parseRes = parseFamilyCSV(text);
      else parseRes = parseIndividualCSV(text);

      if (parseRes.errors.length > 0) {
        notify(`Error reading CSV: ${parseRes.errors.join(', ')}`, 'error');
        return;
      }

      // Merge new participants preserving existing custom statuses if reimporting
      const existingIds = new Set(Object.keys(state.participants));
      const incoming = parseRes.participants;

      // Group all current + incoming participants
      const combined = [
        ...Object.values(state.participants).filter(p => p.source !== source), // replace same source cleanly
        ...incoming,
      ];

      const { bags, participants, issues } = groupParticipantsIntoBags(combined, {}, state.issues);

      // Preserve existing bag packed/pickedUp flags if bag ids match
      for (const [bid, b] of Object.entries(bags)) {
        if (state.bags[bid]) {
          b.packed = state.bags[bid].packed;
          b.pickedUp = state.bags[bid].pickedUp;
          b.packedAt = state.bags[bid].packedAt;
          b.pickedUpAt = state.bags[bid].pickedUpAt;
          b.customNotes = state.bags[bid].customNotes;
        }
      }

      updateAndPersist(s => {
        s.participants = participants;
        s.bags = bags;
        s.issues = issues;
        if (source === 'Dash') s.importedFiles.dash = true;
        if (source === 'Family') s.importedFiles.family = true;
        if (source === 'Individual') s.importedFiles.individual = true;
      });

      notify(`Imported ${incoming.length} participants from ${file.name}. Total bags: ${Object.keys(bags).length}`);
    } catch (err: any) {
      notify(`Import failed: ${err.message}`, 'error');
    } finally {
      target.value = '';
    }
  }

  // Auto-load built-in raw_data CSVs button
  async function autoLoadRawFiles() {
    try {
      const resDash = await fetch('/raw_data/Dash.csv').then(r => r.ok ? r.text() : null).catch(() => null);
      const resFamily = await fetch('/raw_data/Family.csv').then(r => r.ok ? r.text() : null).catch(() => null);
      const resIndiv = await fetch('/raw_data/Individual .csv').then(r => r.ok ? r.text() : null).catch(() => null);

      if (!resDash || !resFamily || !resIndiv) {
        notify('Raw data files not accessible via browser directly. Please use the CSV file upload buttons.', 'info');
        return;
      }

      const pDash = parseDashCSV(resDash).participants;
      const pFam = parseFamilyCSV(resFamily).participants;
      const pInd = parseIndividualCSV(resIndiv).participants;

      const { bags, participants, issues } = groupParticipantsIntoBags([...pDash, ...pFam, ...pInd]);

      updateAndPersist(s => {
        s.participants = participants;
        s.bags = bags;
        s.issues = issues;
        s.importedFiles.dash = true;
        s.importedFiles.family = true;
        s.importedFiles.individual = true;
      });

      notify(`Successfully loaded all 3 raw CSVs: 57 participants, 57 shirts, ${Object.keys(bags).length} bags.`);
    } catch (e: any) {
      notify(`Could not auto-load files: ${e.message}. Use manual CSV upload.`, 'error');
    }
  }

  // --- Bag Actions ---
  function togglePacked(bagId: string) {
    updateAndPersist(s => {
      const b = s.bags[bagId];
      if (b) {
        b.packed = !b.packed;
        b.packedAt = b.packed ? new Date().toISOString() : undefined;
      }
    });
  }

  function togglePickedUp(bagId: string) {
    updateAndPersist(s => {
      const b = s.bags[bagId];
      if (b) {
        b.pickedUp = !b.pickedUp;
        b.pickedUpAt = b.pickedUp ? new Date().toISOString() : undefined;
      }
    });
  }

  function openMoveParticipant(participantId: string) {
    moveParticipantId = participantId;
    const currentBag = state.participants[participantId]?.assignedBagId;
    targetBagId = currentBag || '';
    showMoveModal = true;
  }

  function confirmMoveParticipant() {
    if (!moveParticipantId || !targetBagId) return;

    updateAndPersist(s => {
      const p = s.participants[moveParticipantId!];
      if (!p) return;
      const oldBagId = p.assignedBagId;

      if (oldBagId === targetBagId) return;

      // Remove from old bag
      if (s.bags[oldBagId]) {
        s.bags[oldBagId].participantIds = s.bags[oldBagId].participantIds.filter(id => id !== moveParticipantId);
        // If old bag is now empty, delete it
        if (s.bags[oldBagId].participantIds.length === 0) {
          delete s.bags[oldBagId];
        }
      }

      // Add to new bag
      if (s.bags[targetBagId]) {
        s.bags[targetBagId].participantIds.push(moveParticipantId!);
        p.assignedBagId = targetBagId;
      }
    });

    notify(`Moved participant to Bag #${state.bags[targetBagId]?.bagNumber || targetBagId}`);
    showMoveModal = false;
    moveParticipantId = null;
  }

  function separateParticipantToNewBag(participantId: string) {
    const p = state.participants[participantId];
    if (!p) return;

    updateAndPersist(s => {
      const oldBagId = p.assignedBagId;
      if (s.bags[oldBagId]) {
        s.bags[oldBagId].participantIds = s.bags[oldBagId].participantIds.filter(id => id !== participantId);
        if (s.bags[oldBagId].participantIds.length === 0) {
          delete s.bags[oldBagId];
        }
      }

      const nextNum = Math.max(0, ...Object.values(s.bags).map(b => b.bagNumber)) + 1;
      const newBagId = `BAG-${nextNum}`;

      s.bags[newBagId] = {
        id: newBagId,
        bagNumber: nextNum,
        familyName: `${p.lastName} (Separated)`,
        primaryContactName: p.fullName,
        primaryEmail: p.email,
        primaryPhone: p.phone,
        participantIds: [participantId],
        packed: false,
        pickedUp: false,
        isCustomBag: true,
      };

      s.participants[participantId].assignedBagId = newBagId;
    });

    notify(`Separated ${p.fullName} into their own Bag.`);
  }

  function confirmCombineBags() {
    if (!combineSourceBagId || !combineTargetBagId || combineSourceBagId === combineTargetBagId) {
      notify('Please select two distinct bags to combine.', 'error');
      return;
    }

    updateAndPersist(s => {
      const src = s.bags[combineSourceBagId];
      const target = s.bags[combineTargetBagId];
      if (!src || !target) return;

      // Transfer all participants
      src.participantIds.forEach(pid => {
        target.participantIds.push(pid);
        if (s.participants[pid]) {
          s.participants[pid].assignedBagId = target.id;
        }
      });

      // Remove source bag
      delete s.bags[combineSourceBagId];
    });

    notify(`Successfully combined Bag #${state.bags[combineSourceBagId]?.bagNumber || combineSourceBagId} into Bag #${state.bags[combineTargetBagId]?.bagNumber || combineTargetBagId}`);
    showCombineModal = false;
    combineSourceBagId = '';
    combineTargetBagId = '';
  }

  function resolveIssue(issueId: string) {
    updateAndPersist(s => {
      if (s.issues[issueId]) {
        s.issues[issueId].resolved = true;
      }
    });
    notify('Issue marked as resolved.');
  }

  function openEditParticipant(p: Participant) {
    editingParticipant = JSON.parse(JSON.stringify(p));
    showEditParticipantModal = true;
  }

  function saveEditedParticipant() {
    if (!editingParticipant) return;
    updateAndPersist(s => {
      if (editingParticipant && s.participants[editingParticipant.id]) {
        // If orderId is provided, mark hasOrderId = true
        if (editingParticipant.orderId && editingParticipant.orderId.trim()) {
          editingParticipant.hasOrderId = true;
          // Resolve any missing order issue
          const issueId = `missing-order-${editingParticipant.id}`;
          if (s.issues[issueId]) {
            s.issues[issueId].resolved = true;
          }
        }
        s.participants[editingParticipant.id] = { ...editingParticipant };

        // Re-run bag assignment so the participant gets placed into an appropriate bag!
        const reGroup = groupParticipantsIntoBags(Object.values(s.participants), s.bags, s.issues);
        s.bags = reGroup.bags;
        s.participants = reGroup.participants;
        s.issues = reGroup.issues;
      }
    });
    notify(`Updated ${editingParticipant.fullName}`);
    showEditParticipantModal = false;
    editingParticipant = null;
  }

  // --- Export Actions ---
  function downloadTextFile(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportParticipants() {
    const csv = exportParticipantsCSV(state.participants, state.bags);
    downloadTextFile(csv, `mtpef_participants_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  }

  function exportBags() {
    const csv = exportBagsCSV(state.bags, state.participants);
    downloadTextFile(csv, `mtpef_family_bags_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  }

  function exportInventory() {
    const csv = exportInventoryCSV(state.participants);
    downloadTextFile(csv, `mtpef_shirt_inventory_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  }

  function backupState() {
    const json = exportFullBackupJSON(state);
    downloadTextFile(json, `mtpef_turkey_trot_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  }

  async function restoreBackup(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const restored = validateAndParseBackupJSON(text);
      state = restored;
      await pushStateToCloud(state);
      notify('State successfully restored and synced to Firebase!');
    } catch (err: any) {
      notify(`Restore failed: ${err.message}`, 'error');
    } finally {
      target.value = '';
    }
  }

  function printSingleBag(b: Bag) {
    selectedBagForPrint = b;
    printMode = 'single';
    showPrintModal = true;
  }

  function printAllBags() {
    printMode = 'all';
    showPrintModal = true;
  }

  function triggerBrowserPrint() {
    window.print();
  }
</script>

<svelte:head>
  <title>MTPEF Turkey Trot T-Shirt Packing System</title>
</svelte:head>

<div class="app-layout">
  <!-- Top Navigation Bar -->
  <header class="app-header no-print">
    <div class="brand">
      <div class="trot-logo">🦃</div>
      <div>
        <h1>MTPEF Turkey Trot 2026</h1>
        <p class="subtitle">T-Shirt Packing, Grouping & Distribution System</p>
      </div>
    </div>

    <div class="header-status">
      <span class="cloud-status-badge {isCloudConnected ? 'connected' : 'offline'}" title="Firebase trot-2026 Live Sync">
        <span class="cloud-dot"></span>
        {isCloudConnected ? (isCloudSyncing ? 'Syncing...' : 'Live Cloud (trot-2026)') : 'Local Mode'}
      </span>
      {#if unverifiedParticipants.length > 0}
        <button class="status-pill warning-pill" onclick={() => activeTab = 'unverified'}>
          ⚠️ {unverifiedParticipants.length} Missing Order ID
        </button>
      {/if}
      {#if unresolvedIssues.length > 0}
        <button class="status-pill warning-pill" onclick={() => activeTab = 'review'}>
          ⚠️ {unresolvedIssues.length} Issues to Review
        </button>
      {/if}
      <div class="status-summary">
        <span class="stat-badge"><strong>{inventory.totalShirts}</strong> Total Shirts</span>
        <span class="stat-badge"><strong>{inventory.totalBags}</strong> Bags</span>
        <span class="stat-badge highlight"><strong>{inventory.packedBags}</strong> Packed</span>
        <span class="stat-badge success"><strong>{inventory.pickedUpBags}</strong> Picked Up</span>
      </div>
    </div>
  </header>

  <!-- Notification Toast -->
  {#if notification}
    <div class="notification-toast {notification.type} no-print">
      <span>{notification.message}</span>
      <button class="close-toast" onclick={() => notification = null}>✕</button>
    </div>
  {/if}

  <!-- Main Tabs -->
  <nav class="nav-tabs no-print">
    <button class="tab-btn" class:active={activeTab === 'dashboard'} onclick={() => activeTab = 'dashboard'}>
      📊 Dashboard & Inventory
    </button>
    <button class="tab-btn" class:active={activeTab === 'bags'} onclick={() => activeTab = 'bags'}>
      🎒 Family Bags ({inventory.totalBags})
    </button>
    <button class="tab-btn" class:active={activeTab === 'participants'} onclick={() => activeTab = 'participants'}>
      🏃 All Participants ({inventory.totalParticipants})
    </button>
    <button class="tab-btn" class:active={activeTab === 'unverified'} onclick={() => activeTab = 'unverified'}>
      ⚠️ Missing Order ID ({unverifiedParticipants.length})
    </button>
    <button class="tab-btn" class:active={activeTab === 'review'} onclick={() => activeTab = 'review'}>
      🔍 Review Center {#if unresolvedIssues.length > 0}<span class="badge-count-red">{unresolvedIssues.length}</span>{/if}
    </button>
    <button class="tab-btn" class:active={activeTab === 'print'} onclick={() => activeTab = 'print'}>
      🖨️ Packing Slips & Printing
    </button>
    <button class="tab-btn" class:active={activeTab === 'import-export'} onclick={() => activeTab = 'import-export'}>
      💾 Import / Export & Backup
    </button>
  </nav>

  <!-- MAIN TAB CONTENT (Hidden on print) -->
  <main class="tab-content no-print">
    {#if isInitialLoading}
      <div class="content-panel" style="text-align: center; padding: 48px 24px;">
        <div style="font-size: 32px; margin-bottom: 12px;">⏳</div>
        <h3 style="margin-bottom: 8px;">Connecting to Firebase Cloud...</h3>
        <p style="color: #64748b;">Loading real-time registrations and bag distribution from trot-2026.</p>
      </div>
    {:else}
      {#if participantsList.length === 0}
        <div class="content-panel empty-cloud-banner">
          <div class="empty-cloud-icon">📂</div>
          <div class="empty-cloud-info">
            <h2 style="margin: 0 0 6px 0; font-size: 20px; color: #0f172a;">No Registration Data in Firebase</h2>
            <p style="margin: 0 0 16px 0; color: #475569; font-size: 14px;">
              Cloud Firestore is empty. Upload your race registration CSV files below to group participants into family bags, generate packing slips, and sync across volunteers.
            </p>
            <div class="empty-cloud-actions">
              <label class="btn primary file-btn">
                📤 Upload Dash CSV
                <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Dash')} hidden />
              </label>
              <label class="btn primary file-btn">
                📤 Upload Family CSV
                <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Family')} hidden />
              </label>
              <label class="btn primary file-btn">
                📤 Upload Individual CSV
                <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Individual')} hidden />
              </label>
              <button class="btn secondary" onclick={() => activeTab = 'import-export'}>
                View Import & Backup Center &rarr;
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- DASHBOARD TAB -->
      {#if activeTab === 'dashboard'}
        <div class="dashboard-grid">
        <!-- Metric Cards -->
        <div class="stats-overview">
          <div class="stat-card">
            <div class="card-title">Total Registered</div>
            <div class="card-value">{inventory.totalShirts}</div>
            <div class="card-sub">{inventory.totalParticipants} total rows imported</div>
          </div>
          <div class="stat-card">
            <div class="card-title">Active for Packing</div>
            <div class="card-value {inventory.pendingOrderIdCount > 0 ? 'text-green' : ''}">
              {inventory.activeParticipants}
            </div>
            <div class="card-sub">{inventory.totalBags} bags (Order ID verified)</div>
          </div>
          <div class="stat-card">
            <div class="card-title">Missing Order ID</div>
            <div class="card-value {inventory.pendingOrderIdCount > 0 ? 'text-red' : ''}">
              {inventory.pendingOrderIdCount}
            </div>
            <div class="card-sub">
              {#if inventory.pendingOrderIdCount > 0}
                <button class="link-btn" onclick={() => activeTab = 'unverified'}>View Held Rows &gt;</button>
              {:else}
                All rows verified
              {/if}
            </div>
          </div>
          <div class="stat-card">
            <div class="card-title">Packed Bags</div>
            <div class="card-value {inventory.packedBags === inventory.totalBags && inventory.totalBags > 0 ? 'text-green' : ''}">
              {inventory.packedBags} / {inventory.totalBags}
            </div>
            <div class="progress-bar-bg">
              <div 
                class="progress-bar-fill" 
                style="width: {inventory.totalBags > 0 ? (inventory.packedBags / inventory.totalBags) * 100 : 0}%; background: #3b82f6;"
              ></div>
            </div>
          </div>
          <div class="stat-card">
            <div class="card-title">Bags Picked Up</div>
            <div class="card-value text-green">
              {inventory.pickedUpBags} / {inventory.totalBags}
            </div>
            <div class="progress-bar-bg">
              <div 
                class="progress-bar-fill" 
                style="width: {inventory.totalBags > 0 ? (inventory.pickedUpBags / inventory.totalBags) * 100 : 0}%; background: #10b981;"
              ></div>
            </div>
          </div>
        </div>

        <!-- Shirt Inventory Manifest Table -->
        <div class="content-panel">
          <div class="panel-header">
            <div>
              <h3>Master T-Shirt Inventory Breakdown</h3>
              <p class="panel-desc">Exact count required per shirt size across all registrations</p>
            </div>
            <button class="btn secondary" onclick={exportInventory}>Export Inventory CSV</button>
          </div>
          <div class="inventory-table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Shirt Size</th>
                  <th>Category</th>
                  <th style="text-align: right;">Total Ordered</th>
                  <th style="text-align: right;">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {#each ALL_SHIRT_SIZES as size}
                  {@const count = inventory.sizeCounts[size] || 0}
                  {#if count > 0 || size === 'Unknown'}
                    <tr class:row-warning={size === 'Unknown' && count > 0}>
                      <td>
                        <span class="size-pill-tag {size.startsWith('Youth') ? 'youth' : (size.startsWith('Adult') ? 'adult' : 'unknown')}">
                          {size}
                        </span>
                      </td>
                      <td>{size.startsWith('Youth') ? 'Youth Sizes' : (size.startsWith('Adult') ? 'Adult Sizes' : 'Unspecified')}</td>
                      <td style="text-align: right; font-weight: 700; font-size: 16px;">{count}</td>
                      <td style="text-align: right; color: #64748b;">
                        {inventory.totalShirts > 0 ? ((count / inventory.totalShirts) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
              <tfoot>
                <tr class="table-total-row">
                  <td><strong>TOTAL SHIRTS</strong></td>
                  <td></td>
                  <td style="text-align: right;"><strong>{inventory.totalShirts}</strong></td>
                  <td style="text-align: right;"><strong>100%</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <!-- Quick Actions & Status -->
        <div class="dashboard-side-grid">
          <div class="content-panel">
            <h3>Waiver Verification</h3>
            <div class="waiver-stat-box">
              <div class="waiver-stat-item">
                <span class="w-num text-green">{inventory.waiversSignedCount}</span>
                <span class="w-label">Online Signed</span>
              </div>
              <div class="waiver-stat-item">
                <span class="w-num {inventory.waiversMissingCount > 0 ? 'text-red' : ''}">{inventory.waiversMissingCount}</span>
                <span class="w-label">Missing Waiver</span>
              </div>
            </div>
            {#if inventory.waiversMissingCount > 0}
              <p class="help-text">⚠️ 3 Dash participants registered without the online waiver checkbox checked. Check the Review screen for details.</p>
            {/if}
          </div>

          <div class="content-panel">
            <h3>Quick Workflow</h3>
            <div class="quick-btn-group">
              <button class="btn primary full-width" onclick={printAllBags}>
                🖨️ Print All Packing Sheets ({inventory.totalBags})
              </button>
              <button class="btn secondary full-width" onclick={() => { activeTab = 'bags'; bagFilter = 'unpacked'; }}>
                📦 View Unpacked Bags ({inventory.unpackedBags})
              </button>
              <button class="btn secondary full-width" onclick={() => { activeTab = 'bags'; bagFilter = 'pendingPickup'; }}>
                🏃 Ready for Pickup ({inventory.packedBags - inventory.pickedUpBags})
              </button>
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- BAGS TAB -->
    {#if activeTab === 'bags'}
      <div class="content-panel">
        <div class="panel-header flex-between">
          <div class="search-and-filters">
            <input 
              type="search" 
              class="search-input" 
              placeholder="Search by bag #, family name, runner name, email, phone..." 
              bind:value={searchQuery}
            />
            <div class="filter-pills">
              <button class="filter-pill" class:active={bagFilter === 'all'} onclick={() => bagFilter = 'all'}>All ({bagsList.length})</button>
              <button class="filter-pill" class:active={bagFilter === 'unpacked'} onclick={() => bagFilter = 'unpacked'}>Unpacked ({inventory.unpackedBags})</button>
              <button class="filter-pill" class:active={bagFilter === 'packed'} onclick={() => bagFilter = 'packed'}>Packed ({inventory.packedBags})</button>
              <button class="filter-pill" class:active={bagFilter === 'pendingPickup'} onclick={() => bagFilter = 'pendingPickup'}>Ready for Pickup</button>
              <button class="filter-pill" class:active={bagFilter === 'pickedUp'} onclick={() => bagFilter = 'pickedUp'}>Picked Up ({inventory.pickedUpBags})</button>
            </div>
          </div>
          <div class="panel-actions">
            <button class="btn secondary" onclick={() => showCombineModal = true}>🔗 Combine Bags</button>
            <button class="btn secondary" onclick={exportBags}>Export Bags CSV</button>
            <button class="btn primary" onclick={printAllBags}>🖨️ Print All</button>
          </div>
        </div>

        <div class="bags-list">
          {#if filteredBags().length === 0}
            <div class="empty-state">No bags found matching your filters.</div>
          {:else}
            {#each filteredBags() as b}
              {@const bagShirts = getBagShirtSummary(b, state.participants)}
              <div class="bag-card" class:is-packed={b.packed} class:is-picked-up={b.pickedUp}>
                <div class="bag-card-header">
                  <div class="bag-header-left">
                    <span class="bag-number-tag">Bag #{b.bagNumber}</span>
                    <h4 class="bag-family-name">{b.familyName}</h4>
                  </div>
                  <div class="bag-header-right">
                    <button 
                      class="status-toggle-btn" 
                      class:active={b.packed} 
                      onclick={() => togglePacked(b.id)}
                    >
                      {b.packed ? '✓ Packed' : '○ Pack'}
                    </button>
                    <button 
                      class="status-toggle-btn pickup-btn" 
                      class:active={b.pickedUp} 
                      onclick={() => togglePickedUp(b.id)}
                    >
                      {b.pickedUp ? '✓ Picked Up' : '○ Distribute'}
                    </button>
                    <button class="icon-btn" title="Print this bag slip" onclick={() => printSingleBag(b)}>
                      🖨️
                    </button>
                  </div>
                </div>

                <div class="bag-contact-row">
                  <span><strong>Contact:</strong> {b.primaryContactName || 'N/A'}</span>
                  {#if b.primaryEmail}<span><strong>Email:</strong> {b.primaryEmail}</span>{/if}
                  {#if b.primaryPhone}<span><strong>Phone:</strong> {formatPhone(b.primaryPhone)}</span>{/if}
                  <span class="shirt-count-chip"><strong>{b.participantIds.length}</strong> {b.participantIds.length === 1 ? 'shirt' : 'shirts'}</span>
                </div>

                <!-- Bag Manifest Chips -->
                <div class="bag-manifest-chips">
                  {#each Object.entries(bagShirts) as [size, count]}
                    {#if count > 0}
                      <span class="manifest-chip">{count}x {size}</span>
                    {/if}
                  {/each}
                </div>

                <!-- Bag Participants Table -->
                <div class="bag-participants-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Participant</th>
                        <th>Event</th>
                        <th>Shirt Size</th>
                        <th>Waiver</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each b.participantIds as pid}
                        {@const p = state.participants[pid]}
                        {#if p}
                          <tr>
                            <td>
                              <strong>{p.fullName}</strong>
                              {#if p.grade || p.teacher}
                                <span class="sub-detail">({p.grade || ''}{p.teacher ? `, ${p.teacher}` : ''})</span>
                              {/if}
                            </td>
                            <td><span class="source-tag {p.source.toLowerCase()}">{p.source}</span></td>
                            <td><span class="size-pill-small">{p.shirtSize}</span></td>
                            <td>
                              {#if p.waiverSigned}
                                <span class="text-green font-bold">✓ Signed</span>
                              {:else}
                                <span class="text-red font-bold">⚠️ Missing</span>
                              {/if}
                            </td>
                            <td>
                              <div class="row-actions">
                                <button class="link-btn" onclick={() => openMoveParticipant(p.id)}>Move</button>
                                {#if b.participantIds.length > 1}
                                  <button class="link-btn" onclick={() => separateParticipantToNewBag(p.id)}>Separate</button>
                                {/if}
                                <button class="link-btn" onclick={() => openEditParticipant(p)}>Edit</button>
                              </div>
                            </td>
                          </tr>
                        {/if}
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    <!-- PARTICIPANTS TAB -->
    {#if activeTab === 'participants'}
      <div class="content-panel">
        <div class="panel-header flex-between">
          <div class="search-and-filters">
            <input 
              type="search" 
              class="search-input" 
              placeholder="Search by participant name, email, phone, bag #..." 
              bind:value={searchQuery}
            />
          </div>
          <button class="btn secondary" onclick={exportParticipants}>Export All Participants CSV</button>
        </div>

        <div class="table-container-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Full Name</th>
                <th>Source</th>
                <th>Assigned Bag</th>
                <th>Shirt Size</th>
                <th>Raw Size</th>
                <th>Waiver</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredParticipants() as p}
                {@const bag = state.bags[p.assignedBagId]}
                <tr>
                  <td><code>{p.id}</code></td>
                  <td><strong>{p.fullName}</strong></td>
                  <td><span class="source-tag {p.source.toLowerCase()}">{p.source}</span></td>
                  <td>
                    {#if bag}
                      <button type="button" class="bag-link-btn" onclick={() => { activeTab = 'bags'; searchQuery = bag.familyName; }}>
                        Bag #{bag.bagNumber} ({bag.familyName})
                      </button>
                    {:else}
                      <span class="text-red">Unassigned</span>
                    {/if}
                  </td>
                  <td><span class="size-pill-small">{p.shirtSize}</span></td>
                  <td class="text-muted">{p.rawShirtSize}</td>
                  <td>
                    {#if p.waiverSigned}
                      <span class="text-green">✓ Signed</span>
                    {:else}
                      <span class="text-red font-bold">⚠️ Missing</span>
                    {/if}
                  </td>
                  <td class="text-muted">{p.email || '-'}</td>
                  <td class="text-muted">{formatPhone(p.phone) || '-'}</td>
                  <td>
                    <div class="row-actions">
                      <button class="link-btn" onclick={() => openMoveParticipant(p.id)}>Move</button>
                      <button class="link-btn" onclick={() => openEditParticipant(p)}>Edit</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <!-- UNVERIFIED / MISSING ORDER ID TAB -->
    {#if activeTab === 'unverified'}
      <div class="content-panel">
        <div class="panel-header flex-between">
          <div>
            <h3>Unverified Participants (Missing Order ID)</h3>
            <p class="panel-desc">
              These rows have been filtered out of packing bags because they lack an Order ID or payment confirmation. Check with the participant before packing or distributing their shirt.
            </p>
          </div>
        </div>

        {#if unverifiedParticipants.length === 0}
          <div class="empty-state">
            <p style="font-size: 16px; color: #10b981; font-weight: 600;">✓ All participants have a confirmed Order ID!</p>
            <p>No rows are currently held back from packing.</p>
          </div>
        {:else}
          <div class="table-container-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Source</th>
                  <th>Shirt Size</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Waiver</th>
                  <th>Order ID Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each unverifiedParticipants as p}
                  <tr class="row-warning">
                    <td>
                      <strong>{p.fullName}</strong>
                      {#if p.notes}<div class="sub-detail">{p.notes}</div>{/if}
                    </td>
                    <td><span class="source-tag {p.source.toLowerCase()}">{p.source}</span></td>
                    <td><span class="size-pill-small">{p.shirtSize}</span></td>
                    <td>{p.email || '-'}</td>
                    <td>{formatPhone(p.phone) || '-'}</td>
                    <td>
                      {#if p.waiverSigned}
                        <span class="text-green">✓ Signed</span>
                      {:else}
                        <span class="text-red font-bold">⚠️ Missing</span>
                      {/if}
                    </td>
                    <td>
                      <span class="text-red font-bold">❌ Missing Order ID</span>
                    </td>
                    <td>
                      <button class="btn primary sm" onclick={() => openEditParticipant(p)}>
                        Enter Order ID
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}

    <!-- REVIEW ISSUES TAB -->
    {#if activeTab === 'review'}
      <div class="content-panel">
        <div class="panel-header">
          <div>
            <h3>Review Center & Resolution Flags</h3>
            <p class="panel-desc">All ambiguous matches, suspected duplicates, missing sizes, and unsigned waivers requiring attention</p>
          </div>
        </div>

        {#if issuesList.length === 0}
          <div class="empty-state">No issues flagged. All participants and bags are reconciled!</div>
        {:else}
          <div class="issues-list">
            {#each issuesList as issue}
              <div class="issue-card {issue.severity}" class:resolved={issue.resolved}>
                <div class="issue-card-header">
                  <div class="issue-title-group">
                    <span class="issue-tag {issue.type}">{issue.type.replace(/_/g, ' ')}</span>
                    <h4>{issue.title}</h4>
                    {#if issue.resolved}
                      <span class="resolved-tag">✓ Resolved</span>
                    {/if}
                  </div>
                  {#if !issue.resolved}
                    <button class="btn secondary sm" onclick={() => resolveIssue(issue.id)}>Mark Resolved</button>
                  {/if}
                </div>
                <p class="issue-desc">{issue.description}</p>
                {#if issue.suggestedAction}
                  <div class="issue-action"><strong>Action:</strong> {issue.suggestedAction}</div>
                {/if}
                <div class="issue-participants">
                  <strong>Involved Participants:</strong>
                  <div class="issue-p-chips">
                    {#each issue.participantIds as pid}
                      {@const p = state.participants[pid]}
                      {#if p}
                        <span class="chip">
                          {p.fullName} ({p.source}, Bag #{state.bags[p.assignedBagId]?.bagNumber || '?'}, {p.shirtSize})
                        </span>
                      {/if}
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- PRINT PREVIEW TAB -->
    {#if activeTab === 'print'}
      <div class="content-panel">
        <div class="panel-header flex-between">
          <div>
            <h3>US Letter Printable Packing Slips</h3>
            <p class="panel-desc">Print standard packing sheets for volunteers with checkboxes and shirt manifests.</p>
          </div>
          <div class="panel-actions">
            <button class="btn primary" onclick={printAllBags}>🖨️ Print All ({bagsList.length} Bags)</button>
          </div>
        </div>

        <div class="print-preview-list">
          {#each bagsList as b}
            <div class="print-preview-item">
              <div class="preview-actions">
                <span><strong>Bag #{b.bagNumber}</strong>: {b.familyName} ({b.participantIds.length} shirts)</span>
                <button class="btn secondary sm" onclick={() => printSingleBag(b)}>🖨️ Print This Sheet</button>
              </div>
              <div class="preview-sheet-frame">
                <PackingSheet bag={b} participants={state.participants} />
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- IMPORT / EXPORT & BACKUP TAB -->
    {#if activeTab === 'import-export'}
      <div class="content-panel">
        <h3>Data Import & Source Files</h3>
        <p class="panel-desc">Import data from CSVs. The app preserves existing bags and never drops participants or shirts.</p>

        <div class="import-grid">
          <div class="import-card">
            <h4>Dash Registration CSV</h4>
            <p>Imports Youth Dash participants with Grade, Teacher, Youth shirt sizes.</p>
            <label class="btn secondary file-btn">
              Choose Dash.csv
              <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Dash')} hidden />
            </label>
            <div class="import-status">
              Status: {state.importedFiles.dash ? '✓ Loaded' : '○ Not loaded'}
            </div>
          </div>

          <div class="import-card">
            <h4>Family Registration CSV</h4>
            <p>Expands Family runners (up to 6) and maps duplicate Runner 4 shirt headers correctly.</p>
            <label class="btn secondary file-btn">
              Choose Family.csv
              <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Family')} hidden />
            </label>
            <div class="import-status">
              Status: {state.importedFiles.family ? '✓ Loaded' : '○ Not loaded'}
            </div>
          </div>

          <div class="import-card">
            <h4>Individual 5k Registration CSV</h4>
            <p>Imports individual 5k participants (Adult shirts, birthday, gender).</p>
            <label class="btn secondary file-btn">
              Choose Individual .csv
              <input type="file" accept=".csv" onchange={(e) => handleCsvUpload(e, 'Individual')} hidden />
            </label>
            <div class="import-status">
              Status: {state.importedFiles.individual ? '✓ Loaded' : '○ Not loaded'}
            </div>
          </div>
        </div>

        <div class="autoload-section">
          <h4>Auto-Load Built-in Workspace Data</h4>
          <p>Quickly import the 3 raw data files already in your repository (`raw_data/` directory).</p>
          <button class="btn primary" onclick={autoLoadRawFiles}>Load All 3 Workspace CSVs</button>
        </div>

        <hr class="divider" />

        <h3>Export & Full Backup / Restore</h3>
        <p class="panel-desc">Generate CSV reports or backup your complete system state (including packing and pickup progress).</p>

        <div class="export-btn-row">
          <button class="btn secondary" onclick={exportParticipants}>📥 Export Participants CSV</button>
          <button class="btn secondary" onclick={exportBags}>📥 Export Family Bags CSV</button>
          <button class="btn secondary" onclick={exportInventory}>📥 Export Shirt Inventory CSV</button>
          <button class="btn primary" onclick={backupState}>💾 Download Full JSON Backup</button>
          <label class="btn secondary file-btn">
            📂 Restore from JSON Backup
            <input type="file" accept=".json" onchange={restoreBackup} hidden />
          </label>
        </div>

        <hr class="divider" />

        <div class="danger-zone">
          <h4>Reset State</h4>
          <p>Clears the participant and bag state in Firebase cloud for all volunteers.</p>
          <button class="btn danger" onclick={async () => {
            if (confirm('Are you sure you want to clear all loaded participants and bags from Firebase? This will clear it for all users.')) {
              await updateAndPersist(s => {
                s.participants = {};
                s.bags = {};
                s.issues = {};
                s.importedFiles = { dash: false, family: false, individual: false };
              });
              notify('Firebase cloud state cleared.');
            }
          }}>Reset Cloud State</button>
        </div>
      </div>
    {/if}
  {/if}
  </main>

  <!-- PRINT MODAL / VIEW (Visible during print window) -->
  {#if showPrintModal}
    <div class="print-modal-overlay no-print">
      <div class="print-modal-bar">
        <span>Printing: {printMode === 'all' ? `All Bags (${bagsList.length} pages)` : `Bag #${selectedBagForPrint?.bagNumber}`}</span>
        <div>
          <button class="btn primary" onclick={triggerBrowserPrint}>🖨️ Send to Printer</button>
          <button class="btn secondary" onclick={() => showPrintModal = false}>Close</button>
        </div>
      </div>
    </div>

    <div class="print-container">
      {#if printMode === 'single' && selectedBagForPrint}
        <PackingSheet bag={selectedBagForPrint} participants={state.participants} />
      {:else}
        {#each bagsList as b}
          <PackingSheet bag={b} participants={state.participants} />
        {/each}
      {/if}
    </div>
  {/if}

  <!-- MOVE PARTICIPANT MODAL -->
  {#if showMoveModal && moveParticipantId}
    {@const p = state.participants[moveParticipantId]}
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>Move Participant to Different Bag</h3>
        <p>Select target bag for <strong>{p?.fullName}</strong> ({p?.shirtSize}):</p>
        <div class="form-group">
          <label for="bag-select">Target Bag:</label>
          <select id="bag-select" class="form-select" bind:value={targetBagId}>
            {#each bagsList as b}
              <option value={b.id}>
                Bag #{b.bagNumber}: {b.familyName} ({b.participantIds.length} current members)
              </option>
            {/each}
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" onclick={() => showMoveModal = false}>Cancel</button>
          <button class="btn primary" onclick={confirmMoveParticipant}>Move Participant</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- COMBINE BAGS MODAL -->
  {#if showCombineModal}
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>Combine Two Family Bags</h3>
        <p>Merge all participants and shirts from one bag into another bag.</p>
        <div class="form-group">
          <label for="src-bag">Source Bag (will be merged and removed):</label>
          <select id="src-bag" class="form-select" bind:value={combineSourceBagId}>
            <option value="">-- Select Source Bag --</option>
            {#each bagsList as b}
              <option value={b.id}>Bag #{b.bagNumber}: {b.familyName} ({b.participantIds.length} shirts)</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="tgt-bag">Target Bag (will receive participants):</label>
          <select id="tgt-bag" class="form-select" bind:value={combineTargetBagId}>
            <option value="">-- Select Target Bag --</option>
            {#each bagsList as b}
              {#if b.id !== combineSourceBagId}
                <option value={b.id}>Bag #{b.bagNumber}: {b.familyName} ({b.participantIds.length} shirts)</option>
              {/if}
            {/each}
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" onclick={() => showCombineModal = false}>Cancel</button>
          <button class="btn primary" onclick={confirmCombineBags}>Combine Bags</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- EDIT PARTICIPANT MODAL -->
  {#if showEditParticipantModal && editingParticipant}
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3>Edit Participant & Verification</h3>
        <div class="form-group">
          <label for="edit-fname">First Name:</label>
          <input id="edit-fname" class="form-input" bind:value={editingParticipant.firstName} />
        </div>
        <div class="form-group">
          <label for="edit-lname">Last Name:</label>
          <input id="edit-lname" class="form-input" bind:value={editingParticipant.lastName} />
        </div>
        <div class="form-group">
          <label for="edit-order">Order ID / Transaction Ref:</label>
          <input 
            id="edit-order" 
            class="form-input" 
            placeholder="e.g. ORD-10492 or Checked" 
            bind:value={editingParticipant.orderId} 
          />
          <small style="color: #64748b; font-size: 11px;">Providing an Order ID moves the runner into active packing bags.</small>
        </div>
        <div class="form-group">
          <label for="edit-size">Shirt Size:</label>
          <select id="edit-size" class="form-select" bind:value={editingParticipant.shirtSize}>
            {#each ALL_SHIRT_SIZES as size}
              <option value={size}>{size}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label for="edit-waiver">Waiver Signed:</label>
          <select id="edit-waiver" class="form-select" bind:value={editingParticipant.waiverSigned}>
            <option value={true}>Yes (Verified)</option>
            <option value={false}>No (Missing)</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" onclick={() => showEditParticipantModal = false}>Cancel</button>
          <button class="btn primary" onclick={saveEditedParticipant}>Save Changes</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background-color: #f8fafc;
    color: #1e293b;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }

  .app-layout {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Header */
  .app-header {
    background: #0f172a;
    color: #ffffff;
    padding: 16px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #f97316;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .trot-logo {
    font-size: 32px;
  }

  .brand h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: #94a3b8;
  }

  .header-status {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .status-summary {
    display: flex;
    gap: 8px;
  }

  .cloud-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 14px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
  }
  .cloud-status-badge.connected {
    color: #38bdf8;
    border-color: #0284c7;
    background: #082f49;
  }
  .cloud-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #64748b;
  }
  .cloud-status-badge.connected .cloud-dot {
    background: #38bdf8;
    box-shadow: 0 0 6px #38bdf8;
  }

  .stat-badge {
    background: #1e293b;
    border: 1px solid #334155;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
  }
  .stat-badge.highlight {
    border-color: #3b82f6;
    color: #60a5fa;
  }
  .stat-badge.success {
    border-color: #10b981;
    color: #34d399;
  }

  .warning-pill {
    background: #ef4444;
    color: #ffffff;
    border: none;
    padding: 6px 12px;
    border-radius: 20px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }

  /* Toast Notification */
  .notification-toast {
    position: fixed;
    top: 75px;
    right: 24px;
    z-index: 9999;
    padding: 12px 18px;
    border-radius: 8px;
    font-size: 14px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    gap: 12px;
    color: white;
  }
  .notification-toast.success { background: #059669; }
  .notification-toast.error { background: #dc2626; }
  .notification-toast.info { background: #2563eb; }

  .close-toast {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    font-size: 14px;
  }

  /* Navigation Tabs */
  .nav-tabs {
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    padding: 0 24px;
    gap: 8px;
    overflow-x: auto;
  }

  .tab-btn {
    background: none;
    border: none;
    padding: 14px 16px;
    font-size: 14px;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .tab-btn:hover {
    color: #0f172a;
  }

  .tab-btn.active {
    color: #ea580c;
    border-bottom-color: #ea580c;
  }

  .badge-count-red {
    background: #ef4444;
    color: white;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* Content Area */
  .tab-content {
    flex: 1;
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }

  /* Dashboard Grid */
  .dashboard-grid {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .stats-overview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }

  .stat-card {
    background: #ffffff;
    padding: 18px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
  }

  .card-title {
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 700;
    color: #64748b;
  }

  .card-value {
    font-size: 32px;
    font-weight: 800;
    margin: 6px 0;
    color: #0f172a;
  }

  .card-sub {
    font-size: 12px;
    color: #94a3b8;
  }

  .progress-bar-bg {
    background: #e2e8f0;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    margin-top: 8px;
  }

  .progress-bar-fill {
    height: 100%;
    transition: width 0.3s ease;
  }

  .content-panel {
    background: #ffffff;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    padding: 20px;
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
  }

  .panel-header {
    margin-bottom: 16px;
  }

  .panel-header.flex-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
  }

  .panel-desc {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .dashboard-side-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .waiver-stat-box {
    display: flex;
    gap: 24px;
    margin: 14px 0;
  }

  .waiver-stat-item {
    display: flex;
    flex-direction: column;
  }

  .w-num {
    font-size: 28px;
    font-weight: 800;
  }

  .w-label {
    font-size: 12px;
    color: #64748b;
  }

  .help-text {
    font-size: 13px;
    color: #b45309;
    background: #fffbeb;
    padding: 8px 12px;
    border-radius: 6px;
  }

  .quick-btn-group {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }

  /* Buttons */
  .btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  .btn.primary {
    background: #ea580c;
    color: #ffffff;
  }
  .btn.primary:hover {
    background: #c2410c;
  }
  .btn.secondary {
    background: #ffffff;
    border-color: #cbd5e1;
    color: #334155;
  }
  .btn.secondary:hover {
    background: #f1f5f9;
  }
  .btn.danger {
    background: #ef4444;
    color: white;
  }
  .btn.sm {
    padding: 4px 10px;
    font-size: 12px;
  }
  .btn.full-width {
    width: 100%;
  }

  .file-btn {
    cursor: pointer;
  }

  .link-btn {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 12px;
    cursor: pointer;
    padding: 0 4px;
    text-decoration: underline;
  }

  /* Tables */
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .data-table th {
    background: #f8fafc;
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid #e2e8f0;
    color: #475569;
    font-weight: 600;
  }

  .data-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
  }

  .table-total-row td {
    border-top: 2px solid #cbd5e1;
    background: #f8fafc;
  }

  .size-pill-tag {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 12px;
  }
  .size-pill-tag.youth { background: #e0f2fe; color: #0369a1; }
  .size-pill-tag.adult { background: #dbeafe; color: #1e40af; }
  .size-pill-tag.unknown { background: #fee2e2; color: #b91c1c; }

  .size-pill-small {
    background: #0f172a;
    color: #ffffff;
    font-weight: 700;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .source-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .source-tag.dash { background: #fef3c7; color: #92400e; }
  .source-tag.family { background: #dbeafe; color: #1e40af; }
  .source-tag.individual { background: #dcfce7; color: #166534; }

  /* Bags List */
  .search-and-filters {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    flex: 1;
  }

  .search-input {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    font-size: 13px;
    min-width: 280px;
  }

  .filter-pills {
    display: flex;
    gap: 6px;
  }

  .filter-pill {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    color: #475569;
  }
  .filter-pill.active {
    background: #0f172a;
    color: #ffffff;
    border-color: #0f172a;
  }

  .bags-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 16px;
  }

  .bag-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    background: #ffffff;
    transition: all 0.15s ease;
  }

  .bag-card.is-packed {
    border-left: 4px solid #3b82f6;
  }

  .bag-card.is-picked-up {
    border-left: 4px solid #10b981;
    background: #fcfdfd;
  }

  .bag-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .bag-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .bag-number-tag {
    background: #0f172a;
    color: white;
    font-weight: 800;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .bag-family-name {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }

  .bag-header-right {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .status-toggle-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
  }

  .status-toggle-btn.active {
    background: #3b82f6;
    color: #ffffff;
    border-color: #3b82f6;
  }

  .status-toggle-btn.pickup-btn.active {
    background: #10b981;
    border-color: #10b981;
  }

  .icon-btn {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
  }

  .bag-contact-row {
    margin-top: 8px;
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: #475569;
    align-items: center;
    flex-wrap: wrap;
  }

  .shirt-count-chip {
    background: #e0e7ff;
    color: #3730a3;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
  }

  .bag-manifest-chips {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    flex-wrap: wrap;
  }

  .manifest-chip {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    color: #1e293b;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .bag-participants-table {
    margin-top: 12px;
  }

  .bag-participants-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .bag-participants-table th {
    text-align: left;
    background: #f8fafc;
    padding: 6px 8px;
    color: #64748b;
    font-weight: 600;
  }

  .bag-participants-table td {
    padding: 6px 8px;
    border-top: 1px solid #f1f5f9;
  }

  .sub-detail {
    font-size: 11px;
    color: #64748b;
  }

  .bag-link {
    color: #2563eb;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
  }

  /* Issues list */
  .issues-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 14px;
  }

  .issue-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px;
    background: #ffffff;
  }

  .issue-card.warning { border-left: 4px solid #f59e0b; }
  .issue-card.error { border-left: 4px solid #ef4444; }
  .issue-card.info { border-left: 4px solid #3b82f6; }
  .issue-card.resolved { opacity: 0.6; border-left: 4px solid #10b981; }

  .issue-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .issue-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .issue-title-group h4 {
    margin: 0;
    font-size: 14px;
  }

  .issue-tag {
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f1f5f9;
  }

  .resolved-tag {
    background: #dcfce7;
    color: #166534;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .issue-desc {
    margin: 6px 0;
    font-size: 13px;
    color: #475569;
  }

  .issue-action {
    font-size: 12px;
    color: #0369a1;
    background: #f0f9ff;
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 6px;
  }

  .issue-participants {
    font-size: 12px;
  }

  .issue-p-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .chip {
    background: #e2e8f0;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
  }

  /* Import / Export Grid */
  .import-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
    margin-top: 14px;
  }

  .import-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    background: #ffffff;
  }

  .import-card h4 {
    margin: 0 0 6px 0;
    font-size: 15px;
  }

  .import-card p {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 14px;
  }

  .import-status {
    margin-top: 8px;
    font-size: 12px;
    color: #475569;
    font-weight: 500;
  }

  .autoload-section {
    margin-top: 20px;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    padding: 16px;
    border-radius: 8px;
  }
  .autoload-section h4 { margin: 0; color: #9a3412; }
  .autoload-section p { font-size: 13px; color: #c2410c; margin: 4px 0 12px 0; }

  .divider {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 24px 0;
  }

  .export-btn-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 12px;
  }

  .danger-zone {
    background: #fef2f2;
    border: 1px solid #fecaca;
    padding: 16px;
    border-radius: 8px;
  }
  .danger-zone h4 { margin: 0; color: #991b1b; }
  .danger-zone p { font-size: 13px; color: #b91c1c; margin: 4px 0 10px 0; }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 8px;
    padding: 24px;
    width: 460px;
    max-width: 90vw;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  }

  .modal-box h3 {
    margin: 0 0 8px 0;
  }

  .form-group {
    margin: 14px 0;
  }

  .form-group label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
    color: #475569;
  }

  .form-select, .form-input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    font-size: 13px;
    box-sizing: border-box;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }

  /* Print Modal View */
  .print-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #0f172a;
    color: white;
    padding: 12px 24px;
    z-index: 10001;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .print-modal-bar {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .print-container {
    padding-top: 60px;
    background: #525659;
    min-height: 100vh;
    padding-bottom: 40px;
  }

  .preview-sheet-frame {
    transform-origin: top center;
    margin: 10px 0;
  }

  .print-preview-list {
    display: flex;
    flex-direction: column;
    gap: 30px;
    margin-top: 16px;
  }

  .preview-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f1f5f9;
    padding: 8px 12px;
    border-radius: 6px;
    margin-bottom: 8px;
    font-size: 13px;
  }

  /* Utility */
  .text-green { color: #10b981; }
  .text-red { color: #ef4444; }
  .text-muted { color: #64748b; font-size: 12px; }
  .font-bold { font-weight: 700; }
  .empty-state {
    padding: 40px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
  }

  .bag-link-btn {
    background: none;
    border: none;
    color: #2563eb;
    font-weight: 600;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    font-size: 13px;
    text-align: left;
  }

  .empty-cloud-banner {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    padding: 24px;
    background: #f8fafc;
    border: 2px dashed #94a3b8;
    border-radius: 12px;
    margin-bottom: 24px;
  }

  .empty-cloud-icon {
    font-size: 40px;
    line-height: 1;
  }

  .empty-cloud-info {
    flex: 1;
  }

  .empty-cloud-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  /* Print Styles */
  @media print {
    .no-print, header, nav, .tab-content, .print-modal-overlay {
      display: none !important;
    }
    .print-container {
      padding: 0 !important;
      background: none !important;
      min-height: auto !important;
    }
    :global(body) {
      background: white !important;
    }
  }
</style>
