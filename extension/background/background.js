// Listen for installation and set default settings
chrome.runtime.onInstalled.addListener(() => {
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
    
    // Handle proxy fetch requests from content scripts
    if (request.type === 'PROXY_FETCH') {
        console.log('Received PROXY_FETCH request:', request);
        
        (async () => {
            try {
                // Execute the fetch request from the background script and convert to JSON
                const response = await fetch(request.url, request.options || {});
                const data = await response.json();
                
                // Send back the response
                sendResponse({
                    success: true,
                    data: data,
                    status: response.status
                });
            } catch (error) {
                console.error('Error in proxy fetch:', error);
                sendResponse({
                    success: false,
                    error: error.message
                });
            }
        })();
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