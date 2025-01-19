chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action != 'print-receipt') 
        return

    port = chrome.runtime.connectNative('com.fiscalpy.fp700');

    port.onMessage.addListener((message) => {
        console.log(JSON.stringify(message));
    });

    port.onDisconnect.addListener(() => {
        console.error("Failed to connect: " + chrome.runtime.lastError.message);
    });

    port.postMessage(message)
})