// Classic Service Worker
importScripts('config.js'); // Load Configuration
importScripts('lib/xlsx.full.min.js'); // Load Excel Lib

// Decode the Obfuscated Product ID
// Uses standard Base64 decoding
const DECODED_PRODUCT_ID = atob(CONFIG.GUMROAD.PRODUCT_ID);

let downloadQueue = [];
let isDownloading = false;
let currentJob = null; // { pins, boardName, processed, excelData }

// License Verification (Keep existing implementation)
// ... [Previous License Logic Codes should be here, assuming I append or rewrite]
// I will REWRITE the whole file to include everything.

// -----------------------------------------------------------------------------
// LICENSE LOGIC
// -----------------------------------------------------------------------------

async function verifyLicense(licenseKey) {
    try {
        const response = await fetch(CONFIG.GUMROAD.VERIFY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                product_id: DECODED_PRODUCT_ID,
                license_key: licenseKey,
                increment_uses_count: 'false'
            })
        });

        const data = await response.json();

        if (data.success && !data.purchase.refunded && !data.purchase.disputed &&
            !data.purchase.subscription_cancelled_at && !data.purchase.subscription_failed_at) {

            const verificationData = {
                [CONFIG.STORAGE_KEYS.PRO_STATUS]: true,
                [CONFIG.STORAGE_KEYS.LICENSE_KEY]: licenseKey,
                [CONFIG.STORAGE_KEYS.LAST_VERIFIED]: Date.now()
            };

            await chrome.storage.local.set(verificationData);
            return { success: true };
        } else {
            await chrome.storage.local.set({ [CONFIG.STORAGE_KEYS.PRO_STATUS]: false });
            return { success: false, message: 'Invalid or expired license.' };
        }
    } catch (error) {
        console.error('License check failed:', error);
        return { success: false, message: 'Network error during verification.' };
    }
}

// 72-Hour Re-verification Check
async function checkLicenseValidity() {
    const data = await chrome.storage.local.get([
        CONFIG.STORAGE_KEYS.PRO_STATUS,
        CONFIG.STORAGE_KEYS.LICENSE_KEY,
        CONFIG.STORAGE_KEYS.LAST_VERIFIED
    ]);

    if (data[CONFIG.STORAGE_KEYS.PRO_STATUS] && data[CONFIG.STORAGE_KEYS.LICENSE_KEY]) {
        const hoursSinceCheck = (Date.now() - (data[CONFIG.STORAGE_KEYS.LAST_VERIFIED] || 0)) / (1000 * 60 * 60);

        if (hoursSinceCheck > CONFIG.LIMITS.REVERIFY_HOURS) {
            console.log('Re-verifying license...');
            await verifyLicense(data[CONFIG.STORAGE_KEYS.LICENSE_KEY]);
        }
    }
}

chrome.alarms.create('licenseCheck', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'licenseCheck') {
        checkLicenseValidity();
    }
});

// -----------------------------------------------------------------------------
// DOWNLOAD LOGIC
// -----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'VERIFY_LICENSE') {
        verifyLicense(request.licenseKey).then(sendResponse);
        return true;
    } else if (request.action === 'START_DOWNLOAD') {
        const tabId = request.tabId;

        // Safety wrapper to ensure response is valid
        let responseSent = false;
        const safeSendResponse = (resp) => {
            if (!responseSent) {
                responseSent = true;
                sendResponse(resp);
            }
        };

        if (tabId) {
            // Attempt 1: Send Message
            chrome.tabs.sendMessage(tabId, { action: 'START_DOWNLOAD' }, (response) => {
                const lastError = chrome.runtime.lastError; // Read immediately

                if (lastError) {
                    console.log('Main connection failed. Injecting...', lastError.message);

                    try {
                        chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            files: ['content.js']
                        }, () => {
                            const injectError = chrome.runtime.lastError;
                            if (injectError) {
                                safeSendResponse({ status: 'error', message: 'Script injection failed: ' + injectError.message });
                            } else {
                                // Retry Message
                                setTimeout(() => {
                                    chrome.tabs.sendMessage(tabId, { action: 'START_DOWNLOAD' }, (retryResponse) => {
                                        const retryError = chrome.runtime.lastError;
                                        if (retryError) {
                                            safeSendResponse({ status: 'error', message: 'Retry connection failed: ' + retryError.message });
                                        } else {
                                            safeSendResponse(retryResponse || { status: 'unknown' });
                                        }
                                    });
                                }, 500);
                            }
                        });
                    } catch (e) {
                        safeSendResponse({ status: 'error', message: 'Script execution exception: ' + e.message });
                    }
                } else {
                    safeSendResponse(response || { status: 'unknown' });
                }
            });
        } else {
            safeSendResponse({ status: 'error', message: 'No active tab' });
        }
        return true; // Keep channel open
    } else if (request.action === 'STOP_DOWNLOAD') {
        isDownloading = false;
        currentJob = null;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_DOWNLOAD' }, () => {
                    const ignored = chrome.runtime.lastError;
                    sendResponse({ status: 'stopped' });
                });
            } else {
                sendResponse({ status: 'stopped' });
            }
        });
        return true;
    } else if (request.action === 'SCRAPING_COMPLETE') {
        handleScrapingComplete(request.pins, request.boardName);
    }
});

async function handleScrapingComplete(pins, boardName) {
    // Check Limits
    const storage = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.PRO_STATUS);
    const isPro = storage[CONFIG.STORAGE_KEYS.PRO_STATUS];

    let finalPins = pins;
    if (!isPro && pins.length > CONFIG.LIMITS.FREE_PIN_LIMIT) {
        finalPins = pins.slice(0, CONFIG.LIMITS.FREE_PIN_LIMIT);
        console.log(`Free limit applied: Restricted to ${CONFIG.LIMITS.FREE_PIN_LIMIT} pins.`);
    }

    isDownloading = true;
    const limitApplied = (!isPro && pins.length > CONFIG.LIMITS.FREE_PIN_LIMIT);

    currentJob = {
        pins: finalPins,
        boardName: boardName,
        processed: 0,
        excelData: [],
        limitApplied: limitApplied
    };

    processDownloadQueue();
}

async function processDownloadQueue() {
    if (!isDownloading || !currentJob || currentJob.processed >= currentJob.pins.length) {
        finishDownloadJob();
        return;
    }

    const pin = currentJob.pins[currentJob.processed];
    const filename = `${currentJob.boardName}/${pin.section}/${pin.filename}`;

    try {
        const downloadId = await chrome.downloads.download({
            url: pin.imgUrl,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false
        });

        // Metadata for Excel
        currentJob.excelData.push({
            'Board Name': currentJob.boardName,
            'Section Name': pin.section,
            'Title/Description': pin.title || 'Pinterest Image',
            'Original Page': pin.pinLink || '',
            'Visit Site Link': pin.visitLink || '',
            'Image URL': pin.imgUrl,
            'Local Path': filename,
            'Download Time': new Date().toISOString()
        });

        currentJob.processed++;

        // Update Popup (Safely)
        chrome.runtime.sendMessage({
            action: 'PROGRESS_UPDATE',
            status: `Downloading ${currentJob.processed} / ${currentJob.pins.length}`,
            current: currentJob.processed,
            total: currentJob.pins.length
        }).catch(() => {
            // Popup is closed, ignore error
        });

        // Trottle
        setTimeout(processDownloadQueue, 500);

    } catch (err) {
        console.error('Download failed for', pin.imgUrl, err);
        currentJob.processed++; // Skip and continue
        processDownloadQueue();
    }
}

function finishDownloadJob() {
    if (!currentJob) return;

    isDownloading = false;
    console.log('Job Finished. Generating Excel...');

    // Generate Excel
    try {
        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.json_to_sheet(currentJob.excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Pins");

            // Write to buffer
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

            // Download Excel
            const uri = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + wbout;
            chrome.downloads.download({
                url: uri,
                filename: `${currentJob.boardName}/${currentJob.boardName}_pins.xlsx`,
                conflictAction: 'overwrite'
            });
        } else {
            console.error('XLSX library not loaded. Skipping Excel generation.');
        }
    } catch (e) {
        console.error('Excel generation error', e);
    }

    chrome.runtime.sendMessage({
        action: 'DOWNLOAD_COMPLETE',
        limitApplied: currentJob.limitApplied || false,
        count: currentJob.processed
    }).catch(() => { });
    currentJob = null;
}
