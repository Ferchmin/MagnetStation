#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHARED="$REPO_ROOT/shared"
DIST="$REPO_ROOT/dist"

# Bundle platform.js into a JS file by stripping its import line and prepending platform code
bundle_js() {
    local src="$1"
    local dest="$2"
    local platform_code
    # Remove 'export' keywords from platform.js for inlining
    platform_code=$(sed 's/^export //g' "$SHARED/platform.js")
    # Strip the import line from the source file and prepend platform code
    {
        echo "$platform_code"
        echo ""
        grep -v '^import.*from.*"./platform.js"' "$src"
    } > "$dest"
}

build_chrome() {
    echo "Building Chrome extension..."
    local out="$DIST/chrome"
    rm -rf "$out"
    mkdir -p "$out"
    # Strip type="module" since the built JS has no imports
    sed 's/ type="module"//' "$SHARED/popup.html" > "$out/popup.html"
    cp "$SHARED/popup.css" "$out/"
    cp "$SHARED/content.js" "$out/"
    cp -r "$SHARED/_locales" "$out/"
    cp -r "$SHARED/images" "$out/"
    bundle_js "$SHARED/popup.js" "$out/popup.js"
    bundle_js "$SHARED/background.js" "$out/background.js"
    cp "$REPO_ROOT/chrome/manifest.json" "$out/"
    echo "  → $out"
}

build_firefox() {
    echo "Building Firefox extension..."
    local out="$DIST/firefox"
    rm -rf "$out"
    mkdir -p "$out"
    # Strip type="module" since the built JS has no imports
    sed 's/ type="module"//' "$SHARED/popup.html" > "$out/popup.html"
    cp "$SHARED/popup.css" "$out/"
    cp "$SHARED/content.js" "$out/"
    cp -r "$SHARED/_locales" "$out/"
    cp -r "$SHARED/images" "$out/"
    bundle_js "$SHARED/popup.js" "$out/popup.js"
    bundle_js "$SHARED/background.js" "$out/background.js"
    cp "$REPO_ROOT/firefox/manifest.json" "$out/"
    echo "  → $out"
}

build_safari() {
    echo "Syncing shared resources to Safari extension..."
    local out="$REPO_ROOT/Shared (Extension)/Resources"
    cp "$SHARED/popup.html" "$out/"
    cp "$SHARED/popup.css" "$out/"
    cp "$SHARED/content.js" "$out/"
    cp -r "$SHARED/_locales" "$out/"
    cp "$SHARED/images/"* "$out/images/"
    bundle_js "$SHARED/popup.js" "$out/popup.js"
    bundle_js "$SHARED/background.js" "$out/background.js"
    echo "  → $out"
}

case "${1:-all}" in
    chrome)  build_chrome ;;
    firefox) build_firefox ;;
    safari)  build_safari ;;
    all)
        build_chrome
        build_firefox
        build_safari
        echo "Done. All targets built."
        ;;
    *)
        echo "Usage: $0 {chrome|firefox|safari|all}"
        exit 1
        ;;
esac
