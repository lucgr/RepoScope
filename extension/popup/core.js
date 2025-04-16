// Core utilities and initialization functions
console.log("Popup script loaded at:", new Date().toISOString());

// Global error handler
window.onerror = function(message, source, lineno, colno, error) {
    console.error("Global error:", message, "at", source, lineno, colno);
    displayError("Global Error", message);
    return true; // Prevent default error handling
};

// Display error on page for visibility
function displayError(title, message) {
    try {
        const errorDiv = document.createElement("div");
        errorDiv.style.color = "red";
        errorDiv.style.backgroundColor = "#ffeeee";
        errorDiv.style.padding = "10px";
        errorDiv.style.margin = "10px";
        errorDiv.style.border = "1px solid red";
        errorDiv.innerHTML = `<strong>${title}:</strong> ${message}`;
        document.body.prepend(errorDiv);
    } catch (e) {
        console.error("Error in displayError:", e);
    }
}

// Show message
function showMessage(message) {
    const existingMessage = document.querySelector(".status-message");
    if (existingMessage) {
        existingMessage.parentNode.removeChild(existingMessage);
    }
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "status-message";
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 3000);
}

// Function to setup tab navigation
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-section");
    
    console.log("Setting up tab navigation:", {
        tabButtons: tabButtons.length,
        tabContents: tabContents.length
    });
    
    tabButtons.forEach(function(button) {
        button.addEventListener("click", function() {
            const tabId = this.dataset.tab;
            console.log("Tab clicked:", tabId);
            
            // Hide all tab contents
            tabContents.forEach(function(content) {
                content.style.display = "none";
            });
            
            // Deactivate all tab buttons
            tabButtons.forEach(function(btn) {
                btn.classList.remove("active");
            });
            
            // Show selected tab content
            const selectedTab = document.getElementById(tabId);
            if (selectedTab) {
                selectedTab.style.display = "block";
                console.log("Selected tab found and displayed:", tabId);
            } else {
                console.error("Selected tab content not found:", tabId);
            }
            
            // Activate selected tab button
            this.classList.add("active");
            
            // Save active tab to storage
            chrome.storage.sync.set({ activeTab: tabId });
        });
    });
    
    // Load saved active tab
    chrome.storage.sync.get(["activeTab"], function(data) {
        const activeTab = data.activeTab || "settings-section";
        const activeButton = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
        if (activeButton) {
            console.log("Activating saved tab:", activeTab);
            activeButton.click();
        } else {
            console.error("Saved tab button not found:", activeTab);
        }
    });
}

// Helper function to find element with specific text content
function findElementWithText(selector, text) {
    const elements = document.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].textContent.trim() === text) {
            return elements[i];
        }
    }
    return null;
}

// Copy text to clipboard helper
function copyToClipboard(text, callback) {
    navigator.clipboard.writeText(text)
        .then(() => {
            if (callback) callback(true);
        })
        .catch(err => {
            console.error("Copy failed:", err);
            if (callback) callback(false);
        });
}

// Initialize the popup
function initializePopup() {
    console.log("Initializing popup");
    
    // 1. Setup tab navigation
    setupTabNavigation();
    
    // 2. Setup Save Settings button
    const saveSettingsBtn = document.getElementById("save-settings");
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", saveSettings);
    } else {
        console.error("Save settings button not found! #save-settings");
    }
    
    // 3. Setup Add Repository button
    const addRepoBtn = document.getElementById("add-repo-btn");
    if (addRepoBtn) {
        addRepoBtn.addEventListener("click", addRepository);
    } else {
        console.error("Add repository button not found! #add-repo-btn");
    }
    
    // 4. Setup Refresh PRs button
    const refreshPRsBtn = document.getElementById("refresh-prs-btn");
    if (refreshPRsBtn) {
        refreshPRsBtn.addEventListener("click", loadUnifiedPRs);
    } else {
        console.error("Refresh PRs button not found! #refresh-prs-btn");
    }
    
    // 5. Setup Create Workspace button
    const createWorkspaceBtn = document.getElementById("create-workspace-btn");
    if (createWorkspaceBtn) {
        createWorkspaceBtn.addEventListener("click", createVirtualWorkspace);
    } else {
        console.error("Create workspace button not found! #create-workspace-btn");
    }
    
    // 6. Setup Branch Name input to extract task name
    const branchNameInput = document.getElementById("workspace-branch-name");
    if (branchNameInput) {
        branchNameInput.addEventListener("input", extractTaskFromBranch);
    } else {
        console.error("Branch name input not found! #workspace-branch-name");
    }
    
    // 7. Load saved settings
    chrome.storage.sync.get(["backendUrl", "gitlabToken", "repoUrls"], function(data) {
        // Set backend URL
        const backendUrlInput = document.getElementById("backend-url");
        if (backendUrlInput && data.backendUrl) {
            backendUrlInput.value = data.backendUrl;
        }
        
        // Set GitLab token
        const gitlabTokenInput = document.getElementById("gitlab-token");
        if (gitlabTokenInput && data.gitlabToken) {
            gitlabTokenInput.value = data.gitlabToken;
        }
        
        // Load repository list
        loadRepositoryList(data.repoUrls || "");
        
        // Update workspace repo selection
        updateWorkspaceRepoSelection(data.repoUrls || "");
        
        // Load unified PRs
        loadUnifiedPRs();
        
        // Load workspace history
        loadWorkspaceHistory();
    });
}

// Function to save settings
function saveSettings() {
    const backendUrl = document.getElementById("backend-url").value.trim();
    const gitlabToken = document.getElementById("gitlab-token").value.trim();
    
    // Basic validation
    if (!backendUrl) {
        alert("Please enter Backend URL");
        return;
    }
    
    if (!gitlabToken) {
        alert("Please enter GitLab API Token");
        return;
    }
    
    // Extract username from API token
    fetch("https://gitlab.com/api/v4/user", {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${gitlabToken}`
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error("Invalid GitLab token or API error");
        }
        return response.json();
    })
    .then(userData => {
        // Save settings with username
        chrome.storage.sync.set({
            backendUrl: backendUrl,
            gitlabToken: gitlabToken,
            username: userData.username
        }, function() {
            // Show success message
            showMessage("Settings saved successfully");
            
            // Reload unified PRs with new settings
            loadUnifiedPRs();
        });
    })
    .catch(error => {
        console.error("Failed to validate GitLab token:", error);
        alert("Failed to validate GitLab token: " + error.message);
    });
}

// Export functions for use in other modules
window.displayError = displayError;
window.showMessage = showMessage;
window.findElementWithText = findElementWithText;
window.copyToClipboard = copyToClipboard;
window.initializePopup = initializePopup; 