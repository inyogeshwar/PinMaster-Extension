// PinVault Pro Content Script

let isScanning = false;
let scrapedPins = new Map(); // deduplication
let boardName = 'Pinterest_Board';

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_DOWNLOAD') {
        if (!isScanning) {
            startAdvancedScraping();
            sendResponse({ status: 'started' });
        } else {
            sendResponse({ status: 'already_running' });
        }
    } else if (request.action === 'STOP_DOWNLOAD') {
        isScanning = false;
        sendResponse({ status: 'stopped' });
    }
    return true; // Keep channel open
});

/**
 * Main function to orchestrate the scraping
 */
async function startAdvancedScraping() {
    isScanning = true;
    scrapedPins.clear();
    boardName = getBoardName();
    const section = getSectionName();

    chrome.runtime.sendMessage({
        action: 'PROGRESS_UPDATE',
        status: 'Starting smart scan...',
        current: 0,
        total: 0
    });

    try {
        await executeSmartScroll(boardName, section);
    } catch (e) {
        console.error('Scraping error:', e);
    } finally {
        if (isScanning && scrapedPins.size > 0) {
            await finalizeAndSend();
        } else if (isScanning) {
            console.log('No pins found.');
            chrome.runtime.sendMessage({ action: 'PROGRESS_UPDATE', status: 'No pins found.', current: 0, total: 0 });
        }
        isScanning = false;
    }
}

/**
 * Scrolls the page intelligently, identifying pins and stopping at "More ideas"
 */
async function executeSmartScroll(board, section) {
    let strikes = 0;
    let previousCount = 0;

    // We loop until stopped or "More ideas" found
    while (isScanning) {

        // 1. Check for "More ideas" BEFORE scrolling
        if (isMoreIdeasVisible()) {
            console.log('🛑 "More ideas" section detected. Stopping scroll.');
            break;
        }

        // 2. Scan visible pins
        const currentPins = document.querySelectorAll('div[data-test-id="pin"], div[data-test-id="pin-visual-wrapper"]');
        for (const pinEl of currentPins) {
            extractPinData(pinEl, section);
        }

        // 3. Check progress
        if (scrapedPins.size === previousCount) {
            strikes++;
        } else {
            strikes = 0;
            previousCount = scrapedPins.size;
        }

        if (strikes >= 5) {
            console.log('🛑 No new pins found after multiple scrolls.');
            break;
        }

        // 4. Report Progress
        chrome.runtime.sendMessage({
            action: 'PROGRESS_UPDATE',
            status: `Found ${scrapedPins.size} pins...`,
            current: 0,
            total: scrapedPins.size
        });

        // 5. Scroll Down
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 1500)); // Wait for lazy load
    }
}

/**
 * Extracts data from a single pin element
 */
function extractPinData(pinElement, section) {
    // Basic Image Check
    const img = pinElement.querySelector('img');
    if (!img || !img.src) return;

    // Filter out tiny images (avatars, icons)
    if (img.width < 50 || img.height < 50) return;

    let src = img.src;
    // Normalize to High-Res URL
    const highResUrl = src.replace(/\/\d+x\//, '/originals/');

    // Duplicate check
    if (scrapedPins.has(highResUrl)) return;

    // Check if visually below "More ideas" (double check)
    if (isBelowMoreIdeas(pinElement)) return;

    // Try to get Pin Link
    const linkEl = pinElement.querySelector('a[href^="/pin/"]');
    const pinLink = linkEl ? linkEl.href : '';

    // Try to get Description/Title
    const title = img.alt || 'Pinterest Image';
    const filename = `img_${String(scrapedPins.size + 1).padStart(4, '0')}.jpg`;

    scrapedPins.set(highResUrl, {
        imgUrl: highResUrl,
        pinLink: pinLink, // Important for resolving destination
        title: title,
        section: section,
        filename: filename,
        visitLink: '' // Will be populated later
    });
}

/**
 * Final phase: Resolve metadata (visit links) and send to background
 */
async function finalizeAndSend() {
    const total = scrapedPins.size;
    let processed = 0;
    const finalPins = Array.from(scrapedPins.values());

    // NOTE: Resolving ALL pins takes time. We can resolve them in batches or simple send them.
    // For "Pro" quality, we should try to resolve visit links if we have the pin link.
    // However, fetching IFrame for EVERY pin is slow. 
    // Is the user OK with slow? The snippet does it. 
    // Let's implement it but loop carefully.

    chrome.runtime.sendMessage({ action: 'PROGRESS_UPDATE', status: `Resolving metadata for ${total} pins...` });

    for (let i = 0; i < finalPins.length; i++) {
        if (!isScanning) break;

        const pin = finalPins[i];
        if (pin.pinLink) {
            // We only fetch metadata if needed. 
            // If we modify background to download immediately, we can skip this step here.
            // BUT the user wants the "Visit Site" link in CSV.
            // So we fetch it.
            try {
                const meta = await fetchPinMetadata(pin.pinLink);
                pin.visitLink = meta.visitLink;
                if (meta.description) pin.title = meta.description; // Better description
            } catch (e) {
                console.warn('Metadata fetch failed', e);
            }
        }

        processed++;
        if (processed % 5 === 0) {
            chrome.runtime.sendMessage({
                action: 'PROGRESS_UPDATE',
                status: `Resolving metadata ${processed} / ${total}`,
                current: processed,
                total: total
            });
        }
        // Small delay to be polite
        await new Promise(r => setTimeout(r, 200));
    }

    // Done!
    chrome.runtime.sendMessage({
        action: 'SCRAPING_COMPLETE',
        pins: finalPins,
        boardName: boardName
    });
}

/**
 * Fetches the actual destination URL using an invisible IFRAME
 * This is the "secret sauce" from the snippet.
 */
function fetchPinMetadata(pinUrl) {
    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.src = pinUrl;

        let solved = false;

        iframe.onload = () => {
            if (solved) return;
            try {
                const doc = iframe.contentDocument;
                // Try to find the external link
                // Selector strategy from snippet: looks for external links in specific containers
                const extLinkEl = doc.querySelector('a[href^="http"]:not([href*="pinterest.com"])');
                const visitLink = extLinkEl ? extLinkEl.href : '';

                // Try to get rich description
                const descEl = doc.querySelector('h1') || doc.querySelector('[data-test-id="pin-title"]');
                const desc = descEl ? descEl.innerText : '';

                resolve({ visitLink, description: desc });
            } catch (e) {
                // Cross-origin issues make simple access hard, but same-origin (pinterest.com) usually works for the pin page frame structure
                resolve({ visitLink: '', description: '' });
            } finally {
                solved = true;
                setTimeout(() => iframe.remove(), 100);
            }
        };

        iframe.onerror = () => {
            if (!solved) {
                solved = true;
                resolve({ visitLink: '', description: '' });
                iframe.remove();
            }
        };

        document.body.appendChild(iframe);

        // Timeout fallback
        setTimeout(() => {
            if (!solved) {
                solved = true;
                resolve({ visitLink: '', description: '' });
                iframe.remove();
            }
        }, 5000);
    });
}

/**
 * Utilities
 */

function isMoreIdeasVisible() {
    // Check multiple possible selectors for "More ideas" container
    const candidates = document.querySelectorAll('div[data-test-id="more-ideas-feed"], div[data-test-id="related-pins-feed"]');
    for (const el of candidates) {
        if (el && el.offsetParent !== null) { // is visible
            // Check if it's within viewport or close to it
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight) return true;
        }
    }

    // Fallback: Text content check
    const headings = document.querySelectorAll('h2');
    for (const h of headings) {
        if (/More ideas|More like this/i.test(h.innerText)) {
            const rect = h.getBoundingClientRect();
            if (rect.top < window.innerHeight) return true;
        }
    }

    return false;
}

function isBelowMoreIdeas(element) {
    // Find the marker
    const headings = document.querySelectorAll('h2');
    let moreIdeasEl = null;
    for (const h of headings) {
        if (/More ideas|More like this/i.test(h.innerText)) {
            moreIdeasEl = h;
            break;
        }
    }

    if (!moreIdeasEl) return false;

    // Compare positions: if element is following (below) moreIdeasEl
    return (moreIdeasEl.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function getBoardName() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.innerText.replace(/[^a-z0-9 ]/gi, '_').trim() : 'Pinterest_Board';
}

function getSectionName() {
    // If URL contains /section/, extract it
    const path = window.location.pathname;
    if (path.includes('/section/')) {
        const parts = path.split('/');
        return parts[parts.length - 1] || parts[parts.length - 2] || 'Unknown_Section';
    }
    return 'General';
}
