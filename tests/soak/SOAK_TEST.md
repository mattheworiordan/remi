# remi Soak Test — Sync Verification

An automated test that verifies remi operations sync correctly. Runs entirely in the background — no mouse control or foreground takeover.

**Run**: Give this prompt to any coding agent (Claude Code, Cursor, etc.) with Bash and Playwright/browser access.

```bash
npm run test:soak   # Prints instructions
```

---

## Prompt (copy everything below to your agent)

---

You are running a soak test for the `remi` CLI. This test creates reminders via the CLI and verifies they sync correctly using three methods:

1. **CLI readback** — verify via remi commands
2. **AppleScript** — verify in macOS Reminders.app (runs in background, no UI interruption)
3. **iCloud.com** — verify in browser via Playwright (headless, no UI interruption)
4. **Human check** (optional) — ask user to verify on their phone for section sync

### Prerequisites

Run via Bash:

```bash
remi doctor
```

All checks must pass (warnings about database access are OK for non-section tests). If Reminders access fails, run `remi authorize` first.

Generate a unique test ID:
```bash
TEST_ID=$(openssl rand -hex 3)
echo "Soak test ID: $TEST_ID"
```

Use `_soak_${TEST_ID}` as the list name for all operations.

---

### Phase 1: Create test data via CLI

```bash
TEST_LIST="_soak_${TEST_ID}"

remi create-list "$TEST_LIST" --json
remi create-section "$TEST_LIST" "Urgent" --json
remi create-section "$TEST_LIST" "Later" --json
remi add "$TEST_LIST" "Soak: Buy groceries" --section "Urgent" --due tomorrow --priority high --json
remi add "$TEST_LIST" "Soak: Call dentist" --section "Later" --due "in 3 days" --json
remi add "$TEST_LIST" "Soak: Weekly review" --due "next monday" --repeat weekly --json
remi add "$TEST_LIST" "Soak: No date task" --json
```

Verify via CLI:
```bash
remi list "$TEST_LIST" --json
remi sections "$TEST_LIST" --json
```

Expected: 4 reminders, 2 sections. If any command fails, report the error and continue.

---

### Phase 2: Verify via AppleScript (background, no UI interruption)

Wait 5 seconds for Reminders.app to pick up changes, then run:

```bash
osascript -e 'tell application "Reminders" to name of every reminder in list "'"$TEST_LIST"'" whose completed is false'
```

Expected output should contain all 4 reminder titles. Check each:
- "Soak: Buy groceries" — present?
- "Soak: Call dentist" — present?
- "Soak: Weekly review" — present?
- "Soak: No date task" — present?

Also verify the list exists:
```bash
osascript -e 'tell application "Reminders" to name of every list'
```

---

### Phase 3: Verify via iCloud.com (headless browser, no UI interruption)

Wait 15 seconds for iCloud sync, then use Playwright to:

1. Navigate to `https://www.icloud.com/reminders/`
2. If not signed in, ask the user to sign in and confirm, then retry
3. Find the test list in the sidebar and click on it
4. Verify these reminders appear:
   - "Soak: Buy groceries" with high priority and a due date
   - "Soak: Call dentist" with a due date
   - "Soak: Weekly review" with a recurrence indicator (e.g. "Weekly")
   - "Soak: No date task"

Note: iCloud.com does not display sections — this is expected.

---

### Phase 4: Test modifications

```bash
remi complete "$TEST_LIST" "Soak: Buy groceries" --json
remi move "$TEST_LIST" "Soak: No date task" --to-section "Urgent" --json
```

Wait 10 seconds, then verify via AppleScript:
```bash
osascript -e 'tell application "Reminders" to name of every reminder in list "'"$TEST_LIST"'" whose completed is false'
```

Expected: 3 reminders (Buy groceries should be gone).

Verify completion synced to iCloud.com: navigate to the test list and confirm "Buy groceries" is no longer in the incomplete view.

---

### Phase 5: Human verification (optional — for section sync)

Ask the user:

> **Optional cross-device check**: Some features like sections can only be verified on a real device. Would you like to check on your phone, or skip this step?
>
> If yes, please check:
> 1. Open Reminders on your iPhone/iPad
> 2. Find the list "_soak_[TEST_ID]"
> 3. Confirm you see sections "Urgent" and "Later"
> 4. Confirm "Soak: Call dentist" is under "Later"
> 5. Confirm "Soak: No date task" moved to "Urgent"
>
> Reply with what you see, or "skip" to continue.

If the user skips, record the result as SKIPPED (not FAIL).

---

### Phase 6: Cleanup

```bash
remi delete-list "$TEST_LIST" --confirm --json
```

Verify cleanup via AppleScript:
```bash
osascript -e 'tell application "Reminders" to name of every list' | grep -c "$TEST_LIST"
```

Expected: 0 (list gone).

---

### Report

```
REMI SOAK TEST RESULTS (test ID: <TEST_ID>)
============================================

Phase 1: CLI Operations
  Create list:              PASS / FAIL
  Create sections:          PASS / FAIL
  Add reminders:            PASS / FAIL (X/4)
  CLI readback:             PASS / FAIL

Phase 2: macOS Reminders (AppleScript)
  List exists:              PASS / FAIL
  Reminders visible:        PASS / FAIL (X/4)

Phase 3: iCloud Sync (Browser)
  List visible:             PASS / FAIL
  Reminders synced:         PASS / FAIL (X/4)
  Priority correct:         PASS / FAIL
  Recurrence correct:       PASS / FAIL

Phase 4: Modifications
  Complete synced (local):  PASS / FAIL
  Complete synced (iCloud): PASS / FAIL
  Move to section:          PASS / FAIL

Phase 5: Cross-Device (Human)
  Device sync:              PASS / FAIL / SKIPPED
  Sections visible:         PASS / FAIL / SKIPPED

Phase 6: Cleanup
  List deleted:             PASS / FAIL

Overall: PASS / FAIL
Sync latency: ~Xs average
Notes: [observations]
```

If any step fails, do NOT stop — continue through all phases and report everything.
