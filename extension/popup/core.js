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

// Helper to fetch all accessible GitLab repos with pagination
async function fetchAllGitLabRepos(gitlabToken) {
    let repos = [];
    let page = 1;
    let perPage = 100;
    let more = true;
    while (more) {
        const resp = await fetch(`https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=${perPage}&page=${page}`, {
            headers: { 'Authorization': `Bearer ${gitlabToken}` }
        });
        if (!resp.ok) throw new Error('Failed to fetch repositories from GitLab');
        const data = await resp.json();
        repos = repos.concat(data);
        more = data.length === perPage;
        page++;
    }
    // Return unique HTTPS URLs only
    return Array.from(new Set(repos.map(r => r.http_url_to_repo).filter(Boolean)));
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
        
        // Show/hide add repo form based on token
        showOrHideAddRepoForm(!!data.gitlabToken);
        // Always use current search value for filtering
        const searchInput = document.getElementById("repo-search");
        const searchValue = searchInput ? searchInput.value : "";
        loadRepositoryList(data.repoUrls || "", searchValue, true);
        updateWorkspaceRepoSelection(data.repoUrls || "", searchValue, true);
        
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
    .then(async userData => {
        // Show loading message
        showMessage("Fetching all accessible repositories from GitLab...");
        let repoUrls = [];
        try {
            repoUrls = await fetchAllGitLabRepos(gitlabToken);
        } catch (err) {
            displayError("Repo Fetch Error", err.message);
        }
        // Save settings with username and repoUrls
        chrome.storage.sync.set({
            backendUrl: backendUrl,
            gitlabToken: gitlabToken,
            username: userData.username,
            repoUrls: repoUrls.join("\n")
        }, function() {
            showMessage("Settings and repositories saved successfully");
            showOrHideAddRepoForm(true);
            const searchInput = document.getElementById("repo-search");
            const searchValue = searchInput ? searchInput.value : "";
            loadRepositoryList(repoUrls.join("\n"), searchValue, true);
            updateWorkspaceRepoSelection(repoUrls.join("\n"), searchValue, true);
            loadUnifiedPRs();
        });
    })
    .catch(error => {
        console.error("Failed to validate GitLab token:", error);
        alert("Failed to validate GitLab token: " + error.message);
    });
}

// Show or hide add repository form based on token
function showOrHideAddRepoForm(tokenPresent) {
    const repoForm = document.getElementById("repo-form");
    const repoAddHelp = document.getElementById("repo-add-help");
    const repoListSection = document.getElementById("repo-list-section");
    if (repoForm && repoAddHelp && repoListSection) {
        if (tokenPresent) {
            repoForm.style.display = "flex";
            repoAddHelp.style.display = "none";
            repoListSection.style.display = "block";
        } else {
            repoForm.style.display = "none";
            repoAddHelp.style.display = "block";
            repoListSection.style.display = "none";
        }
    }
}

// Export functions for use in other modules
window.displayError = displayError;
window.showMessage = showMessage;
window.findElementWithText = findElementWithText;
window.copyToClipboard = copyToClipboard;
window.initializePopup = initializePopup;

function loadRepositoryList(repoUrlsString, searchTerm = "", updateAllRepos = false) {
    const repoList = document.getElementById("repo-list");
    if (!repoList) return;
    const tbody = repoList.querySelector("tbody");
    if (!tbody) return;
    const emptyState = document.getElementById("empty-repos");
    // ... rest of the function ...
}

function updateWorkspaceRepoSelection(repoUrlsString, searchTerm = "", updateAllRepos = false) {
    const container = document.getElementById("workspace-repo-selection");
    if (!container) return;
    const emptyState = document.getElementById("empty-workspace-repos");
    // ... rest of the function ...
}

function addRepository() {
    const url = document.getElementById("repo-url").value.trim();
    if (!url) {
        alert("Please enter a repository URL");
        return;
    }

    chrome.storage.sync.get(["repoUrls"], function(data) {
        const existingRepos = data.repoUrls
            ? data.repoUrls.split("\n").filter(u => u.trim()).map(u => u.trim().toLowerCase().replace(/\/$/, ""))
            : [];
        const urlNormalized = url.toLowerCase().replace(/\/$/, "");
        if (existingRepos.includes(urlNormalized)) {
            alert("This repository is already in the list");
            return;
        }
        // ... rest of add logic ...
    });
} 