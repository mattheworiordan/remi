# remi Soak Tests — Sync Verification

Two soak tests that verify remi operations sync correctly across devices.

## Test 1: iCloud Browser Test (automated)

Tests sync to iCloud by creating reminders via CLI and verifying them at icloud.com/reminders in a browser. Covers everything except sections (not supported in iCloud web UI).

**Run**: Give this prompt to an agent with browser automation (Playwright MCP or browser-automation skill).

---

### Prompt: iCloud Sync Test

You are running an automated sync test for the `remi` CLI. You will create reminders via the CLI, wait for iCloud sync, then verify they appear at icloud.com/reminders.

**Prerequisites:**
1. Run `remi doctor` via Bash — all checks must pass.
2. Generate a unique test ID: 6 random hex characters (e.g., `a3f2b1`). Use this for all test names.

**Phase 1: Create test data via CLI**

```bash
TEST_ID=$(openssl rand -hex 3)
TEST_LIST="_soak_${TEST_ID}"

remi create-list "$TEST_LIST" --json
remi add "$TEST_LIST" "Soak: Buy groceries" --due tomorrow --priority high --json
remi add "$TEST_LIST" "Soak: Call dentist" --due "in 3 days" --json
remi add "$TEST_LIST" "Soak: Weekly review" --due "next monday" --repeat weekly --json
remi add "$TEST_LIST" "Soak: No date task" --json
```

Verify via CLI readback:
```bash
remi list "$TEST_LIST" --json
```
Expected: 4 reminders.

**Phase 2: Wait for sync**

Wait 15 seconds for iCloud sync.

**Phase 3: Verify in iCloud.com**

1. Navigate to https://www.icloud.com/reminders/ in the browser
2. If not logged in, ask the user to log in and confirm
3. Find the test list (`_soak_<TEST_ID>`) in the sidebar
4. Click on it
5. Verify these reminders exist:
   - "Soak: Buy groceries" with a due date and high priority
   - "Soak: Call dentist" with a due date
   - "Soak: Weekly review" with a recurrence indicator
   - "Soak: No date task"
6. Take a screenshot for evidence

**Phase 4: Test completion sync**

```bash
remi complete "$TEST_LIST" "Soak: Buy groceries" --json
```

Wait 10 seconds. Refresh iCloud.com. Verify "Buy groceries" is now marked complete or hidden from the incomplete view.

**Phase 5: Test deletion sync**

```bash
remi delete "$TEST_LIST" "Soak: No date task" --confirm --json
```

Wait 10 seconds. Refresh iCloud.com. Verify "No date task" is gone.

**Phase 6: Cleanup**

```bash
remi delete-list "$TEST_LIST" --confirm --json
```

Wait 10 seconds. Verify the list is gone from iCloud.com.

**Report:**

```
iCLOUD SYNC TEST RESULTS (test ID: <TEST_ID>)
==============================================
CLI create list:       PASS / FAIL
CLI add reminders:     PASS / FAIL
CLI readback:          PASS / FAIL
iCloud list visible:   PASS / FAIL
iCloud reminders:      PASS / FAIL (items: X/4)
Complete sync:         PASS / FAIL
Delete sync:           PASS / FAIL
Cleanup:               PASS / FAIL

Overall: PASS / FAIL
Notes: [sync timing, missing items, etc.]
```

---

## Test 2: iPhone + macOS Soak Test (sections focus)

Tests section operations and cross-device sync via macOS Reminders.app and iPhone Mirroring. This is where we've seen the most issues — section membership, ordering, and sync.

**Run**: Give this prompt to an agent with computer-use MCP connected.

---

### Prompt: Section Sync Soak Test

You are running a soak test for the `remi` CLI focusing on section operations. You will create sections and assign reminders via CLI, then verify in macOS Reminders.app and iPhone Mirroring.

**Prerequisites:**

1. Run `remi doctor` via Bash — all checks must pass.
2. **Full Disk Access** required for your terminal (section features need it).
3. **Ask the user to confirm:**
   - "Please open **Reminders.app** on your Mac"
   - "Please open **iPhone Mirroring** with Reminders visible"
   - "Confirm both are ready"
4. Generate a unique test ID: `openssl rand -hex 3`. Use for all names.

**Do not proceed until the user confirms.**

**Phase 1: Create test structure via CLI**

```bash
TEST_ID=$(openssl rand -hex 3)
TEST_LIST="_soak_${TEST_ID}"

# Create list and sections
remi create-list "$TEST_LIST" --json
remi create-section "$TEST_LIST" "Urgent" --json
remi create-section "$TEST_LIST" "Later" --json
remi create-section "$TEST_LIST" "Done" --json

# Add reminders to sections
remi add "$TEST_LIST" "Soak: Fix bug" --section "Urgent" --due tomorrow --priority high --json
remi add "$TEST_LIST" "Soak: Write docs" --section "Later" --due "in 5 days" --json
remi add "$TEST_LIST" "Soak: Unsectioned item" --json

# Verify via CLI
remi sections "$TEST_LIST" --json
remi list "$TEST_LIST" --json
```

Expected: 3 sections (Urgent, Later, Done), 3 reminders.

**Phase 2: Verify on macOS Reminders.app**

Wait 10 seconds, then:

1. Take a screenshot of the desktop
2. Open Reminders.app (Spotlight or Dock)
3. Find the test list in the sidebar — click on it
4. Take a screenshot
5. Verify:
   - Sections "Urgent", "Later", "Done" visible
   - "Soak: Fix bug" under "Urgent"
   - "Soak: Write docs" under "Later"
   - "Soak: Unsectioned item" not in any section

Report what you see.

**Phase 3: Test move between sections**

```bash
remi move "$TEST_LIST" "Soak: Fix bug" --to-section "Done" --json
```

Wait 10 seconds. Take screenshot of Reminders.app. Verify "Fix bug" moved from "Urgent" to "Done".

**Phase 4: Test complete**

```bash
remi complete "$TEST_LIST" "Soak: Write docs" --json
```

Wait 10 seconds. Take screenshot. Verify "Write docs" is marked complete.

**Phase 5: Verify on iPhone Mirroring**

1. Switch to iPhone Mirroring
2. Take a screenshot
3. Navigate to Reminders app on the iPhone
4. Find the test list
5. Tap on it
6. Take a screenshot
7. Verify:
   - The list exists
   - Reminders are visible
   - Section assignments match macOS (if sections are visible on iOS)

Report what you see. Note: iPhone may not show sections in the same way as macOS.

**Phase 6: Cleanup**

```bash
remi delete-list "$TEST_LIST" --confirm --json
```

Wait 10 seconds. Verify list gone from both macOS and iPhone.

**Report:**

```
SECTION SOAK TEST RESULTS (test ID: <TEST_ID>)
===============================================
CLI create list:           PASS / FAIL
CLI create sections:       PASS / FAIL
CLI add to sections:       PASS / FAIL
CLI readback:              PASS / FAIL
macOS sections visible:    PASS / FAIL (sections: X/3)
macOS reminders placed:    PASS / FAIL (correct section: X/2)
Move between sections:     PASS / FAIL
Complete sync (macOS):     PASS / FAIL
iPhone list visible:       PASS / FAIL
iPhone reminders visible:  PASS / FAIL
Cleanup (macOS):           PASS / FAIL
Cleanup (iPhone):          PASS / FAIL

Overall: PASS / FAIL
Notes: [sync timing, section visibility on iPhone, issues]
```

If any step fails, do NOT stop — continue through all steps and report everything.
