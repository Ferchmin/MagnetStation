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
    const servers = [
        'https://global.quickconnect.to/Serv.php'
    ];

    const errors = [];

    for (const server of servers) {
        try {
            console.log('Trying QuickConnect server:', server, 'with ID:', qcId);

            // Step 1: Get server info
            const response = await fetch(server, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    version: 1,
                    command: 'get_server_info',
                    id: 'dsm_portal_https',
                    serverID: qcId,
                    stop_when_error: false
                })
            });

            if (!response.ok) {
                errors.push(`${server}: HTTP ${response.status}`);
                continue;
            }

            const data = await response.json();
            console.log('QuickConnect response:', JSON.stringify(data, null, 2));

            if (data.errno === 0) {
                return { data: data };
            }

            // If errno 4, we need to follow the sites array
            if (data.errno === 4 && data.sites && data.sites.length > 0) {
                console.log('Following redirect to regional server:', data.sites);
                for (const site of data.sites) {
                    try {
                        const regionalUrl = `https://${site}/Serv.php`;
                        console.log('Trying regional server:', regionalUrl);

                        const regionalResponse = await fetch(regionalUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                version: 1,
                                command: 'get_server_info',
                                id: 'dsm_portal_https',
                                serverID: qcId,
                                stop_when_error: false
                            })
                        });

                        const regionalData = await regionalResponse.json();
                        console.log('Regional response:', JSON.stringify(regionalData, null, 2));

                        if (regionalData.errno === 0) {
                            return { data: regionalData };
                        }
                    } catch (e) {
                        console.error('Regional server failed:', site, e);
                    }
                }
            }

            errors.push(`${server}: errno ${data.errno} - ${data.errinfo || JSON.stringify(data)}`);
        } catch (e) {
            console.error('QuickConnect server failed:', server, e);
            errors.push(`${server}: ${e.message || e.toString()}`);
        }
    }

    return { error: errors.join('\n') || 'All servers failed' };
}

async function addMagnetToSynology(magnetUrl) {
    try {
        // Get stored credentials
        const stored = await browser.storage.local.get(['synologyUrl', 'username', 'sid']);

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
