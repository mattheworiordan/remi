# Apple Reminders Internals — What We Learned Building remi

Apple Reminders has no public API for sections, subtasks, or section membership. Building remi required reverse-engineering Apple's sync architecture through trial and error across ~40 development sessions. This document captures what we learned so others don't have to repeat it.

**Why this matters**: Every other Reminders CLI (remindctl, rem, reminders-cli) uses EventKit only. They can create and manage reminders but cannot touch sections. remi is the first tool to support sections with iCloud sync, and it required understanding three undocumented systems: ReminderKit, the Reminders SQLite schema, and remindd's CRDT sync engine.

---

## The Three-Layer Architecture

Each layer exists because the one above it can't do something we need.

| Layer | What | Why we need it |
|-------|------|---------------|
| **EventKit** (public API) | Reminder CRUD, list management, recurrence, queries | Stable, Apple-supported, triggers automatic sync |
| **ReminderKit** (private framework) | Section CRUD (create, list, delete) | EventKit has zero section support. ReminderKit goes through Core Data and syncs via CloudKit automatically |
| **SQLite + Token Maps** | Section membership (assigning reminders to sections) | Neither EventKit nor ReminderKit reliably handles membership assignment with sync |

**Rule of thumb**: Use the highest layer possible. Drop down only when forced.

---

## The Sync Engine (remindd)

Apple's `remindd` daemon runs a **custom CloudKit sync engine** — it does NOT use `NSPersistentCloudKitContainer`. It implements CRDT-style vector clocks for field-level conflict resolution.

### How remindd decides what to push

Each list record (`ZREMCDBASELIST`) has a `ZRESOLUTIONTOKENMAP_V3_JSONDATA` column containing a JSON blob like:

```json
{
  "map": {
    "membershipsOfRemindersInSectionsChecksum": {
      "counter": 5,
      "modificationTime": 796647639.739,
      "replicaID": "C8116DE3-F9C5-4C94-B3FF-1A10D5184298"
    },
    "reminderIDsMergeableOrdering": {
      "counter": 243,
      "modificationTime": 796560895.286,
      "replicaID": "574BF506-24CC-4760-827E-56E758324690"
    }
  }
}
```

When `remindd` syncs, it compares each field's counter against the last-synced state. Fields with incremented counters are included in the CloudKit push.

### Three things we got wrong (and how to fix them)

**1. Token map entries must be inside the `"map"` key**

We initially wrote the membership counter at the top level of the JSON. It was ignored. Apple nests all entries inside a `"map"` key.

```
WRONG: {"membershipsOfRemindersInSectionsChecksum": {"counter": 1, ...}}
RIGHT: {"map": {"membershipsOfRemindersInSectionsChecksum": {"counter": 1, ..., "replicaID": "..."}}}
```

Each entry also needs a `replicaID` (a UUID). Without it, the sync engine ignores the entry.

**2. Close SQLite before triggering sync**

After writing membership data to SQLite, you must close the database connection BEFORE triggering the sync. If the connection is still open, the WAL (Write-Ahead Log) hasn't been checkpointed, and `remindd` reads stale data.

```
WRONG: write to SQLite → trigger sync → close connection
RIGHT: write to SQLite → close connection → wait 0.5s → trigger sync
```

**3. Editing a reminder doesn't trigger a list-level push**

This was the hardest bug. We spent days on it.

Toggling a reminder's notes (the sync trigger technique documented everywhere) only triggers a **reminder-level** CloudKit push. `remindd` pushes the reminder record but does NOT check the list's token map. Membership data lives on the list record, so it never gets pushed.

The fix: **create and immediately delete a temporary reminder**. This forces `remindd` to update `reminderIDsMergeableOrdering` on the list record, triggering a full list-level push that includes membership data.

```swift
let temp = EKReminder(eventStore: store)
temp.title = "_sync_trigger"
temp.calendar = calendar
try store.save(temp, commit: true)
Thread.sleep(forTimeInterval: 0.3)
try store.remove(temp, commit: true)
```

---

## Section Membership Sync — The Full Flow

Assigning a reminder to a section requires writing to three SQLite columns in one atomic transaction, then triggering sync:

1. **Write membership JSON** to `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA`
2. **Write SHA-512 checksum** to `ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM`
3. **Increment counter** in `ZRESOLUTIONTOKENMAP_V3_JSONDATA` (inside `map`, with `replicaID`)
4. **Close the database connection** (critical for WAL checkpoint)
5. **Wait 0.5s** for checkpoint to complete
6. **Create + delete a temp reminder** via EventKit to trigger list-level push

If any step is missing, the change stays local and never reaches other devices.

### Membership JSON format

```json
{
  "minimumSupportedVersion": 20230430,
  "memberships": [
    {
      "memberID": "A1B2C3D4-E5F6-7182-93A4-B5C6D7E8F9A0",
      "groupID": "B2C3D4E5-F6A7-8192-93A4-B5C6D7E8F9A0",
      "modifiedOn": 796647639.739
    }
  ]
}
```

- `memberID` = reminder UUID (dashed format, from `hex(ZIDENTIFIER)`)
- `groupID` = section UUID (dashed format)
- `modifiedOn` = Core Data timestamp (seconds since 2001-01-01, NOT Unix epoch)
- `minimumSupportedVersion` = always `20230430`

---

## Things That Bit Us

### Recurrence rules must be added before first save

```swift
reminder.addRecurrenceRule(rule)  // MUST be before save()
try store.save(reminder, commit: true)
```

Adding a recurrence rule after `save()` silently fails — the rule doesn't persist.

### Date-only reminders must not include time components

```swift
var dueDate = DateComponents()
dueDate.year = 2026; dueDate.month = 4; dueDate.day = 5
// Do NOT set hour, minute, second — that creates a datetime reminder
reminder.dueDateComponents = dueDate
```

Setting `hour: 0, minute: 0` creates a datetime reminder showing "00:00", not a date-only reminder.

### Core Data timestamps are not Unix timestamps

```
Core Data epoch: 2001-01-01 00:00:00 UTC
Conversion: coreDataTimestamp = (unixMs / 1000) - 978307200
```

### Z_ENT values are not stable

Entity type IDs in the `Z_PRIMARYKEY` table change between database versions. Never hardcode them — always query dynamically.

### UUID format mismatch

SQLite stores UUIDs as hex blobs (32 chars, no hyphens). EventKit and membership JSON use dashed format (8-4-4-4-12). Convert with:

```
hex: 86FE3D65DAEB434A83D8B488DF6F1E9C
dashed: 86FE3D65-DAEB-434A-83D8-B488DF6F1E9C
```

### iOS doesn't always discover new lists immediately

Newly created lists may not appear on iOS until the user force-closes and reopens Reminders, or toggles iCloud Reminders off/on in Settings. This is an iOS caching behaviour, not a sync failure — the list IS in CloudKit (verifiable via iCloud.com).

---

## Permissions (macOS TCC)

macOS TCC (Transparency, Consent, and Control) always attributes permissions to the **terminal app** (Terminal, iTerm, Cursor, etc.), not to the child binary. Even with an embedded `Info.plist` and code signing, a CLI tool inherits its parent's TCC context.

| Permission | What needs it | Granted to |
|-----------|--------------|-----------|
| Reminders access | All EventKit operations | Terminal app |
| Full Disk Access | SQLite reads in `~/Library/Group Containers/` | Terminal app |

The `NSRemindersUsageDescription` in the binary's Info.plist provides the dialog text but the grant goes to the terminal. There is no way to make a CLI tool get its own TCC entry for filesystem access.

---

## What Doesn't Work

| Approach | Why it fails |
|----------|-------------|
| Direct SQLite INSERT for sections | Bypasses Core Data; never syncs |
| Setting `ZCKDIRTYFLAGS` manually | Race conditions with remindd's state machine |
| Clearing `ZCKSERVERRECORDDATA` | Destroys CloudKit ETags; causes duplicates |
| Editing reminder notes as sync trigger | Only triggers reminder-level push, not list-level |
| Token map entries at JSON top level | remindd expects them inside `"map"` key |
| Token map entries without `replicaID` | Silently ignored by sync engine |
| `addRecurrenceRule()` after `save()` | Rule doesn't persist |
| AppleScript for section access | Scripting dictionary doesn't expose sections |
| `.app` bundle for CLI permissions | Child process inherits parent's TCC context |

---

## What Does Work

| Approach | For what |
|----------|---------|
| EventKit for all reminder CRUD | Creates, reads, updates, deletes, recurrence |
| ReminderKit (`REMSaveRequest`) for section CRUD | Create/delete sections with CloudKit sync |
| SQLite + token map for membership | Assign reminders to sections |
| Temp reminder create/delete for sync trigger | Forces list-level CloudKit push |
| Atomic SQLite transaction for membership writes | Prevents remindd detecting data corruption |
| `better-sqlite3` / sqlite3 C API with WAL mode | Safe concurrent access with remindd |
| AppleScript for background verification | Read reminders without UI interruption |

---

## Database Location

```
~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores/*.sqlite
```

Multiple `.sqlite` files may exist. Scan all, use the one with data in `ZREMCDREMINDER`. Always filter `WHERE ZMARKEDFORDELETION = 0`.

---

## Why remi Exists

Several Apple Reminders CLIs exist, but none support sections:

| Tool | Language | Sections | Section Sync | Agent-Friendly |
|------|----------|----------|-------------|----------------|
| [remindctl](https://github.com/steipete/remindctl) | Swift | No | N/A | Partial |
| [rem](https://github.com/BRO3886/rem) | Go | No | N/A | No |
| [reminders-cli](https://github.com/keith/reminders-cli) | Swift | No | N/A | No |
| **remi** | TypeScript/Swift | **Yes** | **Yes** | **Yes** |

They all use EventKit only. EventKit has zero section support — Apple never exposed it. The only ways to work with sections are:

1. **ReminderKit** (private framework) — for section CRUD
2. **Direct SQLite + CRDT token maps** — for section membership

Both are undocumented, unsupported, and may break with any macOS update. But they're the only way to build a complete Reminders CLI that includes the organizational features people actually use.

remi wraps all of this complexity behind a simple CLI:

```bash
remi create-section "Groceries" "Produce"
remi add "Groceries" "Bananas" --section "Produce"
remi move "Groceries" "Bananas" --to-section "Dairy"
```

Three commands. Underneath: EventKit, ReminderKit, SQLite, SHA-512 checksums, CRDT vector clocks, WAL checkpointing, and temporary reminder sync triggers. All syncing to every Apple device via iCloud.
