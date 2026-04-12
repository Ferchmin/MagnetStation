# Magnet Station

A browser extension to send magnet links directly to your Synology Download Station. Available for Safari, Chrome, and Firefox.

## Features

- Click any magnet link to automatically add it to Download Station
- View active downloads with progress bars
- Connect via local IP or QuickConnect ID
- Smart connection: prefers fast LAN when available, falls back to remote
- Auto-reconnect via QuickConnect when your NAS IP changes

## Install

### Safari
1. Open the project in Xcode
2. Build and run (⌘R)
3. Enable the extension in Safari → Settings → Extensions

### Chrome
1. Run `./scripts/build.sh chrome`
2. Open `chrome://extensions` → Enable Developer mode
3. Click **Load unpacked** → select `dist/chrome/`

### Firefox
1. Run `./scripts/build.sh firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → select `dist/firefox/manifest.json`

## Setup

Click the extension icon and connect using either:
- **QuickConnect**: Enter your QuickConnect ID (e.g., `mynas`)
- **Local**: Enter your NAS IP address and port

## Requirements

- Synology NAS with Download Station installed (DSM 7+)
- **Safari**: macOS 10.15+ / iOS 15+
- **Chrome**: Any desktop platform
- **Firefox**: 109+

## Development

```bash
npm install        # install dev dependencies
npm test           # run tests (Vitest)
./scripts/build.sh all   # build all browser targets
```

Edit source files in `shared/`, then run the build script to sync changes to each browser target.

## Privacy

Privacy policy: https://ferchmin.github.io/MagnetStation/

## Support

- Issues: https://github.com/Ferchmin/MagnetStation/issues
- [Buy me a coffee](https://buymeacoffee.com/ferchmin)
