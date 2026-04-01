#!/bin/bash
# Build the section-helper Swift binary for ReminderKit access
# This requires macOS 13+ and Xcode Command Line Tools

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/../../dist"

mkdir -p "$OUTPUT_DIR"

# Only compile if source is newer than binary (or binary doesn't exist)
if [ ! -f "$OUTPUT_DIR/section-helper" ] || [ "$SCRIPT_DIR/section-helper.swift" -nt "$OUTPUT_DIR/section-helper" ]; then
    echo "Compiling section-helper..."
    swiftc \
        -framework Foundation \
        -framework EventKit \
        -F /System/Library/PrivateFrameworks \
        -framework ReminderKit \
        -O \
        -o "$OUTPUT_DIR/section-helper" \
        "$SCRIPT_DIR/section-helper.swift"
    echo "section-helper compiled successfully"
else
    echo "section-helper is up to date"
fi
