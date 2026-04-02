# remi

**The missing CLI for Apple Reminders — with section support and iCloud sync.**

remi is the only Apple Reminders CLI that supports **sections** (the organizational unit Apple added in macOS 13) with full **iCloud sync**. Create lists, add reminders, organize them into sections, and have everything sync across all your Apple devices.

## Install

```bash
# Homebrew (recommended)
brew tap mattheworiordan/remi
brew install remi

# npm
npm install -g @mattheworiordan/remi

# Or run without installing
npx @mattheworiordan/remi lists
```

## Quick start

```bash
# See all your lists
remi lists

# View reminders in a list
remi list "Groceries"

# Add a reminder
remi add "Groceries" "Buy milk"

# Add with section, due date, and priority
remi add "Groceries" "Fresh basil" --section "Produce" --due "next tuesday" --priority high

# Add a recurring reminder
remi add "Dogs" "Flea treatment" --due 2026-04-28 --repeat monthly

# What's due today?
remi today

# What's overdue?
remi overdue
```

## Commands

### Queries — what's due?

```bash
remi today                   # Due today
remi overdue                 # Past due
remi upcoming --days 7       # Due in the next 7 days
```

### Browse

```bash
remi list "Groceries"                   # Show reminders in a list
remi list "Groceries" --include-completed
remi lists                              # List all reminder lists
remi search "milk"                      # Search across all lists
```

### Task actions

```bash
remi add "Work" "Review report" --due "next friday" --priority high --notes "Q1 numbers"
remi add "Work" "Team standup" --due tomorrow --repeat daily
remi add "Work" "Sprint review" --repeat "every 2 weeks"
remi complete "Work" "Review report"
remi update "Work" "Review report" --due "in 3 days"
remi delete "Work" "Review report" --confirm
```

Dates accept YYYY-MM-DD or natural language: `tomorrow`, `next tuesday`, `in 3 days`.

Recurrence supports: `daily`, `weekly`, `monthly`, `yearly`, `every N days/weeks/months`, `every 2 weeks on monday,friday`.

### Sections

This is what makes remi unique. No other CLI supports Apple Reminders sections with iCloud sync.

```bash
remi sections "Groceries"                          # List sections
remi move "Groceries" "Bananas" --to-section "Dairy" # Move between sections
remi create-section "Groceries" "Produce"          # Create a section
remi add "Groceries" "Bananas" --section "Produce" # Add to a section
remi delete-section "Groceries" "Produce"          # Delete a section
```

Sections sync to iCloud via resolution token maps (CRDT-style vector clocks). See the [technical design](docs/TECHNICAL_DESIGN.md) for details.

### List management

```bash
remi create-list "Home Projects"
remi delete-list "Home Projects" --confirm
```

### System

```bash
remi doctor          # Check system health
remi doctor --db     # Show database stats
```

### Shell completions

Homebrew installs completions automatically. For manual setup:

```bash
# zsh (uses Homebrew's completions dir if available, otherwise system dir)
remi completions zsh > $(brew --prefix 2>/dev/null || echo /usr/local)/share/zsh/site-functions/_remi

# bash
remi completions bash > /usr/local/etc/bash_completion.d/remi

# fish
remi completions fish > ~/.config/fish/completions/remi.fish
```

## JSON output

Every command supports `--json` for machine-readable output:

```bash
remi lists --json
remi today --json
remi add "Work" "Task" --json
```

Returns `{"success": true, "data": ...}` on success or `{"success": false, "error": {"code": "...", "message": "...", "suggestion": "..."}}` on failure.

## AI agent integration

remi is designed for AI agents. Install as a [Claude Code plugin](https://github.com/mattheworiordan/remi):

```bash
claude plugin marketplace add mattheworiordan/remi
claude plugin install remi
```

Or use as a [skill](https://skills.sh):

```bash
npx skills add mattheworiordan/remi
```

Then agents can manage reminders via `/remi` or by using the CLI directly with `--json`.

## Permissions

macOS grants permissions to your **terminal app** (Terminal, iTerm, Cursor, VS Code, etc.), not to remi directly. You only need to do this once per terminal app.

```bash
remi authorize    # Guides you through granting permissions
remi doctor       # Shows what's granted and what's missing
```

| Permission | What it enables | How to grant |
|------------|----------------|--------------|
| **Reminders access** | All reminder operations | System dialog on first run — click Allow |
| **Full Disk Access** | Section features (create-section, move, etc.) | System Settings > Privacy & Security > Full Disk Access — add your terminal app |

Most developer terminals (iTerm, Ghostty, VS Code) already have Full Disk Access. If you only need basic reminder operations (no sections), Reminders access alone is sufficient.

## How it works

remi uses a three-layer architecture to interact with Apple Reminders:

| Layer | API | Used for |
|-------|-----|----------|
| 1 | **EventKit** (public) | Standard CRUD — lists, reminders, queries |
| 2 | **ReminderKit** (private framework) | Section CRUD — create, list, delete sections |
| 3 | **SQLite + Resolution Token Maps** | Section membership sync via CRDT vector clocks |

The key innovation is Layer 3: directly writing to the Reminders SQLite database with proper resolution token map updates so that `remindd` (Apple's sync daemon) pushes section membership changes to CloudKit. This is the only known way to assign reminders to sections and have it sync across devices.

See [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) for the full reverse-engineering story.

## Requirements

- macOS 13+ (Ventura or later)
- Node.js 18+
- Xcode Command Line Tools (`xcode-select --install`)
- Apple Reminders access (granted on first use)

## Development

```bash
git clone https://github.com/mattheworiordan/remi.git
cd remi
npm install
npm run build:swift    # Compile the section-helper binary
npm run build          # Compile TypeScript
npm run dev -- lists   # Run in dev mode
npm test               # Run unit tests
```

## License

MIT

## Author

[Matthew O'Riordan](https://github.com/mattheworiordan)
