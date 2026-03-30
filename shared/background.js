import { loadSession } from "./platform.js";

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("MagnetToSynology: Received request:", request);

    if (request.magnet) {
        addMagnetToSynology(request.magnet);
        return false;
    }

    if (request.type === 'resolveQuickConnect') {
        // Return a Promise for Safari compatibility
        return resolveQuickConnect(request.qcId);
    }

    return false;
});

async function resolveQuickConnect(qcId) {
    try {
        // Step 1: Get server info from global QuickConnect
        console.log('Resolving QuickConnect ID:', qcId);
        let data = await qcRequest('https://global.quickconnect.to/Serv.php', 'get_server_info', qcId);

        // If errno 4, follow redirect to regional server
        if (data.errno === 4 && data.sites?.length > 0) {
            console.log('Following redirect to regional servers:', data.sites);
            for (const site of data.sites) {
                try {
                    data = await qcRequest(`https://${site}/Serv.php`, 'get_server_info', qcId);
                    if (data.errno === 0) break;
                } catch (e) {
                    console.error('Regional server failed:', site, e);
                }
            }
        }

        if (data.errno !== 0) {
            return { error: `QuickConnect error: ${data.errno}` };
        }

        console.log('Server info:', JSON.stringify(data, null, 2));

        // Step 2: Request tunnel via control host to get relay IP
        const controlHost = data.env?.control_host;
        if (controlHost) {
            try {
                console.log('Requesting tunnel via:', controlHost);
                const tunnelData = await qcRequest(`https://${controlHost}/Serv.php`, 'request_tunnel', qcId);
                console.log('Tunnel response:', JSON.stringify(tunnelData, null, 2));

                if (tunnelData.errno === 0 && tunnelData.service?.relay_ip) {
                    // Merge tunnel info into the server data
                    data.service = { ...data.service, ...tunnelData.service };
                }
            } catch (e) {
                console.log('Tunnel request failed (non-fatal):', e.message);
            }
        }

        return { data: data };
    } catch (e) {
        console.error('QuickConnect resolution failed:', e);
        return { error: e.message || 'QuickConnect resolution failed' };
    }
}

async function qcRequest(url, command, qcId) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            version: 1,
            command: command,
            id: 'dsm_portal_https',
            serverID: qcId,
            stop_when_error: false
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

async function addMagnetToSynology(magnetUrl) {
    try {
        // Get stored session (Keychain on Safari, storage.sync on Chrome/Firefox, storage.local fallback)
        let stored = await loadSession();

        if (!stored.synologyUrl || !stored.sid) {
            console.error("MagnetToSynology: Not logged in");
            showNotification("Not connected. Click extension icon to login.");
            return;
        }

        console.log("MagnetToSynology: Adding magnet:", magnetUrl);

        // Show loading state
        showBadge("loading");

        // Try to add torrent with existing SID
        let addData = await tryAddTorrent(stored.synologyUrl, stored.sid, magnetUrl);

        // If session expired, try to re-authenticate
        if (!addData.success && addData.error?.code === 105) {
            console.log("MagnetToSynology: Session expired, please re-login");
            showBadge("error");
            showNotification("Session expired. Click extension icon to reconnect.");
            await browser.storage.local.remove(['sid']);
            return;
        }

        if (addData.success) {
            showBadge("success");
            showNotification("Torrent added to Download Station");
        } else {
            showBadge("error");
            console.error("MagnetToSynology: Failed to add torrent:", addData);
            showNotification("Failed to add torrent");
        }

    } catch (error) {
        showBadge("error");
        console.error("MagnetToSynology: Error:", error);
        showNotification("Error: " + error.message);
    }
}

async function tryAddTorrent(synologyUrl, sid, magnetUrl) {
    const addUrl = `${synologyUrl}/webapi/DownloadStation/task.cgi`;
    const body = `api=SYNO.DownloadStation.Task&version=3&method=create&_sid=${sid}&uri=${encodeURIComponent(magnetUrl)}`;

    const response = await fetch(addUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body
    });

    return await response.json();
}

function showNotification(message) {
    // Safari doesn't support browser.notifications, so wrap in try-catch
    try {
        browser.notifications?.create({
            type: "basic",
            title: "Download Station",
            message: message
        });
    } catch (e) {
        // Ignore - notifications not supported in Safari
    }
}

function showBadge(state) {
    let text, color;

    switch (state) {
        case "loading":
            text = "...";
            color = "#888888";
            browser.action.setBadgeText({ text: text });
            browser.action.setBadgeBackgroundColor({ color: color });
            return;
        case "success":
            text = "✓";
            color = "#34c759";
            break;
        case "error":
            text = "✗";
            color = "#ff3b30";
            break;
    }

    browser.action.setBadgeText({ text: text });
    browser.action.setBadgeBackgroundColor({ color: color });

    // Clear badge after 3 seconds
    setTimeout(() => {
        browser.action.setBadgeText({ text: "" });
    }, 3000);
}
