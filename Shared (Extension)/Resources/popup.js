document.addEventListener('DOMContentLoaded', async () => {
    const loginView = document.getElementById('login-view');
    const connectedView = document.getElementById('connected-view');
    const loginForm = document.getElementById('login-form');
    const qcForm = document.getElementById('qc-form');
    const errorEl = document.getElementById('error');
    const logoutBtn = document.getElementById('logout-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const openSynologyBtn = document.getElementById('open-synology-btn');
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
            // Step 1: Resolve QuickConnect to get server info
            setStepActive('resolve');
            const serverInfo = await resolveQuickConnect(qcId);
            setStepDone('resolve');

            // Step 2: Try to find a working server
            setStepActive('ping');
            let url = null;
            let sid = null;

            // Build list of URLs to try
            const candidates = [];
            const srv = serverInfo.server;
            const service = serverInfo.service;

            // LAN IPs first (fastest)
            if (srv?.interface) {
                for (const iface of srv.interface) {
                    if (iface.ip) {
                        candidates.push(`https://${iface.ip}:5001`);
                        candidates.push(`http://${iface.ip}:5000`);
                    }
                }
            }

            // DDNS hostname
            if (srv?.ddns) {
                const port = service?.ext_port || 5001;
                candidates.push(`https://${srv.ddns}:${port}`);
            }

            // External IP
            if (srv?.external?.ip) {
                const port = srv.external.port || service?.ext_port || 5001;
                candidates.push(`https://${srv.external.ip}:${port}`);
            }

            // QuickConnect relay URL (works but slower)
            candidates.push(`https://${qcId}.quickconnect.to`);

            console.log('Trying servers:', candidates);
            setStepDone('ping');

            // Step 3: Try to authenticate with each server
            setStepActive('auth');
            const errors = [];

            for (const candidate of candidates) {
                try {
                    console.log('Trying to authenticate with:', candidate);
                    sid = await authenticate(candidate, username, password);
                    if (sid) {
                        url = candidate;
                        break;
                    }
                } catch (e) {
                    console.log('Auth failed for', candidate, ':', e.message);
                    errors.push(`${candidate}: ${e.message}`);
                }
            }

            if (!sid) {
                throw new Error('Could not connect:\n' + errors.join('\n'));
            }

            setStepDone('auth');

            await browser.storage.local.set({
                synologyUrl: url,
                username: username,
                sid: sid,
                quickConnectId: qcId
            });
            showConnectedView(username, qcId);
            loadDownloads(url, sid);
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

    // QuickConnect resolution - uses background script to avoid CORS
    async function resolveQuickConnect(qcId) {
        const response = await browser.runtime.sendMessage({
            type: 'resolveQuickConnect',
            qcId: qcId
        });

        console.log('resolveQuickConnect response:', response);

        if (!response) {
            throw new Error('No response from background script');
        }

        if (response.error) {
            throw new Error(response.error);
        }

        return response.data;
    }

    // Find a working server from QuickConnect response
    async function findWorkingServer(serverInfo, qcId) {
        const candidates = [];
        const srv = serverInfo.server;
        const service = serverInfo.service;

        console.log('Server info:', JSON.stringify(serverInfo, null, 2));

        // Add LAN IPs first (fastest when on local network)
        if (srv?.interface) {
            for (const iface of srv.interface) {
                if (iface.ip) {
                    candidates.push(`https://${iface.ip}:5001`);
                    candidates.push(`http://${iface.ip}:5000`);
                }
            }
        }

        // Add DDNS hostname
        if (srv?.ddns) {
            const port = service?.ext_port || 5001;
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

        // Add direct QuickConnect relay URL last (works but slower)
        if (qcId) {
            candidates.push(`https://${qcId}.quickconnect.to`);
        }

        console.log('Trying servers:', candidates);

        if (candidates.length === 0) {
            throw new Error('No server candidates found in QuickConnect response');
        }

        const errors = [];

        // Try each candidate with a simple ping to webapi
        for (const url of candidates) {
            try {
                console.log('Testing:', url);
                // Use entry.cgi which is more reliable than query.cgi
                const testUrl = `${url}/webapi/entry.cgi?api=SYNO.API.Info&version=1&method=query`;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(testUrl, {
                    signal: controller.signal,
                    redirect: 'follow'
                });
                clearTimeout(timeout);

                // If we get any response, try to check if it's a valid Synology API
                const text = await response.text();
                console.log('Response from', url, ':', text.substring(0, 200));

                // Check if response contains Synology API markers
                if (text.includes('"success"') || text.includes('SYNO.')) {
                    console.log('Found working server:', url);
                    return url;
                }

                // For quickconnect.to URLs, they redirect - check if we got redirected to a real server
                if (response.url && response.url !== testUrl && !response.url.includes('quickconnect.to')) {
                    // Extract base URL from redirect
                    const redirectUrl = new URL(response.url);
                    const baseUrl = `${redirectUrl.protocol}//${redirectUrl.host}`;
                    console.log('Got redirect to:', baseUrl);
                    return baseUrl;
                }

                errors.push(`${url}: Invalid response`);
            } catch (e) {
                console.log('Server unreachable:', url, e.message);
                errors.push(`${url}: ${e.message || 'unreachable'}`);
            }
        }

        throw new Error('All servers failed:\n' + errors.join('\n'));
    }

    // Authenticate with Synology
    async function authenticate(url, username, password) {
        const loginUrl = `${url}/webapi/entry.cgi?api=SYNO.API.Auth&version=7&method=login&account=${encodeURIComponent(username)}&passwd=${encodeURIComponent(password)}&session=DownloadStation&format=sid`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(loginUrl, {
                signal: controller.signal,
                redirect: 'follow'
            });
            clearTimeout(timeout);

            const text = await response.text();
            console.log('Auth response from', url, ':', text.substring(0, 300));

            // Try to parse as JSON
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error('Could not reach Synology. Check your URL and make sure DSM is running.');
            }

            if (data.success && data.data?.sid) {
                return data.data.sid;
            } else {
                const errorCode = data.error?.code;
                if (errorCode === 400) throw new Error('Invalid username or password. Please check your credentials.');
                else if (errorCode === 401) throw new Error('This account has been disabled. Contact your NAS administrator.');
                else if (errorCode === 402) throw new Error('Permission denied. Make sure you have access to Download Station.');
                else if (errorCode === 403) throw new Error('Two-factor authentication is enabled. Please disable 2FA or use an app-specific password.');
                else if (errorCode === 404) throw new Error('Download Station is not installed on this NAS.');
                else throw new Error(`Login failed (error ${errorCode || 'unknown'}). Please try again.`);
            }
        } catch (e) {
            clearTimeout(timeout);
            if (e.name === 'AbortError') {
                throw new Error('Connection timed out. Check your network and NAS availability.');
            }
            throw e;
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

    // Open Synology in new tab
    openSynologyBtn.addEventListener('click', async () => {
        const stored = await browser.storage.local.get(['synologyUrl', 'sid']);
        if (stored.synologyUrl) {
            browser.tabs.create({ url: stored.synologyUrl });
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
            } else if (data.error?.code === 105) {
                // Session expired
                downloadsList.innerHTML = '<p class="empty">Session expired. Please reconnect.</p>';
                await browser.storage.local.remove(['sid']);
                setTimeout(() => showLoginView(), 2000);
            } else {
                downloadsList.innerHTML = '<p class="empty">Could not load downloads. Try refreshing.</p>';
            }
        } catch (err) {
            console.error('Load downloads error:', err);
            downloadsList.innerHTML = '<p class="empty">Connection error. Check your network.</p>';
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

            const uri = task.additional?.detail?.uri || '';
            const hasMagnet = uri.startsWith('magnet:');

            return `
                <div class="download-item" data-task-id="${task.id}" data-uri="${escapeHtml(uri)}">
                    <div class="download-header">
                        <div class="download-name">${escapeHtml(name)}</div>
                        <div class="download-actions">
                            ${hasMagnet ? '<button class="copy-btn" title="Copy magnet link">⎘</button>' : ''}
                            <button class="delete-btn" title="Remove">×</button>
                        </div>
                    </div>
                    <div class="download-row">
                        <div class="progress-bar">
                            <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
                        </div>
                        <span class="download-meta ${status}">${metaText}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers for copy buttons
        downloadsList.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.download-item');
                const uri = item.dataset.uri;
                if (uri) {
                    await navigator.clipboard.writeText(uri);
                    btn.textContent = '✓';
                    setTimeout(() => btn.textContent = '⎘', 1500);
                }
            });
        });

        // Add click handlers for delete buttons
        downloadsList.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.download-item');
                const taskId = item.dataset.taskId;
                if (taskId) {
                    await deleteTask(taskId);
                }
            });
        });
    }

    async function deleteTask(taskId) {
        try {
            const stored = await browser.storage.local.get(['synologyUrl', 'sid']);
            if (!stored.synologyUrl || !stored.sid) return;

            const url = `${stored.synologyUrl}/webapi/DownloadStation/task.cgi?api=SYNO.DownloadStation.Task&version=1&method=delete&id=${encodeURIComponent(taskId)}&_sid=${stored.sid}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                // Refresh the list
                await loadDownloads(stored.synologyUrl, stored.sid);
            } else {
                console.error('Failed to delete task:', data);
            }
        } catch (err) {
            console.error('Delete task error:', err);
        }
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
