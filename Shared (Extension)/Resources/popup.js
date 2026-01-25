document.addEventListener('DOMContentLoaded', async () => {
    const loginView = document.getElementById('login-view');
    const connectedView = document.getElementById('connected-view');
    const loginForm = document.getElementById('login-form');
    const errorEl = document.getElementById('error');
    const logoutBtn = document.getElementById('logout-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const connectedUser = document.getElementById('connected-user');
    const connectedServer = document.getElementById('connected-server');
    const downloadsList = document.getElementById('downloads-list');

    // Check if already connected
    const stored = await browser.storage.local.get(['synologyUrl', 'username', 'sid']);

    if (stored.sid && stored.synologyUrl && stored.username) {
        showConnectedView(stored.username, stored.synologyUrl);
        loadDownloads(stored.synologyUrl, stored.sid);
    }

    // Login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';

        const urlBase = document.getElementById('url').value.trim().replace(/\/$/, '');
        const port = document.getElementById('port').value.trim() || '5000';
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        // Combine URL and port
        const url = `${urlBase}:${port}`;

        const loginBtn = document.getElementById('login-btn');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';

        try {
            // Try to login
            const loginUrl = `${url}/webapi/entry.cgi?api=SYNO.API.Auth&version=7&method=login&account=${encodeURIComponent(username)}&passwd=${encodeURIComponent(password)}&session=DownloadStation&format=sid`;

            const response = await fetch(loginUrl);
            const data = await response.json();

            if (data.success && data.data.sid) {
                // Store credentials
                await browser.storage.local.set({
                    synologyUrl: url,
                    username: username,
                    sid: data.data.sid
                });

                showConnectedView(username, url);
                loadDownloads(url, data.data.sid);
            } else {
                const errorCode = data.error?.code;
                let errorMsg = 'Login failed';
                if (errorCode === 400) errorMsg = 'Invalid username or password';
                else if (errorCode === 401) errorMsg = 'Account disabled';
                else if (errorCode === 402) errorMsg = 'Permission denied';
                else if (errorCode === 403) errorMsg = '2FA required (not supported)';
                errorEl.textContent = errorMsg;
            }
        } catch (err) {
            console.error('Login error:', err);
            errorEl.textContent = 'Connection failed. Check URL.';
        }

        loginBtn.disabled = false;
        loginBtn.textContent = 'Connect';
    });

    // Logout
    logoutBtn.addEventListener('click', async () => {
        const stored = await browser.storage.local.get(['synologyUrl', 'sid']);

        // Try to logout from Synology
        if (stored.synologyUrl && stored.sid) {
            try {
                await fetch(`${stored.synologyUrl}/webapi/entry.cgi?api=SYNO.API.Auth&version=7&method=logout&session=DownloadStation&_sid=${stored.sid}`);
            } catch (e) {
                // Ignore logout errors
            }
        }

        // Clear stored data
        await browser.storage.local.remove(['synologyUrl', 'username', 'sid']);

        showLoginView();
    });

    // Refresh downloads
    refreshBtn.addEventListener('click', async () => {
        const stored = await browser.storage.local.get(['synologyUrl', 'sid']);
        if (stored.synologyUrl && stored.sid) {
            refreshBtn.style.transform = 'rotate(360deg)';
            setTimeout(() => refreshBtn.style.transform = '', 500);
            await loadDownloads(stored.synologyUrl, stored.sid);
        }
    });

    async function loadDownloads(synologyUrl, sid) {
        downloadsList.innerHTML = '<p class="loading">Loading...</p>';

        try {
            const url = `${synologyUrl}/webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=list&additional=transfer,detail`;
            const response = await fetch(`${url}&_sid=${sid}`);
            const data = await response.json();

            if (data.success && data.data.tasks) {
                renderDownloads(data.data.tasks);
            } else {
                downloadsList.innerHTML = '<p class="empty">Failed to load downloads</p>';
            }
        } catch (err) {
            console.error('Load downloads error:', err);
            downloadsList.innerHTML = '<p class="empty">Error loading downloads</p>';
        }
    }

    function renderDownloads(tasks) {
        if (tasks.length === 0) {
            downloadsList.innerHTML = '<p class="empty">No active downloads</p>';
            return;
        }

        // Sort by status: downloading first, then others
        tasks.sort((a, b) => {
            const order = { downloading: 0, waiting: 1, paused: 2, finishing: 3, finished: 4, seeding: 5, error: 6 };
            return (order[a.status] || 99) - (order[b.status] || 99);
        });

        downloadsList.innerHTML = tasks.map(task => {
            const name = task.title;
            const status = task.status;
            const size = task.size || 0;
            const downloaded = task.additional?.transfer?.size_downloaded || 0;
            const progress = size > 0 ? Math.round((downloaded / size) * 100) : 0;
            const speed = task.additional?.transfer?.speed_download || 0;

            let progressClass = '';
            if (status === 'finished' || status === 'seeding') progressClass = 'complete';
            else if (status === 'paused') progressClass = 'paused';
            else if (status === 'error') progressClass = 'error';

            let statusClass = status;
            let statusText = status.charAt(0).toUpperCase() + status.slice(1);
            if (status === 'downloading' && speed > 0) {
                statusText += ` (${formatSpeed(speed)})`;
            }

            return `
                <div class="download-item">
                    <div class="download-name">${escapeHtml(name)}</div>
                    <div class="download-progress">
                        <div class="progress-bar">
                            <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
                        </div>
                        <span>${progress}%</span>
                    </div>
                    <div class="download-info">
                        <span class="download-status ${statusClass}">${statusText}</span>
                        <span>${formatSize(downloaded)} / ${formatSize(size)}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatSpeed(bytesPerSec) {
        return formatSize(bytesPerSec) + '/s';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showConnectedView(username, url) {
        loginView.classList.add('hidden');
        connectedView.classList.remove('hidden');
        connectedUser.textContent = username;
        connectedServer.textContent = url;
    }

    function showLoginView() {
        connectedView.classList.add('hidden');
        loginView.classList.remove('hidden');
        document.getElementById('url').value = 'http://';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        downloadsList.innerHTML = '<p class="loading">Loading...</p>';
    }
});
