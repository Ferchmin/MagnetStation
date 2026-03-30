// Browser namespace compatibility (Chrome uses chrome.*, Safari/Firefox use browser.*)
if (typeof globalThis.browser === "undefined") {
    globalThis.browser = chrome;
}

export const PLATFORM = (() => {
    try {
        if (browser.runtime?.sendNativeMessage && /Safari/.test(navigator.userAgent)) {
            return "safari";
        }
    } catch (e) { /* not Safari */ }
    return /Firefox/.test(navigator.userAgent) ? "firefox" : "chrome";
})();

const SESSION_KEYS = ["synologyUrl", "username", "sid", "quickConnectId"];

async function sendNative(message) {
    try {
        return await browser.runtime.sendNativeMessage(
            "com.ferchmin.DownloadStation",
            message
        );
    } catch (e) {
        console.log("Native message failed:", e.message);
        return { success: false, error: e.message };
    }
}

export async function loadSession() {
    if (PLATFORM === "safari") {
        const result = await sendNative({ action: "loadSession" });
        if (result?.success && result.sid) return result;
    }

    // Chrome/Firefox: try storage.sync first for cross-device sync
    if (PLATFORM !== "safari" && browser.storage.sync) {
        const synced = await browser.storage.sync.get(SESSION_KEYS);
        if (synced.sid && synced.synologyUrl) return synced;
    }

    // Fallback: storage.local
    return browser.storage.local.get(SESSION_KEYS);
}

export async function saveSession(data) {
    // Always save to storage.local
    await browser.storage.local.set(data);

    if (PLATFORM === "safari") {
        sendNative({ action: "saveSession", ...data });
    } else if (browser.storage.sync) {
        // Chrome/Firefox: sync cross-device (only session-safe keys, no password)
        const syncData = {};
        for (const key of SESSION_KEYS) {
            if (data[key] !== undefined) syncData[key] = data[key];
        }
        await browser.storage.sync.set(syncData);
    }
}

export async function deleteSession() {
    await browser.storage.local.remove(SESSION_KEYS);

    if (PLATFORM === "safari") {
        sendNative({ action: "deleteSession" });
    } else if (browser.storage.sync) {
        await browser.storage.sync.remove(SESSION_KEYS);
    }
}

export async function saveCredentials(server, username, password) {
    if (PLATFORM === "safari") {
        sendNative({ action: "saveCredentials", server, username, password });
    }
    // Chrome/Firefox: no equivalent — browser's built-in password manager handles this
}

export async function loadCredentials(server) {
    if (PLATFORM === "safari") {
        return sendNative({ action: "loadCredentials", server });
    }
    return { success: false };
}
