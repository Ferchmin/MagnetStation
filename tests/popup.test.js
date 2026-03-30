import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const POPUP_HTML = readFileSync(
    resolve(__dirname, '../shared/popup.html'),
    'utf-8'
);
// Read the built (bundled) popup.js which has platform.js inlined and no import statements
const POPUP_JS = readFileSync(
    resolve(__dirname, '../Shared (Extension)/Resources/popup.js'),
    'utf-8'
);

/**
 * Sets up a JSDOM environment with browser API mocks and evaluates popup.js.
 * Returns helpers for interacting with the simulated popup.
 */
function setupPopupEnv({ fetchImpl, storageInit } = {}) {
    const dom = new JSDOM(POPUP_HTML, {
        url: 'https://extension.example.com',
        runScripts: 'dangerously',
        pretendToBeVisual: true,
    });
    const { window } = dom;
    const { document } = window;

    // Track storage state
    const storage = storageInit ? { ...storageInit } : {};

    // Storage mock helper
    const storageMethods = () => ({
        get: vi.fn(async (keys) => {
            const result = {};
            for (const k of keys) {
                if (k in storage) result[k] = storage[k];
            }
            return result;
        }),
        set: vi.fn(async (obj) => {
            Object.assign(storage, obj);
        }),
        remove: vi.fn(async (keys) => {
            for (const k of keys) delete storage[k];
        }),
    });

    // Mock browser.* APIs
    window.browser = {
        storage: {
            local: storageMethods(),
            sync: storageMethods(),
        },
        runtime: { sendMessage: vi.fn() },
        tabs: { create: vi.fn() },
    };

    // Mock fetch — default: never resolves (simulates unreachable server)
    const defaultFetch = () => new Promise(() => {});
    window.fetch = vi.fn(fetchImpl || defaultFetch);

    // Evaluate popup.js
    window.eval(POPUP_JS);

    return { dom, window, document, storage, browserMock: window.browser };
}

/** Helper: creates a fetchImpl that responds to specific URL patterns */
function createFetchRouter(routes) {
    return (url, opts) => {
        for (const [pattern, handler] of Object.entries(routes)) {
            if (url.includes(pattern)) {
                return Promise.resolve(handler(url, opts));
            }
        }
        return new Promise(() => {}); // default: hang
    };
}

/** Helper: create a mock Response */
function jsonResponse(data) {
    return {
        ok: true,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(JSON.stringify(data)),
        url: '',
    };
}

/**
 * Fires DOMContentLoaded and waits for the microtask queue to flush.
 */
async function fireDOMContentLoaded(window) {
    const event = new window.Event('DOMContentLoaded');
    window.document.dispatchEvent(event);
    // Allow enough time for async chains (storage.get → fetch → json → render)
    await new Promise((r) => setTimeout(r, 200));
}

// Ensure fake timers never leak between tests
afterEach(() => {
    vi.useRealTimers();
});

/** Standard logged-in storage state */
const LOGGED_IN_STORAGE = {
    synologyUrl: 'http://192.168.1.100:5000',
    username: 'admin',
    sid: 'test-sid-123',
};

/** Fetch that returns empty task list (healthy server) */
function healthyServerFetch(url, opts) {
    if (url.includes('DownloadStation/task.cgi')) {
        return Promise.resolve(jsonResponse({
            success: true,
            data: { tasks: [], total: 0, offset: 0 },
        }));
    }
    if (url.includes('SYNO.API.Auth') && url.includes('method=logout')) {
        return Promise.resolve(jsonResponse({ success: true }));
    }
    if (url.includes('SYNO.API.Auth') && url.includes('method=login')) {
        return Promise.resolve(jsonResponse({
            success: true,
            data: { sid: 'new-sid-456' },
        }));
    }
    return new Promise(() => {});
}

// ─────────────────────────────────────────────
// UNREACHABLE SERVER BEHAVIOR
// ─────────────────────────────────────────────

describe('unreachable server behavior', () => {
    describe('disconnect button', () => {
        it('should clear storage and show login view even when fetch hangs forever', async () => {
            const { window, document, storage, browserMock } = setupPopupEnv({
                fetchImpl: () => new Promise(() => {}),
            });

            storage.synologyUrl = 'http://192.168.1.100:5000';
            storage.username = 'admin';
            storage.sid = 'test-sid-123';

            await fireDOMContentLoaded(window);

            const connectedView = document.getElementById('connected-view');
            const loginView = document.getElementById('login-view');
            expect(connectedView.classList.contains('hidden')).toBe(false);

            document.getElementById('logout-btn').click();
            await new Promise((r) => setTimeout(r, 100));

            expect(browserMock.storage.local.remove).toHaveBeenCalled();
            expect(loginView.classList.contains('hidden')).toBe(false);
            expect(connectedView.classList.contains('hidden')).toBe(true);
        });

        it('should not await the logout fetch call', async () => {
            const callOrder = [];
            let tracking = false;

            const { window, document, storage, browserMock } = setupPopupEnv({
                fetchImpl: () => {
                    if (tracking) callOrder.push('fetch-called');
                    return new Promise(() => {});
                },
            });

            storage.synologyUrl = 'http://192.168.1.100:5000';
            storage.username = 'admin';
            storage.sid = 'test-sid-123';

            const originalRemove = browserMock.storage.local.remove;
            browserMock.storage.local.remove = vi.fn(async (...args) => {
                if (tracking) callOrder.push('storage-remove');
                return originalRemove(...args);
            });

            await fireDOMContentLoaded(window);
            tracking = true;

            document.getElementById('logout-btn').click();
            await new Promise((r) => setTimeout(r, 100));

            const removeIdx = callOrder.indexOf('storage-remove');
            const fetchIdx = callOrder.indexOf('fetch-called');
            expect(removeIdx).toBeGreaterThanOrEqual(0);
            if (fetchIdx >= 0) {
                expect(removeIdx).toBeLessThan(fetchIdx);
            }
        });
    });

    describe('loadDownloads', () => {
        it('should show connection error when fetch times out instead of loading forever', async () => {
            const { window, document, storage } = setupPopupEnv({
                fetchImpl: (url, opts) => {
                    return new Promise((resolve, reject) => {
                        if (opts?.signal) {
                            opts.signal.addEventListener('abort', () => {
                                reject(new DOMException('The operation was aborted.', 'AbortError'));
                            });
                        }
                    });
                },
            });

            storage.synologyUrl = 'http://192.168.1.100:5000';
            storage.username = 'admin';
            storage.sid = 'test-sid-123';

            await fireDOMContentLoaded(window);

            vi.useFakeTimers();
            document.getElementById('refresh-btn').click();
            await vi.advanceTimersByTimeAsync(11000);
            vi.useRealTimers();
            await new Promise((r) => setTimeout(r, 50));

            const downloadsList = document.getElementById('downloads-list');
            expect(downloadsList.innerHTML).toContain('Connection error');
            expect(downloadsList.innerHTML).not.toContain('Loading');
        });

        it('should pass an AbortSignal to the fetch call', async () => {
            let receivedSignal = null;

            const { window, document, storage } = setupPopupEnv({
                fetchImpl: (url, opts) => {
                    if (url.includes('DownloadStation/task.cgi')) {
                        receivedSignal = opts?.signal;
                    }
                    return new Promise(() => {});
                },
            });

            storage.synologyUrl = 'http://192.168.1.100:5000';
            storage.username = 'admin';
            storage.sid = 'test-sid-123';

            await fireDOMContentLoaded(window);

            expect(receivedSignal).toBeTruthy();
            expect(receivedSignal).toBeInstanceOf(window.AbortSignal);
        });
    });

    describe('refresh button', () => {
        it('should work and not hang when server is unreachable', async () => {
            let fetchCallCount = 0;

            const { window, document, storage } = setupPopupEnv({
                fetchImpl: () => {
                    fetchCallCount++;
                    return Promise.reject(new TypeError('Failed to fetch'));
                },
            });

            storage.synologyUrl = 'http://192.168.1.100:5000';
            storage.username = 'admin';
            storage.sid = 'test-sid-123';

            await fireDOMContentLoaded(window);
            const initialFetchCount = fetchCallCount;

            document.getElementById('refresh-btn').click();
            await new Promise((r) => setTimeout(r, 100));

            expect(fetchCallCount).toBeGreaterThan(initialFetchCount);
            const downloadsList = document.getElementById('downloads-list');
            expect(downloadsList.innerHTML).toContain('Connection error');
        });
    });
});

// ─────────────────────────────────────────────
// AUTHENTICATION ERROR HANDLING
// ─────────────────────────────────────────────

describe('authentication error handling', () => {
    function setupLoginEnv(errorCode) {
        return setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('SYNO.API.Auth') && url.includes('method=login')) {
                    return Promise.resolve(jsonResponse({
                        success: false,
                        error: { code: errorCode },
                    }));
                }
                return new Promise(() => {});
            },
        });
    }

    async function submitLocalLogin(document, window) {
        await fireDOMContentLoaded(window);

        document.getElementById('url').value = 'http://192.168.1.100';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'password123';

        const form = document.getElementById('login-form');
        form.dispatchEvent(new window.Event('submit', { cancelable: true }));
        await new Promise((r) => setTimeout(r, 100));
    }

    it('should show invalid credentials for error 400', async () => {
        const { window, document } = setupLoginEnv(400);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('Invalid username or password');
    });

    it('should show account disabled for error 401', async () => {
        const { window, document } = setupLoginEnv(401);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('account has been disabled');
    });

    it('should show permission denied for error 402', async () => {
        const { window, document } = setupLoginEnv(402);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('Permission denied');
    });

    it('should show 2FA message for error 403', async () => {
        const { window, document } = setupLoginEnv(403);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('Two-factor authentication');
    });

    it('should show Download Station not installed for error 404', async () => {
        const { window, document } = setupLoginEnv(404);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('Download Station is not installed');
    });

    it('should show generic error for unknown codes', async () => {
        const { window, document } = setupLoginEnv(999);
        await submitLocalLogin(document, window);
        expect(document.getElementById('error').textContent).toContain('Login failed');
        expect(document.getElementById('error').textContent).toContain('999');
    });

    it('should show timeout error when server does not respond', async () => {
        const { window, document } = setupPopupEnv({
            fetchImpl: (url, opts) => {
                return new Promise((resolve, reject) => {
                    if (opts?.signal) {
                        opts.signal.addEventListener('abort', () => {
                            reject(new DOMException('The operation was aborted.', 'AbortError'));
                        });
                    }
                });
            },
        });

        await fireDOMContentLoaded(window);

        document.getElementById('url').value = 'http://192.168.1.100';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'password123';

        vi.useFakeTimers();

        const form = document.getElementById('login-form');
        form.dispatchEvent(new window.Event('submit', { cancelable: true }));

        await vi.advanceTimersByTimeAsync(11000);
        vi.useRealTimers();
        await new Promise((r) => setTimeout(r, 50));

        expect(document.getElementById('error').textContent).toContain('timed out');
    });

    it('should show error when response is not JSON (non-Synology server)', async () => {
        const { window, document } = setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('SYNO.API.Auth')) {
                    return Promise.resolve({
                        ok: true,
                        text: () => Promise.resolve('<html>Not a Synology</html>'),
                        json: () => Promise.reject(new Error('not json')),
                        url: '',
                    });
                }
                return new Promise(() => {});
            },
        });

        await fireDOMContentLoaded(window);

        document.getElementById('url').value = 'http://192.168.1.100';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'password123';

        document.getElementById('login-form').dispatchEvent(
            new window.Event('submit', { cancelable: true })
        );
        await new Promise((r) => setTimeout(r, 100));

        expect(document.getElementById('error').textContent).toContain('Could not reach Synology');
    });

    it('should re-enable Connect button after failed login', async () => {
        const { window, document } = setupLoginEnv(400);
        await fireDOMContentLoaded(window);

        document.getElementById('url').value = 'http://192.168.1.100';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'password123';

        const loginBtn = document.getElementById('login-btn');
        document.getElementById('login-form').dispatchEvent(
            new window.Event('submit', { cancelable: true })
        );
        await new Promise((r) => setTimeout(r, 100));

        expect(loginBtn.disabled).toBe(false);
        expect(loginBtn.textContent).toBe('Connect');
    });
});

// ─────────────────────────────────────────────
// SESSION EXPIRY
// ─────────────────────────────────────────────

describe('session expiry', () => {
    it('should show session expired and redirect to login on error code 105', async () => {
        const { window, document, storage, browserMock } = setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('DownloadStation/task.cgi')) {
                    return Promise.resolve(jsonResponse({
                        success: false,
                        error: { code: 105 },
                    }));
                }
                return new Promise(() => {});
            },
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        const downloadsList = document.getElementById('downloads-list');
        expect(downloadsList.innerHTML).toContain('Session expired');

        // Should clear the session
        expect(browserMock.storage.local.remove).toHaveBeenCalled();

        // After 2s delay, should show login view
        // The setTimeout was already scheduled with real timers, so just wait
        await new Promise((r) => setTimeout(r, 2500));

        const loginView = document.getElementById('login-view');
        const connectedView = document.getElementById('connected-view');
        expect(loginView.classList.contains('hidden')).toBe(false);
        expect(connectedView.classList.contains('hidden')).toBe(true);
    });
});

// ─────────────────────────────────────────────
// DELETE TASK
// ─────────────────────────────────────────────

describe('delete task', () => {
    it('should refresh downloads after successful delete', async () => {
        let fetchCalls = [];

        const { window, document, storage } = setupPopupEnv({
            fetchImpl: (url) => {
                fetchCalls.push(url);
                if (url.includes('method=delete')) {
                    return Promise.resolve(jsonResponse({ success: true }));
                }
                if (url.includes('method=list')) {
                    return Promise.resolve(jsonResponse({
                        success: true,
                        data: {
                            tasks: [{
                                id: 'task-1',
                                title: 'Test Download',
                                status: 'downloading',
                                size: 1000,
                                additional: {
                                    transfer: { size_downloaded: 500, speed_download: 100 },
                                    detail: { uri: 'magnet:?xt=abc' },
                                },
                            }],
                            total: 1,
                            offset: 0,
                        },
                    }));
                }
                return new Promise(() => {});
            },
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        // A download should be rendered with a delete button
        const deleteBtn = document.querySelector('.delete-btn');
        expect(deleteBtn).toBeTruthy();

        fetchCalls = [];
        deleteBtn.click();
        await new Promise((r) => setTimeout(r, 150));

        // Should have called delete then list (refresh)
        const deleteCall = fetchCalls.find(u => u.includes('method=delete'));
        const listCall = fetchCalls.find(u => u.includes('method=list'));
        expect(deleteCall).toBeTruthy();
        expect(listCall).toBeTruthy();
        expect(deleteCall).toContain('task-1');
    });

    it('should not crash when server is unreachable during delete', async () => {
        const { window, document, storage } = setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('method=list')) {
                    return Promise.resolve(jsonResponse({
                        success: true,
                        data: {
                            tasks: [{
                                id: 'task-1',
                                title: 'Test Download',
                                status: 'downloading',
                                size: 1000,
                                additional: {
                                    transfer: { size_downloaded: 500, speed_download: 0 },
                                    detail: { uri: '' },
                                },
                            }],
                        },
                    }));
                }
                // delete call fails
                return Promise.reject(new TypeError('Failed to fetch'));
            },
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        const deleteBtn = document.querySelector('.delete-btn');
        expect(deleteBtn).toBeTruthy();

        // Should not throw
        deleteBtn.click();
        await new Promise((r) => setTimeout(r, 100));
    });
});

// ─────────────────────────────────────────────
// DOWNLOAD RENDERING
// ─────────────────────────────────────────────

describe('download rendering', () => {
    function setupWithTasks(tasks) {
        return setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('DownloadStation/task.cgi')) {
                    return Promise.resolve(jsonResponse({
                        success: true,
                        data: { tasks, total: tasks.length, offset: 0 },
                    }));
                }
                return new Promise(() => {});
            },
        });
    }

    function makeTask(overrides = {}) {
        return {
            id: 'task-1',
            title: 'Test File',
            status: 'downloading',
            size: 1048576, // 1 MB
            additional: {
                transfer: { size_downloaded: 524288, speed_download: 1024 },
                detail: { uri: '' },
            },
            ...overrides,
        };
    }

    it('should show "No active downloads" when task list is empty', async () => {
        const { window, document, storage } = setupWithTasks([]);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        expect(document.getElementById('downloads-list').innerHTML).toContain('No active downloads');
    });

    it('should calculate progress percentage correctly', async () => {
        const { window, document, storage } = setupWithTasks([
            makeTask({ size: 1000, additional: { transfer: { size_downloaded: 250, speed_download: 0 }, detail: { uri: '' } } }),
        ]);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const progressFill = document.querySelector('.progress-fill');
        expect(progressFill.style.width).toBe('25%');
    });

    it('should show 0% progress when size is 0', async () => {
        const { window, document, storage } = setupWithTasks([
            makeTask({ size: 0, additional: { transfer: { size_downloaded: 0, speed_download: 0 }, detail: { uri: '' } } }),
        ]);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const progressFill = document.querySelector('.progress-fill');
        expect(progressFill.style.width).toBe('0%');
    });

    it('should display speed for downloading tasks', async () => {
        const { window, document, storage } = setupWithTasks([
            makeTask({ status: 'downloading', additional: { transfer: { size_downloaded: 500, speed_download: 1048576 }, detail: { uri: '' } } }),
        ]);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const meta = document.querySelector('.download-meta');
        expect(meta.textContent).toContain('1 MB/s');
    });

    it('should display correct status labels', async () => {
        const tasks = [
            makeTask({ id: 't1', title: 'Seeding File', status: 'seeding' }),
            makeTask({ id: 't2', title: 'Paused File', status: 'paused' }),
            makeTask({ id: 't3', title: 'Error File', status: 'error' }),
        ];
        const { window, document, storage } = setupWithTasks(tasks);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const metas = [...document.querySelectorAll('.download-meta')];
        const texts = metas.map(m => m.textContent.trim());
        expect(texts).toContain('Seeding');
        expect(texts).toContain('Paused');
        expect(texts).toContain('Error');
    });

    it('should apply correct CSS classes for progress states', async () => {
        const tasks = [
            makeTask({ id: 't1', status: 'finished' }),
            makeTask({ id: 't2', status: 'seeding' }),
            makeTask({ id: 't3', status: 'paused' }),
            makeTask({ id: 't4', status: 'error' }),
            makeTask({ id: 't5', status: 'downloading' }),
        ];
        const { window, document, storage } = setupWithTasks(tasks);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const fills = [...document.querySelectorAll('.progress-fill')];
        const classes = fills.map(f => f.className);

        expect(classes.filter(c => c.includes('complete')).length).toBe(2); // finished + seeding
        expect(classes.filter(c => c.includes('paused')).length).toBe(1);
        expect(classes.filter(c => c.includes('error')).length).toBe(1);
    });

    it('should sort tasks by status: downloading first, error last', async () => {
        const tasks = [
            makeTask({ id: 'error', title: 'Error', status: 'error' }),
            makeTask({ id: 'seeding', title: 'Seeding', status: 'seeding' }),
            makeTask({ id: 'downloading', title: 'Downloading', status: 'downloading' }),
            makeTask({ id: 'paused', title: 'Paused', status: 'paused' }),
            makeTask({ id: 'finished', title: 'Finished', status: 'finished' }),
        ];
        const { window, document, storage } = setupWithTasks(tasks);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const items = [...document.querySelectorAll('.download-item')];
        const ids = items.map(i => i.dataset.taskId);
        expect(ids).toEqual(['downloading', 'paused', 'finished', 'seeding', 'error']);
    });

    it('should show copy button only for magnet URIs', async () => {
        const tasks = [
            makeTask({ id: 't1', title: 'Magnet', additional: { transfer: { size_downloaded: 0, speed_download: 0 }, detail: { uri: 'magnet:?xt=urn:btih:abc' } } }),
            makeTask({ id: 't2', title: 'HTTP', additional: { transfer: { size_downloaded: 0, speed_download: 0 }, detail: { uri: 'http://example.com/file.zip' } } }),
        ];
        const { window, document, storage } = setupWithTasks(tasks);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const items = [...document.querySelectorAll('.download-item')];
        const magnetItem = items.find(i => i.dataset.taskId === 't1');
        const httpItem = items.find(i => i.dataset.taskId === 't2');

        expect(magnetItem.querySelector('.copy-btn')).toBeTruthy();
        expect(httpItem.querySelector('.copy-btn')).toBeNull();
    });

    it('should escape HTML in task titles', async () => {
        const tasks = [
            makeTask({ title: '<script>alert("xss")</script>' }),
        ];
        const { window, document, storage } = setupWithTasks(tasks);
        Object.assign(storage, LOGGED_IN_STORAGE);
        await fireDOMContentLoaded(window);

        const nameEl = document.querySelector('.download-name');
        // Should show escaped text, not execute script
        expect(nameEl.textContent).toContain('<script>');
        expect(nameEl.innerHTML).not.toContain('<script>');
        expect(nameEl.innerHTML).toContain('&lt;script&gt;');
    });
});

// ─────────────────────────────────────────────
// INITIAL STATE RESTORATION
// ─────────────────────────────────────────────

describe('initial state restoration', () => {
    it('should show connected view when storage has a valid session', async () => {
        const { window, document, storage } = setupPopupEnv({
            fetchImpl: healthyServerFetch,
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        const connectedView = document.getElementById('connected-view');
        const loginView = document.getElementById('login-view');
        expect(connectedView.classList.contains('hidden')).toBe(false);
        expect(loginView.classList.contains('hidden')).toBe(true);

        expect(document.getElementById('connected-user').textContent).toBe('admin');
        expect(document.getElementById('connected-server').textContent).toBe('http://192.168.1.100:5000');
    });

    it('should show login view when storage is empty', async () => {
        const { window, document } = setupPopupEnv();

        await fireDOMContentLoaded(window);

        const connectedView = document.getElementById('connected-view');
        const loginView = document.getElementById('login-view');
        expect(loginView.classList.contains('hidden')).toBe(false);
        expect(connectedView.classList.contains('hidden')).toBe(true);
    });

    it('should show login view when sid is missing from storage', async () => {
        const { window, document, storage } = setupPopupEnv();

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        // no sid

        await fireDOMContentLoaded(window);

        const loginView = document.getElementById('login-view');
        expect(loginView.classList.contains('hidden')).toBe(false);
    });

    it('should trigger loadDownloads on init when session exists', async () => {
        let taskFetchCalled = false;

        const { window, document, storage } = setupPopupEnv({
            fetchImpl: (url) => {
                if (url.includes('DownloadStation/task.cgi')) {
                    taskFetchCalled = true;
                    return Promise.resolve(jsonResponse({
                        success: true,
                        data: { tasks: [], total: 0, offset: 0 },
                    }));
                }
                return new Promise(() => {});
            },
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        expect(taskFetchCalled).toBe(true);
    });
});

// ─────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────

describe('tab switching', () => {
    it('should switch to QuickConnect tab when clicked', async () => {
        const { window, document } = setupPopupEnv();
        await fireDOMContentLoaded(window);

        const qcTab = [...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'quickconnect');
        qcTab.click();

        const localTab = document.getElementById('local-tab');
        const qcTabContent = document.getElementById('quickconnect-tab');

        expect(qcTabContent.classList.contains('active')).toBe(true);
        expect(localTab.classList.contains('active')).toBe(false);
        expect(qcTab.classList.contains('active')).toBe(true);
    });

    it('should switch back to Local tab', async () => {
        const { window, document } = setupPopupEnv();
        await fireDOMContentLoaded(window);

        // Switch to QC first
        const qcTab = [...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'quickconnect');
        qcTab.click();

        // Switch back to local
        const localTabBtn = [...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'local');
        localTabBtn.click();

        expect(document.getElementById('local-tab').classList.contains('active')).toBe(true);
        expect(document.getElementById('quickconnect-tab').classList.contains('active')).toBe(false);
    });

    it('should clear error message when switching tabs', async () => {
        const { window, document } = setupPopupEnv();
        await fireDOMContentLoaded(window);

        const errorEl = document.getElementById('error');
        errorEl.textContent = 'Some error';

        const qcTab = [...document.querySelectorAll('.tab')].find(t => t.dataset.tab === 'quickconnect');
        qcTab.click();

        expect(errorEl.textContent).toBe('');
    });
});

// ─────────────────────────────────────────────
// OPEN SYNOLOGY BUTTON
// ─────────────────────────────────────────────

describe('open Synology button', () => {
    it('should open the Synology URL in a new tab', async () => {
        const { window, document, storage, browserMock } = setupPopupEnv({
            fetchImpl: healthyServerFetch,
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        document.getElementById('open-synology-btn').click();
        await new Promise((r) => setTimeout(r, 50));

        expect(browserMock.tabs.create).toHaveBeenCalledWith({
            url: 'http://192.168.1.100:5000',
        });
    });
});

// ─────────────────────────────────────────────
// SUCCESSFUL LOGIN FLOW
// ─────────────────────────────────────────────

describe('successful login', () => {
    it('should store credentials and show connected view after local login', async () => {
        const { window, document, storage, browserMock } = setupPopupEnv({
            fetchImpl: healthyServerFetch,
        });

        await fireDOMContentLoaded(window);

        document.getElementById('url').value = 'http://192.168.1.100';
        document.getElementById('port').value = '5000';
        document.getElementById('username').value = 'admin';
        document.getElementById('password').value = 'password123';

        document.getElementById('login-form').dispatchEvent(
            new window.Event('submit', { cancelable: true })
        );
        await new Promise((r) => setTimeout(r, 150));

        expect(browserMock.storage.local.set).toHaveBeenCalledWith({
            synologyUrl: 'http://192.168.1.100:5000',
            username: 'admin',
            sid: 'new-sid-456',
        });

        const connectedView = document.getElementById('connected-view');
        expect(connectedView.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('connected-user').textContent).toBe('admin');
    });
});

// ─────────────────────────────────────────────
// LOGOUT RESETS UI
// ─────────────────────────────────────────────

describe('logout UI reset', () => {
    it('should clear all form fields when returning to login view', async () => {
        const { window, document, storage } = setupPopupEnv({
            fetchImpl: healthyServerFetch,
        });

        storage.synologyUrl = 'http://192.168.1.100:5000';
        storage.username = 'admin';
        storage.sid = 'test-sid-123';

        await fireDOMContentLoaded(window);

        document.getElementById('logout-btn').click();
        await new Promise((r) => setTimeout(r, 100));

        expect(document.getElementById('url').value).toBe('http://');
        expect(document.getElementById('port').value).toBe('5000');
        expect(document.getElementById('username').value).toBe('');
        expect(document.getElementById('password').value).toBe('');
        expect(document.getElementById('qc-id').value).toBe('');
        expect(document.getElementById('qc-username').value).toBe('');
        expect(document.getElementById('qc-password').value).toBe('');
    });
});
