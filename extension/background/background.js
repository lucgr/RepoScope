// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
    // Set default settings
    chrome.storage.sync.set({
        backendUrl: 'http://localhost:8000',
        gitlabToken: '',
        repoUrls: ''
    });
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_SETTINGS') {
        chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'repoUrls'], (data) => {
            sendResponse(data);
        });
        return true; // Required for async response
    }
});

// Handle GitLab token updates
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.gitlabToken) {
        // Notify all tabs about the token update
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.url?.includes('gitlab.com')) {
                    chrome.tabs.sendMessage(tab.id, {
                        type: 'SETTINGS_UPDATED',
                        settings: {
                            gitlabToken: changes.gitlabToken.newValue
                        }
                    });
                }
            });
        });
    }
}); 