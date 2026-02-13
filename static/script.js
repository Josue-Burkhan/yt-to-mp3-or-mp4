/**
 * YouTube Downloader Client Script
 * Author: Josue-Burkhan
 */
document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('url');
    const fetchInfoBtn = document.getElementById('fetchInfo');
    const optionsDiv = document.getElementById('options');
    const formatSelect = document.getElementById('format');
    const qualitySelect = document.getElementById('quality');
    const qualityContainer = document.getElementById('qualityContainer');
    const downloadBtn = document.getElementById('downloadBtn');
    const statusDiv = document.getElementById('status');
    const thumbnailImg = document.getElementById('thumbnail');
    const videoTitle = document.getElementById('videoTitle');
    const videoDuration = document.getElementById('videoDuration');
    const progressWrap = document.getElementById('progressWrap');
    const progressText = document.getElementById('progressText');
    const progressPercent = document.getElementById('progressPercent');
    const progressFill = document.getElementById('progressFill');
    const progressMeta = document.getElementById('progressMeta');

    // Settings elements
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettings = document.getElementById('closeSettings');
    const saveSettings = document.getElementById('saveSettings');
    const downloadPathInput = document.getElementById('downloadPath');
    const browseBtn = document.getElementById('browseBtn');

    let videoData = null;
    let progressInterval = null;

    // Load settings on startup
    loadSettings();
    startHeartbeat();

    // Toggle Settings Modal
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettings.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    // Close modal if clicking outside content
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });

    // Browse Folder
    browseBtn.addEventListener('click', async () => {
        const originalText = browseBtn.textContent;
        browseBtn.textContent = '⏳';
        browseBtn.disabled = true;

        try {
            const response = await fetch('/api/pick-folder');
            const data = await response.json();

            if (data.path) {
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

    // Save Settings
    saveSettings.addEventListener('click', async () => {
        const newPath = downloadPathInput.value.trim();
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
                downloadPathInput.value = data.path; // Update with resolved path
                settingsModal.classList.add('hidden');
                showStatus(`✅ Download path saved: ${data.path}`, 'success');
                setTimeout(() => {
                    if (statusDiv.textContent.includes('Download path saved')) {
                        statusDiv.classList.add('hidden');
                    }
                }, 3000);
            } else {
                alert(`Error saving settings: ${data.error}`);
            }
        } catch (error) {
            alert(`Failed to save settings: ${error.message}`);
        }
    });

    async function loadSettings() {
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

    fetchInfoBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) {
            showStatus('Please enter a URL', 'error');
            return;
        }

        showStatus('Fetching video info...', 'info');
        optionsDiv.classList.add('hidden');

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch info');
            }

            videoData = await response.json();
            populateOptions();
            optionsDiv.classList.remove('hidden');

            // Show video info
            const previewDiv = document.getElementById('videoPreview');
            if (videoData.thumbnail) {
                thumbnailImg.src = videoData.thumbnail;
                thumbnailImg.classList.remove('hidden');
            }
            videoTitle.textContent = videoData.title || '';
            videoDuration.textContent = videoData.duration ? `Duration: ${videoData.duration}` : '';
            previewDiv.classList.remove('hidden');

            showStatus('Ready to download!', 'success');

        } catch (error) {
            showStatus(`Error: ${error.message}`, 'error');
        }
    });

    formatSelect.addEventListener('change', populateOptions);

    function populateOptions() {
        const format = formatSelect.value;
        qualitySelect.innerHTML = '';

        if (format === 'audio') {
            qualityContainer.classList.add('hidden');
        } else {
            qualityContainer.classList.remove('hidden');
            const qualities = videoData.video_qualities || [];

            // Add qualities from low to high, select highest by default
            qualities.forEach((q, i) => {
                const option = document.createElement('option');
                option.value = q.height;
                option.textContent = q.label;
                if (i === qualities.length - 1) option.selected = true;
                qualitySelect.appendChild(option);
            });
        }
    }

    downloadBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        const format = formatSelect.value;
        const height = qualitySelect.value;

        showStatus('Downloading... this may take a moment ⏳', 'info');
        startProgressPolling();
        downloadBtn.disabled = true;
        downloadBtn.classList.add('opacity-50', 'cursor-not-allowed');

        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format, height: parseInt(height) || null })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Download failed');
            }

            await fetchAndRenderProgress();
            showStatus(`✅ "${data.title}" - ${data.message}`, 'success');

        } catch (error) {
            await fetchAndRenderProgress();
            showStatus(`❌ ${error.message}`, 'error');
        } finally {
            stopProgressPolling();
            downloadBtn.disabled = false;
            downloadBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    });

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        statusDiv.classList.remove('hidden');
    }

    function formatEta(seconds) {
        if (typeof seconds !== 'number' || Number.isNaN(seconds) || seconds < 0) return null;
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    function renderProgress(data) {
        const status = data?.status || 'idle';
        let percent = Number(data?.percent);
        if (!Number.isFinite(percent)) percent = 0;
        percent = Math.max(0, Math.min(100, Math.round(percent)));

        if (status === 'idle') {
            progressWrap.classList.add('hidden');
            return;
        }

        progressWrap.classList.remove('hidden');
        progressFill.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressText.textContent = data?.message || 'Downloading...';

        const meta = [];
        if (data?.downloaded && data?.total) {
            meta.push(`${data.downloaded} / ${data.total}`);
        }
        if (data?.speed) {
            meta.push(data.speed);
        }
        const etaText = formatEta(data?.eta);
        if (etaText) {
            meta.push(`ETA ${etaText}`);
        }
        progressMeta.textContent = meta.join(' • ');
    }

    async function fetchAndRenderProgress() {
        try {
            const response = await fetch('/api/progress');
            if (!response.ok) return;
            const data = await response.json();
            renderProgress(data);
        } catch (_) {
            // Ignore progress fetch errors
        }
    }

    function startProgressPolling() {
        stopProgressPolling();
        progressWrap.classList.remove('hidden');
        progressFill.style.width = '0%';
        progressPercent.textContent = '0%';
        progressText.textContent = 'Starting download...';
        progressMeta.textContent = '';
        fetchAndRenderProgress();
        progressInterval = setInterval(fetchAndRenderProgress, 1000);
    }

    function stopProgressPolling() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
    }

    function startHeartbeat() {
        setInterval(() => {
            fetch('/api/heartbeat', {
                method: 'POST',
                keepalive: true
            }).catch(() => {
                // Ignore errors (server might be down)
            });
        }, 2000);
    }
});
