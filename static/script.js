/**
 * YouTube Downloader Client Script
 * Author: Josue-Burkhan
 */
document.addEventListener('DOMContentLoaded', () => {
    // Prevent duplicate bootstraps if the script is injected/loaded twice.
    if (window.__ytDownloaderUiBooted) {
        return;
    }
    window.__ytDownloaderUiBooted = true;

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    const saveSettings = document.getElementById('saveSettings');
    const downloadPathInput = document.getElementById('downloadPath');
    const browseBtn = document.getElementById('browseBtn');

    let addUrlBtn = document.getElementById('addUrlBtn');
    let downloadsList = document.getElementById('downloadsList');
    const downloadItemTemplate = document.getElementById('downloadItemTemplate');

    const items = new Map();
    let itemCount = 0;
    let tasksPollingInterval = null;

    const fallbackItemMarkup = `
        <div class="download-item">
            <div class="download-item-header hidden">
                <div class="download-item-title-wrap">
                    <span class="download-item-title">New download</span>
                    <span class="download-item-badge hidden">Ready</span>
                </div>
                <button type="button" class="btn btn-toggle hidden">Expand</button>
            </div>
            <div class="download-item-summary hidden"></div>
            <div class="download-item-body">
                <div class="input-group">
                    <label>YouTube URL</label>
                    <div class="input-row">
                        <input type="text" class="url-input" placeholder="https://www.youtube.com/watch?v=...">
                        <button type="button" class="btn btn-primary fetch-info-btn">Fetch</button>
                        <button type="button" class="btn btn-danger remove-item-btn" title="Remove item">✕</button>
                    </div>
                </div>
                <div class="video-preview hidden">
                    <img class="thumbnail hidden" alt="Thumbnail">
                    <div class="video-meta">
                        <p class="video-title"></p>
                        <p class="video-duration"></p>
                    </div>
                </div>
                <div class="options-row hidden">
                    <div class="input-group">
                        <label>Format</label>
                        <select class="format-select">
                            <option value="video">🎬 Video (MP4)</option>
                            <option value="audio">🎵 Audio (MP3)</option>
                        </select>
                    </div>
                    <div class="input-group quality-group">
                        <label>Quality</label>
                        <select class="quality-select">
                            <option value="">Auto</option>
                        </select>
                    </div>
                </div>
                <button type="button" class="btn btn-download download-btn hidden">⬇ Download</button>
                <div class="status hidden"></div>
                <div class="progress-wrap hidden">
                    <div class="progress-header">
                        <span class="progress-text">Downloading...</span>
                        <span class="progress-percent">0%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill"></div>
                    </div>
                    <div class="progress-meta"></div>
                </div>
            </div>
        </div>
    `;

    ensureMultiUiScaffold();
    if (!downloadsList) {
        console.error('Could not initialize multi-download UI');
        return;
    }

    initSettingsEvents();
    loadSettings();
    startHeartbeat();

    if (!downloadsList.querySelector('.download-item')) {
        addDownloadItem();
    }

    if (addUrlBtn) {
        addUrlBtn.addEventListener('click', () => addDownloadItem());
    }

    function ensureMultiUiScaffold() {
        const card = document.querySelector('.card');
        if (!card) return;

        // Remove leftover legacy single-download blocks if present.
        const legacyUrlInput = document.getElementById('url');
        if (legacyUrlInput) {
            const legacyGroup = legacyUrlInput.closest('.input-group');
            if (legacyGroup) legacyGroup.remove();
            legacyUrlInput.remove();
        }

        ['videoPreview', 'options', 'status', 'progressWrap'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        let toolbarRow = addUrlBtn?.closest('.toolbar-row') || null;

        const listNodes = document.querySelectorAll('#downloadsList');
        if (listNodes.length > 1) {
            listNodes.forEach((node, index) => {
                if (index > 0) node.remove();
            });
            downloadsList = listNodes[0];
        }

        if (!downloadsList) {
            downloadsList = document.createElement('div');
            downloadsList.id = 'downloadsList';
            downloadsList.className = 'downloads-list';

            const settingsModalNode = document.getElementById('settingsModal');
            if (settingsModalNode && settingsModalNode.parentNode === card) {
                card.insertBefore(downloadsList, settingsModalNode);
            } else {
                card.appendChild(downloadsList);
            }
        }

        // Remove stale non-managed download nodes from older UI revisions.
        Array.from(downloadsList.children).forEach((child) => {
            if (!child.dataset?.itemId) {
                child.remove();
            }
        });

        if (!addUrlBtn) {
            toolbarRow = document.createElement('div');
            toolbarRow.className = 'toolbar-row';

            addUrlBtn = document.createElement('button');
            addUrlBtn.id = 'addUrlBtn';
            addUrlBtn.type = 'button';
            addUrlBtn.className = 'btn btn-primary btn-add-url';
            addUrlBtn.textContent = '+ Add URL';

            toolbarRow.appendChild(addUrlBtn);
            card.appendChild(toolbarRow);
        }

        const addButtons = document.querySelectorAll('#addUrlBtn');
        if (addButtons.length > 1) {
            addButtons.forEach((btn, index) => {
                if (index > 0) btn.closest('.toolbar-row')?.remove();
            });
            addUrlBtn = addButtons[0];
        }

        if (!toolbarRow && addUrlBtn) {
            toolbarRow = addUrlBtn.closest('.toolbar-row');
        }

        if (downloadsList && toolbarRow && toolbarRow.parentNode === card && downloadsList.parentNode === card) {
            if (downloadsList.nextElementSibling !== toolbarRow) {
                downloadsList.insertAdjacentElement('afterend', toolbarRow);
            }
        }
    }

    function initSettingsEvents() {
        settingsBtn?.addEventListener('click', () => {
            settingsModal?.classList.remove('hidden');
        });

        closeSettings?.addEventListener('click', () => {
            settingsModal?.classList.add('hidden');
        });

        settingsModal?.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });

        browseBtn?.addEventListener('click', async () => {
            const originalText = browseBtn.textContent;
            browseBtn.textContent = '⏳';
            browseBtn.disabled = true;

            try {
                const response = await fetch('/api/pick-folder');
                const data = await response.json();

                if (data.path && downloadPathInput) {
                    downloadPathInput.value = data.path;
                } else if (data.error && data.error !== 'No folder selected') {
                    alert(`Error: ${data.error}`);
                }
            } catch (error) {
                console.error('Failed to pick folder:', error);
            } finally {
                browseBtn.textContent = originalText;
                browseBtn.disabled = false;
            }
        });

        saveSettings?.addEventListener('click', async () => {
            const newPath = downloadPathInput?.value?.trim();
            if (!newPath) {
                alert('Please enter a valid path');
                return;
            }

            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: newPath })
                });
                const data = await response.json();

                if (response.ok) {
                    if (downloadPathInput) {
                        downloadPathInput.value = data.path;
                    }
                    settingsModal?.classList.add('hidden');
                } else {
                    alert(`Error saving settings: ${data.error}`);
                }
            } catch (error) {
                alert(`Failed to save settings: ${error.message}`);
            }
        });
    }

    async function loadSettings() {
        if (!downloadPathInput) return;
        try {
            const response = await fetch('/api/settings');
            const data = await response.json();
            if (data.download_path) {
                downloadPathInput.value = data.download_path;
            }
        } catch (error) {
            console.error('Failed to load settings', error);
        }
    }

    function createDownloadItemNode() {
        if (downloadItemTemplate?.content?.firstElementChild) {
            return downloadItemTemplate.content.firstElementChild.cloneNode(true);
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = fallbackItemMarkup.trim();
        return wrapper.firstElementChild;
    }

    function addDownloadItem(prefillUrl = '') {
        if (!downloadsList) return;

        itemCount += 1;
        const node = createDownloadItemNode();
        if (!node) {
            console.error('Could not create download node');
            return;
        }

        const refs = {
            header: node.querySelector('.download-item-header'),
            title: node.querySelector('.download-item-title'),
            badge: node.querySelector('.download-item-badge'),
            toggleBtn: node.querySelector('.btn-toggle'),
            summary: node.querySelector('.download-item-summary'),
            body: node.querySelector('.download-item-body'),
            urlInput: node.querySelector('.url-input'),
            fetchInfoBtn: node.querySelector('.fetch-info-btn'),
            removeBtn: node.querySelector('.remove-item-btn'),
            preview: node.querySelector('.video-preview'),
            thumbnail: node.querySelector('.thumbnail'),
            videoTitle: node.querySelector('.video-title'),
            videoDuration: node.querySelector('.video-duration'),
            optionsRow: node.querySelector('.options-row'),
            formatSelect: node.querySelector('.format-select'),
            qualityGroup: node.querySelector('.quality-group'),
            qualitySelect: node.querySelector('.quality-select'),
            downloadBtn: node.querySelector('.download-btn'),
            status: node.querySelector('.status'),
            progressWrap: node.querySelector('.progress-wrap'),
            progressText: node.querySelector('.progress-text'),
            progressPercent: node.querySelector('.progress-percent'),
            progressFill: node.querySelector('.progress-fill'),
            progressMeta: node.querySelector('.progress-meta')
        };

        const required = ['header', 'title', 'badge', 'toggleBtn', 'summary', 'body', 'urlInput', 'fetchInfoBtn', 'removeBtn', 'preview', 'thumbnail', 'videoTitle', 'videoDuration', 'optionsRow', 'formatSelect', 'qualityGroup', 'qualitySelect', 'downloadBtn', 'status', 'progressWrap', 'progressText', 'progressPercent', 'progressFill', 'progressMeta'];
        const missing = required.find((key) => !refs[key]);
        if (missing) {
            console.error(`Missing template element: ${missing}`);
            return;
        }

        const id = `item-${Date.now()}-${itemCount}`;
        node.dataset.itemId = id;

        const state = {
            id,
            element: node,
            refs,
            taskId: null,
            videoData: null,
            collapsed: false,
            autoCollapsed: false,
            lastTask: null
        };

        refs.title.textContent = 'New download';
        refs.urlInput.value = prefillUrl;
        setAdvancedControlsVisible(state, false);
        setHeaderVisible(state, false);
        clearItemStatus(state);
        clearProgress(state);
        setStatusBadge(state, null, null);

        refs.fetchInfoBtn.addEventListener('click', () => fetchVideoInfo(state));
        refs.downloadBtn.addEventListener('click', () => startDownload(state));
        refs.formatSelect.addEventListener('change', () => populateQualityOptions(state));
        refs.removeBtn.addEventListener('click', () => removeDownloadItem(state));
        refs.toggleBtn.addEventListener('click', () => setCollapsed(state, !state.collapsed));

        downloadsList.appendChild(node);
        items.set(id, state);

        populateQualityOptions(state);
    }

    function removeDownloadItem(state) {
        if (state.lastTask && ['pending', 'downloading', 'processing'].includes(state.lastTask.status)) {
            setItemStatus(state, 'This download is currently running. Wait until it finishes.', 'error');
            return;
        }

        items.delete(state.id);
        state.element.remove();

        if (items.size === 0) {
            addDownloadItem();
        }
    }

    function setAdvancedControlsVisible(state, visible) {
        state.refs.optionsRow.classList.toggle('hidden', !visible);
        state.refs.downloadBtn.classList.toggle('hidden', !visible);
    }

    function setHeaderVisible(state, visible) {
        state.refs.header.classList.toggle('hidden', !visible);
    }

    function setStatusBadge(state, status, text) {
        if (!status || !text) {
            state.refs.badge.className = 'download-item-badge hidden';
            state.refs.badge.textContent = '';
            return;
        }

        state.refs.badge.textContent = text;
        state.refs.badge.className = `download-item-badge status-${status}`;
    }

    function setItemStatus(state, message, type) {
        state.refs.status.textContent = message;
        state.refs.status.className = `status ${type}`;
        state.refs.status.classList.remove('hidden');
    }

    function clearItemStatus(state) {
        state.refs.status.classList.add('hidden');
        state.refs.status.textContent = '';
    }

    function shortTitle(text) {
        const value = (text || '').trim();
        if (!value) return 'New download';
        return value.length > 72 ? `${value.slice(0, 69)}...` : value;
    }

    function populateQualityOptions(state) {
        const { formatSelect, qualityGroup, qualitySelect } = state.refs;
        qualitySelect.innerHTML = '';

        if (formatSelect.value === 'audio') {
            qualityGroup.classList.add('hidden');
            return;
        }

        qualityGroup.classList.remove('hidden');

        const qualities = state.videoData?.video_qualities || [];
        if (!qualities.length) {
            const fallback = document.createElement('option');
            fallback.value = '';
            fallback.textContent = 'Auto';
            qualitySelect.appendChild(fallback);
            return;
        }

        qualities.forEach((quality, index) => {
            const option = document.createElement('option');
            option.value = quality.height;
            option.textContent = quality.label;
            if (index === qualities.length - 1) option.selected = true;
            qualitySelect.appendChild(option);
        });
    }

    function renderPreview(state, data) {
        if (data.thumbnail) {
            state.refs.thumbnail.src = data.thumbnail;
            state.refs.thumbnail.classList.remove('hidden');
        } else {
            state.refs.thumbnail.classList.add('hidden');
        }

        state.refs.videoTitle.textContent = data.title || '';
        state.refs.videoDuration.textContent = data.duration ? `Duration: ${data.duration}` : '';
        state.refs.preview.classList.remove('hidden');
    }

    async function fetchVideoInfo(state) {
        const url = state.refs.urlInput.value.trim();
        if (!url) {
            setItemStatus(state, 'Enter a URL', 'error');
            return;
        }

        state.refs.fetchInfoBtn.disabled = true;
        clearItemStatus(state);
        setItemStatus(state, 'Fetching video information...', 'info');

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Could not fetch video information');
            }

            state.videoData = data;
            state.refs.title.textContent = shortTitle(data.title);
            setHeaderVisible(state, true);
            renderPreview(state, data);
            populateQualityOptions(state);
            setAdvancedControlsVisible(state, true);
            setItemStatus(state, 'Information loaded. Choose format and quality.', 'success');
        } catch (error) {
            setItemStatus(state, `Error: ${error.message}`, 'error');
            setAdvancedControlsVisible(state, false);
        } finally {
            state.refs.fetchInfoBtn.disabled = false;
        }
    }

    function clearProgress(state) {
        state.refs.progressWrap.classList.add('hidden');
        state.refs.progressText.textContent = 'Downloading...';
        state.refs.progressPercent.textContent = '0%';
        state.refs.progressFill.style.width = '0%';
        state.refs.progressMeta.textContent = '';
    }

    function formatEta(seconds) {
        if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return null;
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    function renderProgress(state, task) {
        if (!task || typeof task !== 'object') return;

        const statusesWithProgress = ['pending', 'downloading', 'processing', 'success'];
        if (!statusesWithProgress.includes(task.status)) {
            state.refs.progressWrap.classList.add('hidden');
            return;
        }

        const percentValue = Number(task.percent);
        const percent = Number.isFinite(percentValue) ? Math.max(0, Math.min(100, Math.round(percentValue))) : 0;

        state.refs.progressWrap.classList.remove('hidden');
        state.refs.progressText.textContent = task.message || 'Downloading...';
        state.refs.progressPercent.textContent = `${percent}%`;
        state.refs.progressFill.style.width = `${percent}%`;

        const meta = [];
        if (task.downloaded && task.total) meta.push(`${task.downloaded} / ${task.total}`);
        if (task.speed) meta.push(task.speed);
        const eta = formatEta(task.eta);
        if (eta) meta.push(`ETA ${eta}`);

        state.refs.progressMeta.textContent = meta.join(' • ');
    }

    function setInputsDisabled(state, disabled) {
        state.refs.urlInput.disabled = disabled;
        state.refs.fetchInfoBtn.disabled = disabled;
        state.refs.formatSelect.disabled = disabled;
        state.refs.qualitySelect.disabled = disabled;
        state.refs.downloadBtn.disabled = disabled;
        state.refs.removeBtn.disabled = disabled;
    }

    function setCollapsed(state, collapsed) {
        state.collapsed = collapsed;
        state.refs.body.classList.toggle('hidden', collapsed);

        if (collapsed) {
            state.refs.toggleBtn.textContent = 'Expand';
            if (state.lastTask?.status === 'success') {
                const title = state.lastTask.title || state.refs.videoTitle.textContent || state.refs.urlInput.value;
                state.refs.summary.textContent = `✅ Downloaded: ${title}`;
                state.refs.summary.classList.remove('hidden');
            } else if (state.lastTask?.status === 'error') {
                const err = state.lastTask.error || state.lastTask.message || 'Download failed';
                state.refs.summary.textContent = `❌ Error: ${err}`;
                state.refs.summary.classList.remove('hidden');
            }
        } else {
            state.refs.toggleBtn.textContent = 'Minimize';
            state.refs.summary.classList.add('hidden');
        }
    }

    function updateFromTask(state, task) {
        if (!task || typeof task !== 'object') return;

        state.lastTask = task;
        setHeaderVisible(state, true);

        if (task.title) {
            state.refs.title.textContent = shortTitle(task.title);
        }

        renderProgress(state, task);

        switch (task.status) {
            case 'pending':
                setStatusBadge(state, 'pending', 'Queued');
                setItemStatus(state, task.message || 'Queued...', 'info');
                setInputsDisabled(state, true);
                state.refs.toggleBtn.classList.add('hidden');
                break;
            case 'downloading':
                setStatusBadge(state, 'downloading', 'Downloading');
                setItemStatus(state, task.message || 'Downloading...', 'info');
                setInputsDisabled(state, true);
                state.refs.toggleBtn.classList.add('hidden');
                break;
            case 'processing':
                setStatusBadge(state, 'processing', 'Processing');
                setItemStatus(state, task.message || 'Processing...', 'info');
                setInputsDisabled(state, true);
                state.refs.toggleBtn.classList.add('hidden');
                break;
            case 'success':
                setStatusBadge(state, 'success', 'Completed');
                setItemStatus(state, `✅ ${task.message || 'Downloaded successfully'}`, 'success');
                setInputsDisabled(state, false);
                state.refs.toggleBtn.classList.remove('hidden');
                if (!state.autoCollapsed) {
                    setCollapsed(state, true);
                    state.autoCollapsed = true;
                }
                break;
            case 'error':
                setStatusBadge(state, 'error', 'Error');
                setItemStatus(state, `❌ ${task.error || task.message || 'Download failed'}`, 'error');
                setInputsDisabled(state, false);
                state.refs.toggleBtn.classList.remove('hidden');
                if (state.collapsed) {
                    setCollapsed(state, true);
                } else {
                    state.refs.toggleBtn.textContent = 'Minimize';
                }
                break;
            default:
                setStatusBadge(state, null, null);
                clearItemStatus(state);
                setInputsDisabled(state, false);
                state.refs.toggleBtn.classList.add('hidden');
        }
    }

    async function startDownload(state) {
        const url = state.refs.urlInput.value.trim();
        if (!url) {
            setItemStatus(state, 'Enter a URL', 'error');
            return;
        }

        const format = state.refs.formatSelect.value;
        const qualityValue = state.refs.qualitySelect.value;

        let height = null;
        if (format === 'video' && qualityValue) {
            const parsed = Number.parseInt(qualityValue, 10);
            height = Number.isFinite(parsed) ? parsed : null;
        }

        setInputsDisabled(state, true);
        clearProgress(state);
        setItemStatus(state, 'Queueing download...', 'info');
        setHeaderVisible(state, true);
        setAdvancedControlsVisible(state, true);
        state.autoCollapsed = false;
        setCollapsed(state, false);

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format, height })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Download failed');
            }

            state.taskId = data.task_id || null;

            if (!state.taskId) {
                if (data.success) {
                    setStatusBadge(state, 'success', 'Completed');
                    setItemStatus(state, `✅ ${data.message || 'Downloaded successfully'}`, 'success');
                    setInputsDisabled(state, false);
                    state.refs.toggleBtn.classList.remove('hidden');
                    setCollapsed(state, true);
                    state.autoCollapsed = true;
                    return;
                }
                throw new Error('Invalid server response');
            }

            if (data.task && typeof data.task === 'object') {
                updateFromTask(state, data.task);
            } else {
                updateFromTask(state, { status: 'pending', message: 'Queued...', percent: 0 });
            }

            ensureTasksPolling();
        } catch (error) {
            setItemStatus(state, `❌ ${error.message}`, 'error');
            setInputsDisabled(state, false);
        }
    }

    async function pollTasks() {
        const tracked = Array.from(items.values()).filter((state) => !!state.taskId);
        if (!tracked.length) {
            stopTasksPolling();
            return;
        }

        try {
            const response = await fetch('/api/tasks');
            if (!response.ok) return;

            const data = await response.json();
            const tasks = Array.isArray(data.tasks) ? data.tasks : [];
            const tasksById = new Map(tasks.map((task) => [task.id, task]));

            let hasActive = false;

            tracked.forEach((state) => {
                const task = tasksById.get(state.taskId);
                if (!task) return;
                updateFromTask(state, task);
                if (['pending', 'downloading', 'processing'].includes(task.status)) {
                    hasActive = true;
                }
            });

            if (!hasActive) {
                stopTasksPolling();
            }
        } catch (_) {
            // Ignore temporary connection errors
        }
    }

    function ensureTasksPolling() {
        if (tasksPollingInterval) return;
        pollTasks();
        tasksPollingInterval = setInterval(pollTasks, 1000);
    }

    function stopTasksPolling() {
        if (!tasksPollingInterval) return;
        clearInterval(tasksPollingInterval);
        tasksPollingInterval = null;
    }

    function startHeartbeat() {
        setInterval(() => {
            fetch('/api/heartbeat', {
                method: 'POST',
                keepalive: true
            }).catch(() => {
                // Ignore heartbeat failures if backend is restarting
            });
        }, 2000);
    }
});
