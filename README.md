# MTPEF Turkey Trot 2026: T-Shirt Packing & Distribution App

A SvelteKit & Svelte 5 application designed for the MTPEF Turkey Trot event organizers and volunteers to parse race registration CSVs, group families into packing bags, reconcile shirt sizes, verify waivers and Order IDs, print volunteer packing slips, and track live packing and pickup progress.

---

## Quick Start (macOS / Local)

### 1. Install & Run
```bash
# Install dependencies
npm install

# Start local development server
npm run dev
```

Open your browser to: **[http://localhost:5173](http://localhost:5173)**

### 2. Run Tests
```bash
npm test
```

### 3. Production Build & Preview
```bash
npm run build
npm run preview
```

---

## How to Use the App

### 1. Importing Registration CSVs
1. Go to the **💾 Import / Export & Backup** tab.
2. Select your CSV files using the file pickers:
   - **Dash Registration CSV** (`Dash.csv`): Youth participants with grade, teacher, and shirt size.
   - **Family Registration CSV** (`Family.csv`): Up to 6 runners per family with duplicate `Runner 4 Shirt` column mapping.
   - **Individual 5k CSV** (`Individual .csv`): 5k runners with adult shirt sizes.
3. The app parses the CSVs in the browser, groups families into bags, and immediately reconciles shirt totals without modifying your source files.

### 2. Order ID Verification & Held Rows
- Any registration row that does not contain a verified **Order ID** / payment reference is **automatically filtered out of active packing bags** to avoid packing unconfirmed orders.
- These rows are surfaced under the **⚠️ Missing Order ID** tab and in the header warning indicator.
- Volunteers can inspect registrant contact details, verify payment, and enter the Order ID directly in the edit modal to immediately release the runner into an active packing bag.

### 3. Dashboard & Master Shirt Inventory
- View real-time metric cards:
  - **Total Registered** (total imported participants)
  - **Active for Packing** (Order ID verified runners)
  - **Missing Order ID** (held rows requiring check)
  - **Packed Bags** progress
  - **Picked Up Bags** progress
- Master **T-Shirt Inventory Table**: Shows exact shirt counts required by size (`Youth S`, `Youth M`, `Youth L`, `Adult S`, `Adult M`, `Adult L`, etc.).
- **Waiver Check**: Alerts organizers of any participants who did not sign an online waiver.

### 4. Managing Family Bags
- Open the **🎒 Family Bags** tab to view all households.
- **Search**: Search by bag number, family name, runner name, email, or phone.
- **Filter**: Quickly toggle between *All*, *Unpacked*, *Packed*, *Ready for Pickup*, or *Picked Up*.
- **Mark Status**: Click `○ Pack` to mark a bag packed (turns blue with timestamp). Click `○ Distribute` when handed out at pickup.
- **Manual Adjustments**:
  - **Move**: Move an individual participant from one bag into another.
  - **Separate**: Separate a participant into their own independent bag.
  - **Combine Bags**: Merge two separate bags together.
  - **Edit**: Correct a participant's name, shirt size, waiver, or Order ID.

### 5. Printing Packing Slips
- **Print All**: Generates US Letter printable packing slips (one per bag) for the entire event with volunteer checkboxes and bag manifests.
- **Print One**: Click the printer icon next to any bag to print a single slip.
- Volunteers use the checkbox next to each runner and the sign-off section (`Packed By` / `Picked Up By`).

### 6. Review Center
- Flags ambiguous contact matches, suspected duplicate registrations (same runner submitted twice), missing shirt sizes, and missing waivers.
- Coordinators can mark issues as resolved as they verify each situation.

### 7. Exporting & Backups
- **CSV Exports**:
  - `mtpef_participants.csv`: All participants with assigned bag numbers.
  - `mtpef_family_bags.csv`: All bags with contact info, shirt list, and status.
  - `mtpef_shirt_inventory.csv`: Final shirt counts for apparel ordering.
- **Full JSON Backup & Restore**: Download a snapshot of all bags, custom moves, and packed statuses to restore on any device.

---

## Live Multi-Device Sync (Firebase)

The app is connected to the Firebase project (`trot-2026`):
- When volunteers mark a bag as "Packed" or "Picked Up" on their phone or tablet, changes **sync in real-time** across all connected devices.
- The top header displays a **🟢 Live Cloud (trot-2026)** status indicator.
- Offline resilience: If Wi-Fi is spotty, changes are preserved locally in browser storage and sync when reconnected.

---

## Deployment (Vercel)

The project includes `@sveltejs/adapter-vercel`. To deploy:
1. Connect this repository to [Vercel](https://vercel.com).
2. Framework preset will automatically detect SvelteKit.
3. Deploy! CSV parsing and storage run client-side in the browser, fully compatible with Vercel's serverless edge.
