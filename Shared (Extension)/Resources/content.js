// Intercept clicks on magnet links
document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href^="magnet:"]');
    if (link) {
        e.preventDefault();
        e.stopPropagation();
        console.log("MagnetToSynology: Intercepted magnet link:", link.href);
        browser.runtime.sendMessage({ magnet: link.href });
    }
}, true);

// Listen for responses from background script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("MagnetToSynology: Received response:", request);
});
