// Popup Logic
// import { CONFIG } from './config.js'; // Loaded via script tag

// Initialize I18n
const i18n = new I18n();

document.addEventListener('DOMContentLoaded', async () => {
    // Start I18n
    await i18n.init();

    const downloadBtn = document.getElementById('downloadBtn');
    const stopBtn = document.getElementById('stopBtn');
    const supportBtn = document.getElementById('supportBtn');
    const progressBox = document.getElementById('progressBox');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const licenseSection = document.getElementById('licenseSection');
    const licenseKeyInput = document.getElementById('licenseKey');
    const verifyBtn = document.getElementById('verifyBtn');
    const statusDiv = document.getElementById('status');
    const licenseVerifiedBadge = document.getElementById('licenseVerifiedBadge');
    const logArea = document.getElementById('logArea');
    const fetchVisitSiteCheckbox = document.getElementById('fetchVisitSite');

    let watchdogTimer = null;

    // Helper: Add Log
    function addLog(message) {
        if (!logArea) return;
        const div = document.createElement('div');
        div.innerText = `> ${message}`;
        div.style.marginBottom = '4px';
        logArea.appendChild(div);
        logArea.scrollTop = logArea.scrollHeight;
    }

    // Helper: Set Watchdog
    function petWatchdog() {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        watchdogTimer = setTimeout(() => {
            addLog('⚠️ No progress usage detected for 30s. Process might be stuck.');
            statusDiv.innerText = 'Timeout: Please refresh page and try again.';
            stopBtn.classList.add('hidden');
            downloadBtn.classList.remove('hidden');
            downloadBtn.disabled = false;
        }, 30000); // 30 seconds
    }

    function clearWatchdog() {
        if (watchdogTimer) clearTimeout(watchdogTimer);
    }

    // Check Status
    const storage = await chrome.storage.local.get([CONFIG.STORAGE_KEYS.PRO_STATUS, CONFIG.STORAGE_KEYS.LICENSE_KEY]);
    const isPro = storage[CONFIG.STORAGE_KEYS.PRO_STATUS];

    updateUI(isPro);

    if (isPro && licenseKeyInput && storage[CONFIG.STORAGE_KEYS.LICENSE_KEY]) {
        licenseKeyInput.value = storage[CONFIG.STORAGE_KEYS.LICENSE_KEY];
    }

    // Verify Handler
    if (verifyBtn) {
        verifyBtn.addEventListener('click', () => {
            const key = licenseKeyInput ? licenseKeyInput.value.trim() : '';
            if (!key) return;

            verifyBtn.innerText = 'Verifying...';
            verifyBtn.disabled = true;

            chrome.runtime.sendMessage({ action: 'VERIFY_LICENSE', licenseKey: key }, (response) => {
                if (verifyBtn) { // Double check
                    verifyBtn.innerText = 'Verify License';
                    verifyBtn.disabled = false;
                }

                if (response && response.success) {
                    addLog('License verified successfully!');
                    updateUI(true);
                } else {
                    if (statusDiv) {
                        statusDiv.style.color = '#ff7676';
                        statusDiv.innerText = response.message || 'Verification failed';
                    }
                    addLog('Verification failed: ' + response.message);
                    updateUI(false);
                }
            });
        });
    } else {
        console.error('Verify button not found');
    }

    // Download Handler
    if (downloadBtn) {
        downloadBtn.addEventListener('click', async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !tab.url) return;

                // 1. Validation Logic
                const url = new URL(tab.url);
                if (!url.hostname.includes('pinterest')) {
                    if (statusDiv) statusDiv.innerText = 'Please go to a Pinterest Board first.';
                    return;
                }
                // ... validation ...

                // 2. Reset UI
                if (progressBox) {
                    progressBox.classList.remove('hidden');
                    progressBox.classList.add('visible');
                }
                if (stopBtn) stopBtn.classList.remove('hidden');
                downloadBtn.classList.add('hidden');
                if (progressBar) progressBar.value = 0;
                if (progressText) progressText.innerText = '0%';
                if (logArea) logArea.innerText = '';
                addLog('Initializing scanner...');
                if (statusDiv) statusDiv.innerText = '';

                // 3. Stop -> Start
                chrome.tabs.sendMessage(tab.id, { action: 'STOP_DOWNLOAD' }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }

                    setTimeout(() => {
                        petWatchdog();

                        chrome.runtime.sendMessage({
                            action: 'START_DOWNLOAD',
                            tabId: tab.id,
                            shouldFetchVisitSite: fetchVisitSiteCheckbox ? fetchVisitSiteCheckbox.checked : false
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error('Start error:', chrome.runtime.lastError);
                                if (statusDiv) statusDiv.innerText = 'Error: Refresh Page & Retry';
                                addLog('Error: ' + chrome.runtime.lastError.message);
                                clearWatchdog();
                            } else if (response && response.status === 'error') {
                                if (statusDiv) statusDiv.innerText = 'Error: Refresh Page';
                                addLog('Error: ' + response.message);
                                if (downloadBtn) downloadBtn.classList.remove('hidden');
                                if (stopBtn) stopBtn.classList.add('hidden');
                                clearWatchdog();
                            }
                        });
                    }, 500);
                });

            } catch (e) {
                console.error(e);
                addLog('Critical Error: ' + e.message);
            }
        });
    }

    // Stop Handler
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'STOP_DOWNLOAD' });
            addLog('Process stopped by user.');
            stopBtn.classList.add('hidden');
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            clearWatchdog();
        });
    }

    // Support Handler
    if (supportBtn) {
        supportBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: "https://tawk.to/pinvaultpro"
            });
        });
    }

    // Listen for Progress Updates
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'PROGRESS_UPDATE') {
            petWatchdog(); // Reset watchdog on activity!

            progressBox.classList.remove('hidden');
            progressBox.classList.add('visible');
            stopBtn.classList.remove('hidden');
            downloadBtn.classList.add('hidden');

            addLog(msg.status);

            if (msg.total > 0) {
                progressBar.max = msg.total;
                progressBar.value = msg.current;
                const pct = Math.round((msg.current / msg.total) * 100);
                progressText.innerText = `${pct}%`;
            } else {
                progressBar.removeAttribute('value');
                progressText.innerText = 'Scanning...';
            }

        } else if (msg.action === 'DOWNLOAD_COMPLETE') {
            clearWatchdog();
            addLog('All downloads completed!');

            if (msg.limitApplied) {
                statusDiv.innerHTML = `Done! <span style="color:#e60023">${i18n.getMessage('freeLimitReached')}</span>`;
                addLog(i18n.getMessage('freeLimitReached'));
                addLog(i18n.getMessage('upgradeToPro'));

                // Show Upsell in Log
                const link = document.createElement('a');
                link.href = "https://inyogeshwar.gumroad.com/l/pinvault-pro";
                link.target = "_blank";
                link.style.color = "#00ac47";
                link.style.fontWeight = "bold";
                link.innerText = ">> GET PRO LICENSE <<";
                logArea.appendChild(link);
            } else {
                statusDiv.innerText = i18n.getMessage('filesSaved', { count: msg.count || '' });
                statusDiv.style.color = '#00ac47';
            }

            stopBtn.classList.add('hidden');
            if (downloadBtn) downloadBtn.classList.remove('hidden');
            if (progressBar) progressBar.value = 100;
            if (progressText) progressText.innerText = '100%';
        }
    });

    function updateUI(isProUser) {
        if (isProUser) {
            if (licenseVerifiedBadge) licenseVerifiedBadge.classList.remove('hidden');
            if (licenseSection) licenseSection.classList.add('hidden');
        } else {
            if (licenseVerifiedBadge) licenseVerifiedBadge.classList.add('hidden');
            if (licenseSection) licenseSection.classList.remove('hidden');
        }
    }
});
