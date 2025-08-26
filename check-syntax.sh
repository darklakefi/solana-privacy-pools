#!/bin/bash
# Simple syntax check for Rust files
echo "Checking Rust syntax..."

# Check if any Rust files have basic syntax errors
for file in src/**/*.rs src/*.rs; do
    if [ -f "$file" ]; then
        # Basic bracket matching
        open_braces=$(grep -o '{' "$file" | wc -l)
        close_braces=$(grep -o '}' "$file" | wc -l)
        if [ "$open_braces" != "$close_braces" ]; then
            echo "⚠ Potential bracket mismatch in $file"
        fi
    fi
done

echo "Basic syntax check complete."
echo ""
echo "Note: This is a basic check. For full compilation:"
echo "1. Exit Cursor IDE terminal"
echo "2. Run: cargo build-sbf"
echo ""
echo "The program at target/deploy/solana_privacy_pools.so is from the last successful build."