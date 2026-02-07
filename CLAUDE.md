# Magnet Station

A Safari extension for macOS and iOS that sends magnet links to Synology Download Station.

## Project Overview

This is a Safari Web Extension built with Xcode. It allows users to click magnet links on any webpage and automatically add them to their Synology NAS Download Station.

## Tech Stack

- **Platform**: Safari Web Extension (Manifest V3)
- **Languages**: JavaScript, CSS, HTML, Swift
- **Build**: Xcode project
- **Targets**: macOS, iOS

## Project Structure

```
DownloadStation/
├── Shared (App)/                    # Native app container
│   ├── Assets.xcassets/            # App icons
│   │   ├── AppIcon.appiconset/     # iOS/macOS app icons
│   │   └── LargeIcon.imageset/     # In-app display icon
│   └── Resources/
│       └── Icon.png                # Icon shown in app view
│
├── Shared (Extension)/              # Safari extension
│   └── Resources/
│       ├── manifest.json           # Extension manifest
│       ├── popup.html              # Extension popup UI
│       ├── popup.css               # Styles (modern, dark mode support)
│       ├── popup.js                # Main popup logic
│       ├── background.js           # Service worker (magnet handling, QuickConnect)
│       ├── content.js              # Content script (magnet link interception)
│       └── images/                 # Extension icons
│           ├── toolbar-icon.svg    # Safari toolbar icon
│           ├── logo.png            # Logo in popup header
│           └── icon-*.png          # Various sizes
│
├── docs/                           # GitHub Pages (privacy policy)
│   ├── index.html
│   └── icon.png
│
├── APPSTORE.md                     # App Store metadata
├── README.md                       # User documentation
└── CLAUDE.md                       # This file
```

## Key Features

1. **Login Methods**
   - Local IP/hostname with port
   - QuickConnect ID (resolves via Synology relay servers)

2. **Download Management**
   - View active downloads with progress
   - Delete downloads
   - Copy magnet links

3. **Quick Actions**
   - One-click magnet link adding (via content script)
   - Open Synology web UI in new tab
   - Refresh downloads list

## Synology API

Uses DSM 7.x Web API:

- **Auth**: `/webapi/entry.cgi?api=SYNO.API.Auth&version=7`
- **Tasks**: `/webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1`

### QuickConnect Resolution

1. POST to `https://global.quickconnect.to/Serv.php`
2. Get server info (LAN IPs, DDNS, external IP)
3. Try each candidate URL until one works

## Design System

CSS Variables (defined in popup.css):
- `--accent`: #D63031 (red - primary actions, delete, disconnect)
- `--blue`: #007AFF (secondary actions, refresh, copy, progress)
- `--success`: #00b894 (complete, seeding)
- `--warning`: #fdcb6e (paused)
- `--radius`: 10px
- `--transition`: 0.2s ease

Supports light and dark mode via `prefers-color-scheme`.

## Common Tasks

### Adding a new feature to popup
1. Edit `popup.html` for structure
2. Edit `popup.css` for styling
3. Edit `popup.js` for logic
4. Rebuild in Xcode

### Updating icons
1. Replace source PNG/SVG
2. Generate sizes: 16, 32, 48, 64, 96, 128, 256, 512, 1024
3. Update `Contents.json` in asset catalogs
4. Clean build in Xcode (Cmd+Shift+K)

### Testing
- Build and run in Xcode (Cmd+R)
- Enable extension in Safari → Settings → Extensions
- Check console: Develop → Web Extension Background Page

## Error Handling

- Session expiry (code 105) → auto-logout
- 2FA (code 403) → not supported, show message
- Connection timeout → 10 second limit
- User-friendly error messages in popup

## GitHub

- Repo: https://github.com/Ferchmin/MagnetStation
- Pages: https://ferchmin.github.io/MagnetStation/ (privacy policy)
- Issues: For bug reports and support

## App Store

See `APPSTORE.md` for:
- App description
- Keywords
- Screenshot requirements
- Privacy policy URL
