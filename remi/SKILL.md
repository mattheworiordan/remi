---
name: remi
description: Manage Apple Reminders via CLI with section support and iCloud sync. Use when the user asks to create, list, complete, search, or organize reminders.
metadata: {"openclaw": {"requires": {"bins": ["remi"]}, "install": {"brew": "mattheworiordan/tap/remi", "node": "@mattheworiordan/remi"}}}
---

# remi — Apple Reminders CLI

All commands support `--json` for structured output. Requires macOS 13+ with Reminders access.

## How to invoke

Run `remi` as a CLI command via Bash. If `remi` is not on PATH, use `npx @mattheworiordan/remi` instead. Always use `--json` when calling programmatically.

## Commands

```bash
# Lists
remi lists                                          # All lists
remi list "<name>"                                  # Reminders in a list
remi list "<name>" --include-completed
remi create-list "<name>"
remi delete-list "<name>" --confirm

# Reminders
remi add "<list>" "<title>"                         # Simple add
remi add "<list>" "<title>" --section "<s>" --due 2026-04-15 --priority high --notes "..."
remi complete "<list>" "<title>"
remi delete "<list>" "<title>" --confirm
remi update "<list>" "<title>" --due 2026-05-01 --priority medium

# Sections
remi sections "<list>"                              # List sections
remi create-section "<list>" "<name>"               # Idempotent
remi delete-section "<list>" "<name>"
remi move "<list>" "<title>" --to-section "<name>"  # Assign to section

# Queries
remi today
remi overdue
remi upcoming --days 7
remi search "<query>"

# Diagnostics
remi doctor
```

## JSON mode

Use `--json` for programmatic access. Returns `{"success": true, "data": ...}` or `{"success": false, "error": {"code": "...", "message": "...", "suggestion": "..."}}`.

## Key behaviors

- **Idempotent** — creating an existing section returns success
- **Title matching** — case-insensitive; use `--id <prefix>` if ambiguous
- **Sections sync to iCloud** — changes appear on all Apple devices
- **`--confirm` required** for delete operations in interactive mode (not needed with `--json`)
