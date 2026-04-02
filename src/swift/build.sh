#!/bin/bash
# Build Swift helpers for remi
# Compiles both helpers into binaries with embedded Info.plist
# (provides NSRemindersUsageDescription for the permission dialog)
# This requires macOS 13+ and Xcode Command Line Tools.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/../../dist"
INFO_PLIST="$SCRIPT_DIR/Info.plist"

mkdir -p "$OUTPUT_DIR"

# -- reminders-helper (EventKit operations) --
if [ ! -f "$OUTPUT_DIR/reminders-helper" ] || [ "$SCRIPT_DIR/reminders-helper.swift" -nt "$OUTPUT_DIR/reminders-helper" ]; then
    echo "Compiling reminders-helper..."
    swiftc \
        -framework Foundation \
        -framework EventKit \
        -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$INFO_PLIST" \
        -O \
        -o "$OUTPUT_DIR/reminders-helper" \
        "$SCRIPT_DIR/reminders-helper.swift"
    codesign -s - -f "$OUTPUT_DIR/reminders-helper" 2>/dev/null || true
    echo "reminders-helper compiled successfully"
else
    echo "reminders-helper is up to date"
fi

# -- section-helper (ReminderKit + SQLite database access) --
if [ ! -f "$OUTPUT_DIR/section-helper" ] || [ "$SCRIPT_DIR/section-helper.swift" -nt "$OUTPUT_DIR/section-helper" ]; then
    echo "Compiling section-helper..."
    swiftc \
        -framework Foundation \
        -framework EventKit \
        -F /System/Library/PrivateFrameworks \
        -framework ReminderKit \
        -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$INFO_PLIST" \
        -O \
        -o "$OUTPUT_DIR/section-helper" \
        "$SCRIPT_DIR/section-helper.swift"
    codesign -s - -f "$OUTPUT_DIR/section-helper" 2>/dev/null || true
    echo "section-helper compiled successfully"
else
    echo "section-helper is up to date"
fi
