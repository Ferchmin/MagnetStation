# Permissions Justification

Paste these into the Chrome Web Store / Firefox AMO review forms.

## `notifications`

Used to surface a short system notification when a magnet link has been
successfully handed off to Download Station, when a session has expired, or
when the NAS rejects a task. Without this permission the user has to open the
popup to confirm a click succeeded. No notifications are sent for marketing or
analytics purposes -- they are only triggered by direct user actions.

## `storage`

Used to persist the user's connection settings (Synology hostname or
QuickConnect ID, port, HTTPS preference) and an authenticated session token so
the user does not have to log in on every popup open. All data is stored in
the browser's local/sync storage and is only ever transmitted to the Synology
address the user configured. No data leaves the user's devices and browser
profile.

## `host_permissions: http://*/*` and `https://*/*`

The extension cannot know in advance which host the user's Synology NAS lives
on -- it could be a private LAN address (`http://192.168.x.x:5000`), a custom
domain, a DDNS hostname, or a QuickConnect relay tunnel chosen at runtime.
Broad host access is required for two reasons:

1. **Content script**: detect magnet links on arbitrary pages so the user can
   click them and have Magnet Station route them to their NAS instead of the
   browser's default handler.
2. **Background fetches**: call the Synology DSM Web API (`/webapi/...`) on
   whichever host/IP the user configured, including following QuickConnect
   regional redirects and trying LAN -> DDNS -> relay candidates.

The extension does not read or modify page content beyond magnet link
handling, does not inject ads or trackers, and does not contact any server
other than the user-configured Synology endpoint and Synology's official
QuickConnect resolver (`global.quickconnect.to`).

## Remote code

The extension does not load, execute, or eval any remote code. All scripts
are bundled into the package at build time by `scripts/build.sh`.
