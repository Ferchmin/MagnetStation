document.addEventListener('DOMContentLoaded', async () => {
    const loginView = document.getElementById('login-view');
    const connectedView = document.getElementById('connected-view');
    const loginForm = document.getElementById('login-form');
    const qcForm = document.getElementById('qc-form');
    const errorEl = document.getElementById('error');
    const logoutBtn = document.getElementById('logout-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const connectedUser = document.getElementById('connected-user');
    const connectedServer = document.getElementById('connected-server');
    const downloadsList = document.getElementById('downloads-list');
    const qcProgress = document.getElementById('qc-progress');

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
            errorEl.textContent = '';
        });
    });

    // Check if already connected
    const stored = await browser.storage.local.get(['synologyUrl', 'username', 'sid']);

    if (stored.sid && stored.synologyUrl && stored.username) {
        showConnectedView(stored.username, stored.synologyUrl);
        loadDownloads(stored.synologyUrl, stored.sid);
    }

    // Local login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';

        const urlBase = document.getElementById('url').value.trim().replace(/\/$/, '');
        const port = document.getElementById('port').value.trim() || '5000';
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        const url = `${urlBase}:${port}`;

        const loginBtn = document.getElementById('login-btn');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';

        try {
            const sid = await authenticate(url, username, password);
            if (sid) {
                await browser.storage.local.set({
                    synologyUrl: url,
                    username: username,
                    sid: sid
                });
                showConnectedView(username, url);
                loadDownloads(url, sid);
            }
        } catch (err) {
            console.error('Login error:', err);
            errorEl.textContent = err.message || 'Connection failed';
        }

        loginBtn.disabled = false;
        loginBtn.textContent = 'Connect';
    });

    // QuickConnect form submission
    qcForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';

        const qcId = document.getElementById('qc-id').value.trim();
        const username = document.getElementById('qc-username').value.trim();
        const password = document.getElementById('qc-password').value;

        const qcBtn = document.getElementById('qc-btn');
        qcBtn.disabled = true;
        qcBtn.textContent = 'Connecting...';

        qcProgress.classList.remove('hidden');
        resetProgressSteps();

        try {
            // Step 1: Resolve QuickConnect
            setStepActive('resolve');
            const serverInfo = await resolveQuickConnect(qcId);
            setStepDone('resolve');

            // Step 2: Find best server
            setStepActive('ping');
            const url = await findWorkingServer(serverInfo);
            if (!url) {
                throw new Error('Could not connect to NAS');
            }
            setStepDone('ping');

            // Step 3: Authenticate
            setStepActive('auth');
            const sid = await authenticate(url, username, password);
            setStepDone('auth');

            if (sid) {
                await browser.storage.local.set({
                    synologyUrl: url,
                    username: username,
                    sid: sid,
                    quickConnectId: qcId
                });
                showConnectedView(username, qcId);
                loadDownloads(url, sid);
            }
        } catch (err) {
            console.error('QuickConnect error:', err);
            setCurrentStepError();
            errorEl.textContent = err.message || 'QuickConnect failed';
        }

        qcBtn.disabled = false;
        qcBtn.textContent = 'Connect';
    });

    // Progress step helpers
    function resetProgressSteps() {
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active', 'done', 'error');
        });
    }

    function setStepActive(stepName) {
        const step = document.querySelector(`.step[data-step="${stepName}"]`);
        if (step) {
            step.classList.remove('done', 'error');
            step.classList.add('active');
        }
    }

    function setStepDone(stepName) {
        const step = document.querySelector(`.step[data-step="${stepName}"]`);
        if (step) {
            step.classList.remove('active', 'error');
            step.classList.add('done');
        }
    }

    function setCurrentStepError() {
        const activeStep = document.querySelector('.step.active');
        if (activeStep) {
            activeStep.classList.remove('active');
            activeStep.classList.add('error');
        }
    }

    // QuickConnect resolution
    async function resolveQuickConnect(qcId) {
        const servers = [
            'https://global.quickconnect.to/Serv.php',
            'https://us.quickconnect.to/Serv.php',
            'https://eu.quickconnect.to/Serv.php'
        ];

        for (const server of servers) {
            try {
                const response = await fetch(server, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        version: 1,
                        command: 'get_server_info',
                        serverID: qcId,
                        stop_when_error: false
                    })
                });

                const data = await response.json();
                console.log('QuickConnect response:', data);

                if (data.errno === 0) {
                    return data;
                }
            } catch (e) {
                console.log('Server failed:', server, e);
            }
        }

        throw new Error('QuickConnect ID not found');
    }

    // Find a working server from QuickConnect response
    async function findWorkingServer(serverInfo) {
        const candidates = [];
        const srv = serverInfo.server;
        const service = serverInfo.service;

        // Add LAN IPs (highest priority when on local network)
        if (srv?.interface) {
            for (const iface of srv.interface) {
                if (iface.ip) {
                    const port = service?.port || 5000;
                    candidates.push(`http://${iface.ip}:${port}`);
                }
            }
        }

        // Add DDNS hostname
        if (srv?.ddns) {
            const port = service?.ext_port || service?.port || 5001;
            candidates.push(`https://${srv.ddns}:${port}`);
        }

        // Add external IP
        if (srv?.external?.ip) {
            const port = srv.external.port || service?.ext_port || 5001;
            candidates.push(`https://${srv.external.ip}:${port}`);
        }

        // Add relay
        if (serverInfo.service?.relay_ip) {
            const port = serverInfo.service.relay_port || 443;
            candidates.push(`https://${serverInfo.service.relay_ip}:${port}`);
        }

        console.log('Trying servers:', candidates);

        // Try each candidate
        for (const url of candidates) {
            try {
                const testUrl = `${url}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(testUrl, { signal: controller.signal });
                clearTimeout(timeout);

                const data = await response.json();
                if (data.success) {
                    console.log('Found working server:', url);
                    return url;
                }
            } catch (e) {
                console.log('Server unreachable:', url);
            }
        }

        return null;
    }

    // Authenticate with Synology
    async function authenticate(url, username, password) {
        const loginUrl = `${url}/webapi/entry.cgi?api=SYNO.API.Auth&version=7&method=login&account=${encodeURIComponent(username)}&passwd=${encodeURIComponent(password)}&session=DownloadStation&format=sid`;

        const response = await fetch(loginUrl);
        const data = await response.json();

        if (data.success && data.data.sid) {
            return data.data.sid;
        } else {
            const errorCode = data.error?.code;
            if (errorCode === 400) throw new Error('Invalid username or password');
            else if (errorCode === 401) throw new Error('Account disabled');
            else if (errorCode === 402) throw new Error('Permission denied');
            else if (errorCode === 403) throw new Error('2FA required (not supported)');
            else throw new Error('Authentication failed');
        }
    }

    // Logout
    logoutBtn.addEventListener('click', async () => {
        const stored = await browser.storage.local.get(['synologyUrl', 'sid']);

        if (stored.synologyUrl && stored.sid) {
            try {
                await fetch(`${stored.synologyUrl}/webapi/entry.cgi?api=SYNO.API.Auth&version=7&method=logout&session=DownloadStation&_sid=${stored.sid}`);
            } catch (e) {
                // Ignore logout errors
            }
        }

        await browser.storage.local.remove(['synologyUrl', 'username', 'sid', 'quickConnectId']);
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

            let metaText = `${progress}%`;
            if (status === 'downloading' && speed > 0) {
                metaText = `${formatSpeed(speed)}`;
            } else if (status === 'seeding') {
                metaText = 'Seeding';
            } else if (status === 'paused') {
                metaText = 'Paused';
            } else if (status === 'error') {
                metaText = 'Error';
            }

            return `
                <div class="download-item">
                    <div class="download-name">${escapeHtml(name)}</div>
                    <div class="download-row">
                        <div class="progress-bar">
                            <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
                        </div>
                        <span class="download-meta ${status}">${metaText}</span>
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

    function showConnectedView(username, server) {
        loginView.classList.add('hidden');
        connectedView.classList.remove('hidden');
        connectedUser.textContent = username;
        connectedServer.textContent = server;
        qcProgress.classList.add('hidden');
    }

    function showLoginView() {
        connectedView.classList.add('hidden');
        loginView.classList.remove('hidden');
        document.getElementById('url').value = 'http://';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('qc-id').value = '';
        document.getElementById('qc-username').value = '';
        document.getElementById('qc-password').value = '';
        qcProgress.classList.add('hidden');
        resetProgressSteps();
        downloadsList.innerHTML = '<p class="loading">Loading...</p>';
    }
});
