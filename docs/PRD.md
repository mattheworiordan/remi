# remi - Product Requirements Document

## Vision

**remi** is a fast, reliable command-line interface for Apple Reminders with first-class support for sections, iCloud sync, and AI agent integration. It is the CLI that Apple should have built.

## Why remi Exists

### The Problem

Apple Reminders is a powerful, free task management system with seamless iCloud sync across all Apple devices. But it has no command-line interface. Developers, power users, and AI agents cannot programmatically create, organize, or query reminders without building custom integrations from scratch.

The few existing CLI tools are incomplete. None support **sections** (the organizational unit Apple added in macOS 13), and none handle the critical challenge of making section membership changes sync reliably via iCloud.

### Backstory

remi was born from the [matt-os](https://github.com/mattheworiordan/matt-os) project - a personal operating system for knowledge management and AI-assisted workflows built around Obsidian. The matt-os project needed deep Apple Reminders integration: creating lists with sections, organizing tasks into categories, and having those changes sync across all devices.

Through extensive reverse-engineering of Apple's Reminders database and sync architecture, we discovered how to make section operations work with iCloud sync. This involved understanding remindd's custom CloudKit sync engine, CRDT-style vector clocks via resolution token maps, and the interplay between EventKit, ReminderKit (private framework), and direct SQLite access.

This knowledge is too valuable to keep locked in a personal project. **remi** extracts and productizes it as a standalone open-source tool.

### Competitive Landscape

| Tool | Language | Stars | Sections | iCloud Sync | Section Membership Sync | Agent-Friendly |
|------|----------|-------|----------|-------------|------------------------|----------------|
| [remindctl](https://github.com/steipete/remindctl) | Swift | 181 | No | Via EventKit | N/A | Partial |
| [rem](https://github.com/BRO3886/rem) | Go | - | No | Via EventKit | N/A | No |
| [reminders-cli](https://github.com/keith/reminders-cli) | Swift | - | No | Via EventKit | N/A | No |
| **remi** | TypeScript/Swift | - | **Yes** | **Yes** | **Yes (token maps)** | **Yes** |

**remi's unique value proposition**: Full section support with iCloud sync via resolution token maps. No other tool can create sections, assign reminders to sections, and have those changes propagate across all Apple devices.

## Target Users

1. **AI Agents** - Claude, ChatGPT, and other LLMs that need to manage tasks through MCP or CLI
2. **Developers** - Power users who live in the terminal and want fast task management
3. **Automation Builders** - Users creating workflows with shell scripts, cron jobs, or Shortcuts
4. **matt-os Users** - Anyone using the matt-os personal operating system

## Design Principles

### 1. Agent-First

Every command produces structured JSON output by default. Error messages include actionable context. Commands are composable and predictable.

```bash
# Machine-readable by default
remi list "Groceries" --json

# Human-readable when interactive
remi list "Groceries"
```

### 2. Progressive Disclosure

Simple things are simple. Complex things are possible.

```bash
# Simple: add a reminder
remi add "Groceries" "Buy milk"

# With section
remi add "Groceries" "Buy milk" --section "Dairy"

# With everything
remi add "Groceries" "Buy milk" --section "Dairy" --due "tomorrow 9am" --priority high --notes "Organic only"
```

### 3. Sync-Aware

Every write operation considers iCloud sync implications. The tool never silently fails to sync - it either confirms sync was triggered or warns that manual sync may be needed.

### 4. Defensive

Apple's Reminders internals are undocumented and may change with any macOS update. remi uses a three-layer approach (EventKit -> ReminderKit -> SQLite+TokenMap) with graceful degradation and clear error messages when a layer breaks.

## Command Reference

### List Management

```bash
# List all reminder lists
remi lists

# Show contents of a list
remi list "Groceries"
remi list "Groceries" --include-completed
remi list "Groceries" --section "Produce"

# Create a new list
remi create-list "Home Projects"

# Delete a list
remi delete-list "Home Projects" --confirm
```

### Reminder Operations

```bash
# Add a reminder
remi add "Groceries" "Fresh basil"
remi add "Groceries" "Fresh basil" --section "Produce"
remi add "Groceries" "Fresh basil" --section "Produce" --due "2024-03-15" --priority high
remi add "Work" "Review quarterly report" --due "tomorrow 2pm" --notes "Check revenue numbers"

# Complete a reminder
remi complete "Groceries" "Fresh basil"
remi complete "Groceries" --id "x-apple-reminder://..."

# Delete a reminder
remi delete "Groceries" "Fresh basil"

# Update a reminder
remi update "Groceries" "Fresh basil" --due "next monday" --priority medium
```

### Section Operations

```bash
# List sections in a list
remi sections "Groceries"
# Output: Produce, Dairy, Frozen

# Create a section
remi create-section "Groceries" "Bakery"

# Delete a section
remi delete-section "Groceries" "Bakery"

# Move a reminder to a section
remi move "Groceries" "Fresh basil" --to-section "Produce"
```

### Query and Search

```bash
# Search across all lists
remi search "basil"

# Show reminders due today
remi today

# Show reminders due this week
remi upcoming --days 7

# Show overdue reminders
remi overdue
```

### Diagnostics

```bash
# Check system health
remi doctor

# Verify sync status
remi doctor --sync

# Show database location and stats
remi doctor --db
```

## Architecture

### Three-Layer API Strategy

remi uses a three-layer approach to interact with Apple Reminders, choosing the most appropriate layer for each operation:

```
Layer 1: EventKit (Public API)
├── Standard CRUD for reminders
├── List creation/deletion
├── Reliable, Apple-supported
└── Cannot access sections

Layer 2: ReminderKit (Private Framework)
├── Section CRUD (create, list, delete)
├── Goes through Core Data properly
├── Triggers CloudKit sync automatically
└── May break with macOS updates

Layer 3: SQLite + Resolution Token Map
├── Section membership (assign reminders to sections)
├── Direct database writes with checksum computation
├── Resolution token map counter increment for sync
├── EventKit sync trigger (trailing space toggle)
└── Most fragile but only way to sync memberships
```

### Why Three Layers?

- **EventKit** is the stable foundation. It handles 80% of operations reliably.
- **ReminderKit** is needed because Apple never exposed sections in EventKit. It is a private framework, so it may break, but section CRUD through it triggers proper CloudKit sync.
- **SQLite + Token Map** is the breakthrough discovery. Setting section memberships requires writing directly to the Reminders database and then manipulating the resolution token map (CRDT-style vector clocks) so remindd's sync engine knows to push the change to CloudKit.

### Sync Architecture Detail

Apple's remindd daemon uses a custom CloudKit sync engine (not NSPersistentCloudKitContainer). It implements CRDT-style vector clocks for field-level conflict resolution via "resolution token maps."

Each syncable field has an entry in `ZRESOLUTIONTOKENMAP_V3_JSONDATA` with:
- `counter`: Incremented when a field changes locally
- `modificationTime`: Core Data timestamp of the change

For section memberships specifically:
1. Write membership JSON to `ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA`
2. Compute SHA-512 checksum, write to `ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM`
3. Increment the counter for `membershipsOfRemindersInSectionsChecksum` in the resolution token map
4. Trigger a sync cycle by editing a reminder via EventKit (toggling trailing space on notes)

This makes remindd notice local changes and initiate a CloudKit push that includes the membership data.

## Agent Integration

### MCP Server (v1.2+)

remi will ship as an MCP server, allowing AI agents to manage reminders directly:

```json
{
  "tools": [
    {"name": "remi_add", "description": "Add a reminder to a list"},
    {"name": "remi_list", "description": "List reminders, optionally filtered by section"},
    {"name": "remi_complete", "description": "Mark a reminder as complete"},
    {"name": "remi_sections", "description": "List or manage sections"},
    {"name": "remi_search", "description": "Search reminders across all lists"},
    {"name": "remi_today", "description": "Show reminders due today"}
  ]
}
```

### CLI for Scripting

```bash
# Agent creates a structured grocery list
remi create-section "Groceries" "Produce"
remi create-section "Groceries" "Dairy"
remi create-section "Groceries" "Frozen"
remi add "Groceries" "Bananas" --section "Produce"
remi add "Groceries" "Greek yogurt" --section "Dairy"
remi add "Groceries" "Ice cream" --section "Frozen"

# Agent organizes home projects
remi create-section "Home Projects" "Kitchen"
remi create-section "Home Projects" "Garden"
remi create-section "Home Projects" "Electrical"
remi add "Home Projects" "Fix leaky faucet" --section "Kitchen"
remi add "Home Projects" "Plant tomatoes" --section "Garden"
remi add "Home Projects" "Replace hallway light" --section "Electrical"
```

## Distribution Strategy

### Homebrew (Primary)

```bash
brew tap mattheworiordan/remi
brew install remi
```

### npm (Secondary)

```bash
npm install -g @mattheworiordan/remi
# or
npx @mattheworiordan/remi add "Groceries" "Buy milk"
```

### GitHub Releases

Pre-built binaries for macOS (arm64 and x86_64) attached to GitHub releases.

## Logo Concept

A friendly terminal prompt character interacting with Apple's checkmark-in-circle Reminders icon. Clean, minimal, works at small sizes. Color palette: Apple Reminders blue (#007AFF) with terminal green (#00FF41) accent.

The name "remi" is lowercase, friendly, and short - easy to type in a terminal. It evokes "remind me" in a casual, approachable way.

## Roadmap

### v1.0 - Foundation

- [ ] Core CLI with all CRUD operations
- [ ] Section support (create, list, delete, move reminders)
- [ ] iCloud sync for all operations including section memberships
- [ ] `remi doctor` - system health and diagnostics
- [ ] JSON output for all commands
- [ ] Human-readable table output for interactive use
- [ ] Homebrew distribution
- [ ] Comprehensive error messages with fix suggestions
- [ ] Full test suite

### v1.1 - Power Features

- [ ] Subtask support (create, list, manage hierarchical reminders)
- [ ] Batch operations (`remi add "Groceries" --batch < items.txt`)
- [ ] `--sync-wait` flag: block until iCloud sync confirms propagation
- [ ] Natural language date parsing ("next tuesday", "in 3 days")
- [ ] Recurrence rules (`--repeat daily`, `--repeat "every 2 weeks"`)
- [ ] Tags/hashtag support
- [ ] Shell completions (bash, zsh, fish)

### v1.2 - MCP Integration

- [ ] MCP server mode (`remi --mcp`)
- [ ] Tool definitions for all remi operations
- [ ] Streaming progress for long operations
- [ ] npm distribution
- [ ] Integration examples for Claude Desktop, ChatGPT, etc.

### v1.3 - Polish

- [ ] Interactive TUI mode (`remi --interactive`)
- [ ] Bulk import/export (JSON, CSV, Todoist format)
- [ ] Reminder templates
- [ ] Statistics and analytics
- [ ] Migration tools from other task managers

## Success Metrics

- **GitHub Stars**: 500+ within 6 months (section support is a strong differentiator)
- **Homebrew Downloads**: 1,000+ monthly installs
- **Reliability**: <1% failure rate on supported macOS versions
- **Sync Success**: >99% of section membership changes sync within 30 seconds
- **Agent Adoption**: Used by 3+ MCP-enabled AI tools

## Open Source Model

- **License**: MIT
- **Contributions**: Welcome, with CLA for significant changes
- **Governance**: Benevolent dictator (maintainer-driven)
- **Breaking Changes**: Semver, with deprecation warnings for at least one minor version
- **Security**: Responsible disclosure process for any Reminders database vulnerabilities

### What We Open Source

- All CLI code and Swift helpers
- The resolution token map sync technique (the key innovation)
- Test suite and CI configuration
- Documentation and examples

### What We Keep Private

- Nothing. This is fully open source. The entire value is in the implementation and documentation of techniques that took significant reverse-engineering effort to discover.

## References

- [Apple EventKit Documentation](https://developer.apple.com/documentation/eventkit)
- [CloudKit Documentation](https://developer.apple.com/documentation/cloudkit)
- [matt-os Project](https://github.com/mattheworiordan/matt-os) - Origin project
- [remindctl by steipete](https://github.com/steipete/remindctl) - Existing Swift CLI (no sections)
- [rem by BRO3886](https://github.com/BRO3886/rem) - Existing Go CLI
- [reminders-cli by keith](https://github.com/keith/reminders-cli) - Existing Swift CLI
- Apple Reminders SQLite schema: `~/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores/`
