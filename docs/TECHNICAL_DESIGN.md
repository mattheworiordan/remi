# remi - Technical Design Document

## Overview

This document covers the internal architecture of remi, focusing on how it interacts with Apple Reminders at the database, framework, and API levels. It is intended for contributors and anyone interested in the reverse-engineered sync mechanisms.

## Database Location and Structure

### Location

The Apple Reminders SQLite database lives at:

```
~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores/
```

This directory contains one or more `.sqlite` files (with corresponding `-wal` and `-shm` files). The active database is the one with reminder data in `ZREMCDREMINDER`.

### Key Tables

| Table | Purpose |
|-------|---------|
| `ZREMCDREMINDER` | Individual reminders (tasks) |
| `ZREMCDBASELIST` | Reminder lists and their metadata |
| `ZREMCDBASESECTION` | Sections within lists |
| `ZREMCDBASEACCOUNT` | Accounts (iCloud, local, Exchange, etc.) |
| `Z_PRIMARYKEY` | Auto-increment counters for each entity |
| `Z_METADATA` | Core Data metadata and version info |
| `Z_MODELCACHE` | Cached Core Data model definition |

### Key Columns on ZREMCDBASELIST

| Column | Type | Purpose |
|--------|------|---------|
| `Z_PK` | INTEGER | Primary key |
| `ZNAME` | TEXT | Display name of the list |
| `ZMARKEDFORDELETION` | INTEGER | Soft-delete flag (0 = active) |
| `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA` | TEXT | JSON blob mapping reminders to sections |
| `ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM` | TEXT | SHA-512 hex checksum of membership data |
| `ZRESOLUTIONTOKENMAP_V3_JSONDATA` | TEXT | CRDT vector clock data for sync |
| `ZCKDIRTYFLAGS` | INTEGER | CloudKit dirty flags (managed by remindd) |
| `ZCKSERVERRECORDDATA` | BLOB | Serialized CloudKit server record |
| `ZCKRECORDID` | TEXT | CloudKit record identifier |
| `ZSORTORDER` | INTEGER | Display order among lists |
| `ZCOLORKIND` | INTEGER | List color identifier |
| `ZICON` | TEXT | List icon name |

### Key Columns on ZREMCDBASESECTION

| Column | Type | Purpose |
|--------|------|---------|
| `Z_PK` | INTEGER | Primary key |
| `ZDISPLAYNAME` | TEXT | Section name |
| `ZLIST` | INTEGER | Foreign key to ZREMCDBASELIST.Z_PK |
| `ZSORTORDER` | INTEGER | Display order within the list |
| `ZMARKEDFORDELETION` | INTEGER | Soft-delete flag |
| `ZCKRECORDID` | TEXT | CloudKit record identifier |

### Membership Data JSON Format

The `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA` column contains a JSON blob with the following structure:

```json
{
  "memberships": [
    {
      "reminderID": "x-apple-reminder://XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
      "sectionID": "x-apple-reminders-section://XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
    },
    {
      "reminderID": "x-apple-reminder://YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY",
      "sectionID": "x-apple-reminders-section://YYYYYYYY-YYYY-YYYY-YYYY-YYYYYYYYYYYY"
    }
  ]
}
```

Each entry maps a reminder (by its `x-apple-reminder://` URL) to a section (by its `x-apple-reminders-section://` URL). Reminders not in any section are simply absent from this list.

## Three-Layer API Strategy

### Layer 1: EventKit (Public API)

**Used for**: Creating/reading/updating/deleting reminders, list CRUD, querying, date-based filtering.

EventKit is Apple's official public framework for accessing calendar and reminder data. It provides:
- Full CRUD for reminders (EKReminder)
- Calendar/list management (EKCalendar)
- Predicate-based queries
- Proper permission handling
- Automatic sync triggering

**Limitations**: No section access whatsoever. Apple has never exposed sections in EventKit.

```swift
import EventKit

let store = EKEventStore()
// Request access, then:
let calendars = store.calendars(for: .reminder)
let predicate = store.predicateForReminders(in: calendars)
```

### Layer 2: ReminderKit (Private Framework)

**Used for**: Section CRUD (create, list, delete sections).

ReminderKit is Apple's private framework at `/System/Library/PrivateFrameworks/ReminderKit.framework`. It provides full access to the Reminders data model through Core Data, including sections.

Key classes:
- `REMStore` - Data store (equivalent to EKEventStore)
- `REMAccountsDataView` - Account management
- `REMListsDataView` - List management
- `REMListSectionsDataView` - Section management
- `REMSaveRequest` - Batched save operations
- `REMListChangeItem` - Tracked list modifications

**Why ReminderKit for sections**: Creating sections through ReminderKit goes through Core Data properly, which means remindd's sync engine automatically picks up the changes and pushes them to CloudKit. Direct SQLite section creation works locally but does NOT sync.

**Risk**: As a private framework, ReminderKit's API may change without notice in any macOS update. remi should gracefully degrade to SQLite-only (local, no sync) if ReminderKit becomes unavailable.

### Layer 3: SQLite + Resolution Token Map

**Used for**: Section membership (assigning reminders to sections) with iCloud sync.

This is the critical innovation. Neither EventKit nor ReminderKit reliably handles section membership assignment with sync. The approach:

1. Write membership JSON directly to SQLite
2. Compute and write SHA-512 checksum
3. Manipulate the resolution token map to signal a local change
4. Trigger a sync cycle via EventKit

## Section Creation Code Flow

```
User: remi create-section "Groceries" "Produce"
  │
  ├─ 1. Load ReminderKit private framework
  │     Bundle(path: "/System/Library/PrivateFrameworks/ReminderKit.framework")
  │
  ├─ 2. Initialize ReminderKit bridge
  │     REMStore → REMAccountsDataView → REMListsDataView → REMListSectionsDataView
  │
  ├─ 3. Find list "Groceries" across all accounts
  │     fetchAllAccountsWithError: → fetchListsInAccount:error: → match displayName
  │
  ├─ 4. Check if section already exists (idempotent)
  │     fetchListSectionsInList:error: → check displayName
  │
  ├─ 5. Create section via REMSaveRequest
  │     REMSaveRequest → REMListChangeItem → sectionsContextChangeItem
  │     → addListSectionWithDisplayName:toListSectionContextChangeItem:
  │
  └─ 6. Save synchronously
        saveSynchronouslyWithError: → Core Data → CloudKit sync triggered
```

## Section Deletion Code Flow

```
User: remi delete-section "Groceries" "Produce"
  │
  ├─ 1-3. Same initialization and list lookup as creation
  │
  ├─ 4. Find target section by displayName
  │     fetchListSectionsInList:error: → match displayName
  │
  ├─ 5. Delete via tracked change item
  │     REMSaveRequest → updateListSection: → removeFromList
  │     Note: Must use updateListSection: (not manually creating change items)
  │     to get properly tracked deletions that sync via CloudKit
  │
  └─ 6. Save synchronously
        saveSynchronouslyWithError: → Core Data → CloudKit sync triggered
```

## The Resolution Token Map Breakthrough

### Background

Apple's remindd daemon implements a custom CloudKit sync engine. It does NOT use NSPersistentCloudKitContainer (Apple's high-level Core Data + CloudKit integration). Instead, it implements its own CRDT-style conflict resolution using vector clocks stored in what Apple calls "resolution token maps."

### How It Works

Each syncable field on a Core Data entity has a corresponding entry in `ZRESOLUTIONTOKENMAP_V3_JSONDATA`. The token map is a JSON blob stored on the list record:

```json
{
  "membershipsOfRemindersInSectionsChecksum": {
    "counter": 5,
    "modificationTime": 733456789.123456
  },
  "displayName": {
    "counter": 2,
    "modificationTime": 733456700.000000
  },
  "sortOrder": {
    "counter": 1,
    "modificationTime": 733456600.000000
  }
}
```

When remindd prepares a CloudKit push, it compares each field's counter against the last-synced counter. Fields with incremented counters are included in the CKModifyRecordsOperation. Fields without changes are skipped.

### The Key Insight

Simply writing to `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA` in SQLite does nothing for sync. The sync engine never looks at raw column values to detect changes - it ONLY looks at the resolution token map counters. If the counter hasn't changed, the field is considered unmodified.

To make membership changes sync:
1. Write the data (SQLite)
2. Write the checksum (SQLite - remindd uses checksums to detect data corruption)
3. Increment the counter in the resolution token map (SQLite)
4. Set modificationTime to current Core Data timestamp (SQLite)
5. Trigger a sync cycle so remindd actually runs the push (EventKit edit)

### Sync Trigger Mechanism

After updating SQLite, we need remindd to wake up and run a sync cycle. The most reliable method: edit a reminder in the same list via EventKit. This causes EKEventStore to post a notification that remindd observes, triggering a full sync cycle.

The edit must be non-destructive. remi toggles a trailing space on the first reminder's notes field:
- If notes end with a space, remove it
- If notes don't end with a space, add one

This produces a real EventKit change (remindd will sync it) without visually affecting the reminder.

## Implementation Safety Notes

### NEVER Clear ZCKSERVERRECORDDATA

`ZCKSERVERRECORDDATA` contains the serialized CloudKit server record, including the change tag (etag) that CloudKit uses for optimistic concurrency control. Clearing this field causes remindd to lose track of the server state, leading to:
- Duplicate records on other devices
- Sync conflicts that resolve incorrectly
- Potential data loss

remindd's sync engine manages this field automatically when it detects token map changes. We MUST NOT touch it.

### NEVER Set ZCKDIRTYFLAGS Manually

`ZCKDIRTYFLAGS` is a bitmask that remindd uses internally to track which CloudKit record zones need attention. Setting it manually can cause:
- Unnecessary full-record uploads (bandwidth waste)
- Race conditions with remindd's own flag management
- Incorrect sync state

The resolution token map approach avoids both of these pitfalls - it works WITH remindd's sync engine rather than trying to circumvent it.

### SQL Transaction Safety

All SQLite operations that modify the database MUST be atomic. A partial write (e.g., membership data updated but checksum not) will cause remindd to detect data corruption and potentially reset the field.

The three-step SQLite write (data, checksum, token map) should ideally be wrapped in a single transaction:

```sql
BEGIN TRANSACTION;
UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA = '...' WHERE Z_PK = ?;
UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM = '...' WHERE Z_PK = ?;
UPDATE ZREMCDBASELIST SET ZRESOLUTIONTOKENMAP_V3_JSONDATA = '...' WHERE Z_PK = ?;
COMMIT;
```

**Current limitation**: The Swift implementation uses separate sqlite3 process calls for each statement. This should be consolidated to a single transactional call in remi's implementation.

### Sync Trigger Edge Case

The EventKit sync trigger (toggling trailing space on notes) has an edge case: if the list has zero incomplete reminders, there's nothing to edit. In this case:
- The membership data IS written to SQLite with the correct token map
- It will sync the NEXT time any change occurs in that list (natural sync)
- remi should warn the user: "Memberships written but sync trigger unavailable - changes will sync on next natural edit"

This is non-fatal because the data and token map are correct - we just can't force remindd to run a push cycle immediately.

## Subtask Implementation

### Database Structure

Subtasks use the `ZPARENTREMINDER` column on `ZREMCDREMINDER`:

| Column | Type | Purpose |
|--------|------|---------|
| `ZPARENTREMINDER` | INTEGER | Foreign key to parent ZREMCDREMINDER.Z_PK (NULL for top-level) |
| `ZCHILDREMINDERS` | - | Inverse relationship (managed by Core Data) |
| `ZSORTORDERINPARENT` | INTEGER | Display order within parent's subtask list |

### EventKit Access

EventKit does not expose subtask relationships. To read subtasks, query SQLite:

```sql
SELECT Z_PK, ZTITLE, ZCOMPLETED, ZSORTORDERINPARENT
FROM ZREMCDREMINDER
WHERE ZPARENTREMINDER = ? AND ZMARKEDFORDELETION = 0
ORDER BY ZSORTORDERINPARENT;
```

To create subtasks, use EventKit to create the reminder in the correct list, then update `ZPARENTREMINDER` via SQLite and trigger sync.

## Recurrence Rules

### Storage

Recurrence rules are stored in `ZRECURRENCERULE` on `ZREMCDREMINDER` as a serialized binary plist (not JSON). EventKit handles recurrence natively:

```swift
let rule = EKRecurrenceRule(
    recurrenceWith: .weekly,
    interval: 2,
    daysOfTheWeek: [EKRecurrenceDayOfWeek(.monday)],
    daysOfTheMonth: nil,
    monthsOfTheYear: nil,
    weeksOfTheYear: nil,
    daysOfTheYear: nil,
    setPositions: nil,
    end: EKRecurrenceEnd(occurrenceCount: 10)
)
reminder.recurrenceRules = [rule]
```

### remi Interface

```bash
remi add "Work" "Team standup" --repeat daily
remi add "Work" "Sprint review" --repeat "every 2 weeks on friday"
remi add "Groceries" "Restock basics" --repeat "every 3 days"
remi add "Home Projects" "HVAC filter" --repeat "every 3 months"
```

The `--repeat` flag accepts:
- Simple: `daily`, `weekly`, `monthly`, `yearly`
- Complex: `"every N days/weeks/months"`, `"every N weeks on monday,wednesday"`
- End conditions: `"daily until 2024-12-31"`, `"weekly for 10 times"`

## CloudKit Architecture

### How remindd Syncs

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│   EventKit  │────>│   remindd   │────>│   CloudKit   │
│  (changes)  │     │  (daemon)   │     │   (server)   │
└─────────────┘     └──────┬──────┘     └──────────────┘
                           │
                    ┌──────┴──────┐
                    │  Core Data  │
                    │  (SQLite)   │
                    └─────────────┘
```

1. **EventKit changes** → remindd receives EKEventStoreChangedNotification
2. **remindd wakes up** → reads Core Data / SQLite for local changes
3. **Resolution token map check** → compares counters against last-synced state
4. **CKModifyRecordsOperation** → pushes changed fields to CloudKit
5. **Remote changes** → CKFetchRecordZoneChangesOperation pulls from CloudKit
6. **Conflict resolution** → higher counter wins (CRDT vector clock merge)

### CloudKit Record Types

| Record Type | Maps To | Key Fields |
|-------------|---------|------------|
| `ReminderList` | `ZREMCDBASELIST` | name, color, icon, memberships |
| `Reminder` | `ZREMCDREMINDER` | title, notes, dueDate, priority, completed |
| `ListSection` | `ZREMCDBASESECTION` | displayName, sortOrder |

### Zone and Container

- **Container**: `iCloud.com.apple.reminders`
- **Zone**: `com.apple.reminder` (custom zone, not default)
- **Subscription**: CKRecordZoneSubscription for push notifications

## Testing Strategy

### Unit Tests

```
tests/
  unit/
    parser.test.ts        # Date parsing, flag handling
    membership.test.ts    # Membership JSON generation, checksum
    tokenmap.test.ts      # Resolution token map manipulation
    output.test.ts        # JSON and human-readable formatting
```

### Integration Tests

```
tests/
  integration/
    eventkit.test.ts      # EventKit operations (needs Reminders access)
    sections.test.ts      # ReminderKit section CRUD
    sync.test.ts          # Full sync cycle verification
    doctor.test.ts        # Diagnostics checks
```

### Test Strategy Notes

- **Unit tests** run without system access (mock SQLite, mock EventKit)
- **Integration tests** require macOS with Reminders access granted
- **Sync tests** require iCloud account and a second device to verify
- **CI**: Unit tests only (no macOS + iCloud in CI)
- **Local**: Full suite with `remi test --integration`

### Test Fixtures

Use a dedicated test list (e.g., `_remi_test_XXXXXX` with random suffix) for integration tests. Clean up after each test run. Never modify user's real lists.

## Platform Considerations

### macOS Version Support

| Version | EventKit | ReminderKit | SQLite Schema | Sections |
|---------|----------|-------------|---------------|----------|
| macOS 13 (Ventura) | Yes | Yes | V3 token maps | Yes |
| macOS 14 (Sonoma) | Yes | Yes | V3 token maps | Yes |
| macOS 15 (Sequoia) | Yes | TBD | TBD | Yes |

### Permissions

remi requires Full Disk Access or Reminders access:
- **EventKit**: Prompts user via system dialog on first use
- **ReminderKit**: Uses same entitlement as EventKit
- **SQLite**: Requires file-system access to `~/Library/Group Containers/`

### Apple Silicon vs Intel

No architecture-specific differences. Swift helpers compile as universal binaries. The SQLite database format is architecture-independent.

## Proposed File Structure

```
remi/
├── docs/
│   ├── PRD.md                     # Product requirements
│   └── TECHNICAL_DESIGN.md        # This document
├── src/
│   ├── cli/
│   │   ├── index.ts               # Entry point, argument parsing
│   │   ├── commands/
│   │   │   ├── add.ts             # remi add
│   │   │   ├── list.ts            # remi list / remi lists
│   │   │   ├── complete.ts        # remi complete
│   │   │   ├── delete.ts          # remi delete
│   │   │   ├── update.ts          # remi update
│   │   │   ├── sections.ts        # remi sections / create-section / delete-section
│   │   │   ├── move.ts            # remi move (section assignment)
│   │   │   ├── search.ts          # remi search
│   │   │   ├── today.ts           # remi today
│   │   │   ├── upcoming.ts        # remi upcoming
│   │   │   ├── overdue.ts         # remi overdue
│   │   │   └── doctor.ts          # remi doctor
│   │   └── output/
│   │       ├── json.ts            # JSON formatter
│   │       └── table.ts           # Human-readable table formatter
│   ├── core/
│   │   ├── eventkit.ts            # EventKit bridge (Layer 1)
│   │   ├── reminderkit.ts         # ReminderKit bridge (Layer 2)
│   │   ├── sqlite.ts              # SQLite operations (Layer 3)
│   │   ├── tokenmap.ts            # Resolution token map manipulation
│   │   ├── membership.ts          # Section membership sync
│   │   ├── checksum.ts            # SHA-512 checksum computation
│   │   └── sync.ts                # Sync trigger via EventKit
│   ├── swift/
│   │   ├── section-helper.swift   # Compiled Swift helper for ReminderKit
│   │   └── build.sh               # Swift compilation script
│   └── mcp/
│       ├── server.ts              # MCP server entry point (v1.2)
│       └── tools.ts               # MCP tool definitions
├── tests/
│   ├── unit/
│   │   ├── parser.test.ts
│   │   ├── membership.test.ts
│   │   ├── tokenmap.test.ts
│   │   └── output.test.ts
│   └── integration/
│       ├── eventkit.test.ts
│       ├── sections.test.ts
│       ├── sync.test.ts
│       └── doctor.test.ts
├── package.json
├── tsconfig.json
├── LICENSE                        # MIT
└── README.md
```

## Dependencies

### Runtime

| Dependency | Purpose | Notes |
|------------|---------|-------|
| `commander` | CLI argument parsing | Standard Node.js CLI framework |
| `better-sqlite3` | SQLite access | Synchronous SQLite3 for Node.js |
| `dayjs` | Date parsing and formatting | Lightweight Moment.js alternative |
| `chalk` | Terminal colors | Human-readable output styling |

### Build-Time

| Dependency | Purpose |
|------------|---------|
| `typescript` | Type safety |
| `tsup` or `esbuild` | Bundle for distribution |
| `vitest` | Test runner |
| `swift` (system) | Compile section-helper |

### System Requirements

- macOS 13+ (Ventura or later)
- Node.js 18+
- Swift 5.9+ (included with Xcode Command Line Tools)
- Apple Reminders access permission

## Key Implementation Notes

### Swift Helper Compilation

The section-helper.swift file must be compiled before first use:

```bash
swiftc -framework Foundation -framework EventKit \
  -F /System/Library/PrivateFrameworks \
  -framework ReminderKit \
  -O -o section-helper \
  src/swift/section-helper.swift
```

**Important**: The `-F /System/Library/PrivateFrameworks` flag is needed to locate ReminderKit. This only works on macOS (not iOS or Linux).

### Error Handling Strategy

All errors should include:
1. **What happened**: "Failed to create section 'Produce' in list 'Groceries'"
2. **Why**: "ReminderKit framework not available"
3. **Fix**: "Ensure you're running macOS 13+ with Xcode Command Line Tools installed"

For agent consumers (JSON mode), errors include a machine-readable `code` field:

```json
{
  "success": false,
  "error": {
    "code": "REMINDERKIT_UNAVAILABLE",
    "message": "ReminderKit framework not available",
    "suggestion": "Ensure you're running macOS 13+ with Xcode Command Line Tools"
  }
}
```

### Checksum Computation

The membership checksum uses SHA-512 (matching Apple's implementation):

```typescript
import { createHash } from 'crypto';

function computeMembershipChecksum(membershipJson: string): string {
  return createHash('sha512').update(membershipJson, 'utf8').digest('hex');
}
```

The checksum is computed on the exact JSON string that's stored in `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA`. Any difference (whitespace, key order) produces a different checksum, so the JSON must be serialized consistently.

### Core Data Timestamps

Core Data uses "Apple reference date" timestamps: seconds since 2001-01-01 00:00:00 UTC. This is different from Unix timestamps (1970-01-01).

```typescript
function coreDataTimestamp(): number {
  // Seconds since 2001-01-01 00:00:00 UTC
  const appleEpoch = new Date('2001-01-01T00:00:00Z').getTime();
  return (Date.now() - appleEpoch) / 1000;
}
```

The `modificationTime` in the resolution token map uses this format.

### Idempotency

All remi operations should be idempotent where possible:
- Creating an already-existing section returns success (not error)
- Completing an already-completed reminder returns success
- Moving a reminder to the section it's already in returns success

This is critical for agent use cases where retries are common.

### Concurrency with remindd

remi and remindd can both write to the SQLite database. SQLite's WAL mode (which Apple uses) allows concurrent reads, but writes are serialized. remi should:
1. Keep transactions short
2. Retry on SQLITE_BUSY (up to 3 times with exponential backoff)
3. Never hold long-running transactions that could block remindd

### Database Discovery

The Reminders database file name is not fixed - it may vary across accounts and macOS versions. remi should:
1. List all `.sqlite` files in the Stores directory
2. Skip `-wal` and `-shm` files
3. Query each for `SELECT COUNT(*) FROM ZREMCDREMINDER`
4. Use the first database with actual reminder data
