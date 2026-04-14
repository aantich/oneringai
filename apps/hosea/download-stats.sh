#!/bin/bash
# Everworker Desktop Download Statistics
# Usage: ./download-stats.sh [version]
# Examples:
#   ./download-stats.sh          # All releases
#   ./download-stats.sh 0.1.7    # Specific version

REPO="aantich/oneringai"

# Colors
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo "Error: gh CLI not found. Install with: brew install gh"
    exit 1
fi

format_size() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ]; then
        echo "$(echo "scale=1; $bytes/1073741824" | bc) GB"
    elif [ "$bytes" -ge 1048576 ]; then
        echo "$((bytes / 1048576)) MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$((bytes / 1024)) KB"
    else
        echo "${bytes} B"
    fi
}

print_release() {
    local tag=$1
    local version="${tag#hosea-v}"

    # Get assets as JSON
    local assets
    assets=$(gh release view "$tag" --repo "$REPO" --json assets,publishedAt \
        --jq '{published: .publishedAt, assets: [.assets[] | select(.name | test("\\.(dmg|exe|AppImage)$")) | {name, size, downloads: .downloadCount}]}')

    local published
    published=$(echo "$assets" | python3 -c "import sys,json; print(json.load(sys.stdin)['published'][:10])" 2>/dev/null)

    # Calculate totals
    local total
    total=$(echo "$assets" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(sum(a['downloads'] for a in data['assets']))
" 2>/dev/null)

    echo -e "${BOLD}${CYAN}Everworker Desktop v${version}${RESET}  ${DIM}(${published})${RESET}  ${BOLD}Total: ${total} downloads${RESET}"

    # Print per-asset breakdown
    echo "$assets" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in sorted(data['assets'], key=lambda x: x['name']):
    name = a['name']
    dl = a['downloads']
    size = a['size']
    # Friendly platform name
    if 'arm64.dmg' in name:
        platform = 'macOS Apple Silicon'
    elif '.dmg' in name:
        platform = 'macOS Intel'
    elif 'arm64.exe' in name:
        platform = 'Windows ARM64'
    elif '.exe' in name:
        platform = 'Windows x64'
    elif 'arm64.AppImage' in name:
        platform = 'Linux ARM64'
    elif '.AppImage' in name:
        platform = 'Linux x64'
    else:
        platform = name

    bar = '█' * dl + '░' * max(0, 10 - dl) if dl <= 10 else '█' * 10 + f' +{dl-10}'
    size_mb = f'{size / 1048576:.0f} MB'
    print(f'  {platform:<22} {dl:>5}  {bar}  ({size_mb})')
" 2>/dev/null

    echo ""
}

# Header
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  Everworker Desktop Download Statistics${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
echo ""

if [ -n "$1" ]; then
    # Specific version
    print_release "hosea-v$1"
else
    # All releases
    GRAND_TOTAL=0
    TAGS=$(gh release list --repo "$REPO" --limit 50 --json tagName --jq '.[] | select(.tagName | startswith("hosea-v")) | .tagName' | sort -V)

    for tag in $TAGS; do
        print_release "$tag"

        # Add to grand total
        count=$(gh release view "$tag" --repo "$REPO" --json assets \
            --jq '[.assets[] | select(.name | test("\\.(dmg|exe|AppImage)$")) | .downloadCount] | add // 0')
        GRAND_TOTAL=$((GRAND_TOTAL + count))
    done

    echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
    echo -e "${BOLD}${GREEN}  Grand Total: ${GRAND_TOTAL} downloads${RESET}"
    echo -e "${BOLD}══════════════════════════════════════════════════${RESET}"
    echo ""
fi
