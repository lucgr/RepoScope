// Repository management functions
console.log("Repository module loaded and ready");

// Function to add a repository
function addRepository() {
    const urlInput = document.getElementById("new-repo-url");
    if (!urlInput) return;
    
    const url = urlInput.value.trim();
    if (!url) {
        alert("Please enter a repository URL");
        return;
    }
    
    if (!url.startsWith("https://gitlab.com/")) {
        alert("Please enter a valid GitLab repository URL (https://gitlab.com/...)");
        return;
    }
    
    chrome.storage.sync.get(["repoUrls"], function(data) {
        // Parse existing repos
        const existingRepos = data.repoUrls ? 
            data.repoUrls.split("\n").filter(u => u.trim()).map(u => u.trim()) : 
            [];
        
        // Check if repo already exists
        if (existingRepos.includes(url)) {
            alert("This repository is already in the list");
            return;
        }
        
        // Add new repo
        existingRepos.push(url);
        const updatedRepoUrls = existingRepos.join("\n");
        
        // Save to storage
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            // Update UI
            loadRepositoryList(updatedRepoUrls);
            updateWorkspaceRepoSelection(updatedRepoUrls);
            
            // Clear input
            urlInput.value = "";
            
            // Show success message
            showMessage("Repository added successfully");
        });
    });
}

// Function to remove a repository
function removeRepository(url) {
    if (!url) return;
    
    chrome.storage.sync.get(["repoUrls"], function(data) {
        // Parse existing repos
        const existingRepos = data.repoUrls ? 
            data.repoUrls.split("\n").filter(u => u.trim()).map(u => u.trim()) : 
            [];
        
        // Remove repo
        const updatedRepos = existingRepos.filter(r => r !== url);
        const updatedRepoUrls = updatedRepos.join("\n");
        
        // Save to storage
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            // Update UI
            loadRepositoryList(updatedRepoUrls);
            updateWorkspaceRepoSelection(updatedRepoUrls);
            
            // Show success message
            showMessage("Repository removed");
        });
    });
}

// Function to load repository list
function loadRepositoryList(repoUrlsString) {
    const repoList = document.getElementById("repo-list");
    if (!repoList) return;
    
    const tbody = repoList.querySelector("tbody");
    if (!tbody) return;
    
    const emptyState = document.getElementById("empty-repos");
    
    // Parse repos
    const repos = repoUrlsString ? 
        repoUrlsString.split("\n").filter(u => u.trim()).map(u => u.trim()) : 
        [];
    
    // Clear existing items
    tbody.innerHTML = "";
    
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = repos.length > 0 ? "none" : "block";
    }
    
    // Add repos to list
    if (repos.length > 0) {
        repos.forEach(function(repo) {
            const row = document.createElement("tr");
            
            // URL cell
            const urlCell = document.createElement("td");
            urlCell.textContent = repo;
            row.appendChild(urlCell);
            
            // Action cell
            const actionCell = document.createElement("td");
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-repo-btn";
            deleteBtn.textContent = "x";
            deleteBtn.setAttribute("data-url", repo);
            deleteBtn.onclick = function() {
                removeRepository(repo);
            };
            actionCell.appendChild(deleteBtn);
            row.appendChild(actionCell);
            
            tbody.appendChild(row);
        });
    }
}

// Update workspace repo selection
function updateWorkspaceRepoSelection(repoUrlsString) {
    const container = document.getElementById("workspace-repo-selection");
    if (!container) return;
    
    const emptyState = document.getElementById("empty-workspace-repos");
    
    // Parse repos
    const repos = repoUrlsString ? 
        repoUrlsString.split("\n").filter(u => u.trim()).map(u => u.trim()) : 
        [];
    
    // Clear existing items
    container.innerHTML = "";
    
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = repos.length > 0 ? "none" : "block";
    }
    
    // Apply container styles
    container.style.maxHeight = "220px";
    container.style.overflowY = "auto";
    container.style.border = "1px solid #ddd";
    container.style.borderRadius = "4px";
    container.style.padding = "10px";
    container.style.marginBottom = "15px";
    container.style.backgroundColor = "#f9f9f9";
    
    // Table-based layout for better visibility
    if (repos.length > 0) {
        const table = document.createElement("table");
        table.style.width = "100%";
        
        repos.forEach(function(repo) {
            const row = document.createElement("tr");
            
            // Checkbox cell
            const checkboxCell = document.createElement("td");
            checkboxCell.style.width = "30px";
            
            const checkboxWrapper = document.createElement("div");
            checkboxWrapper.className = "checkbox-wrapper";
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = repo;
            checkbox.id = `repo-${repo.replace(/[^a-zA-Z0-9]/g, "-")}`;
            checkbox.checked = true; // Default to checked
            
            checkboxWrapper.appendChild(checkbox);
            checkboxCell.appendChild(checkboxWrapper);
            row.appendChild(checkboxCell);
            
            // Label cell
            const labelCell = document.createElement("td");
            
            const label = document.createElement("label");
            label.htmlFor = checkbox.id;
            label.textContent = repo;
            label.style.display = "block";
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";
            label.style.whiteSpace = "nowrap";
            
            labelCell.appendChild(label);
            row.appendChild(labelCell);
            
            table.appendChild(row);
        });
        
        container.appendChild(table);
    }
}

// Helper function to get repository URLs
function getRepositoryUrls() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(["repoUrls"], function(data) {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            
            const repoUrls = data.repoUrls || "";
            const repoUrlsArray = repoUrls
                .split("\n")
                .filter(url => url.trim().length > 0)
                .map(url => url.trim());
                
            resolve(repoUrlsArray);
        });
    });
}

// Export functions for use in other modules
window.addRepository = addRepository;
window.removeRepository = removeRepository;
window.loadRepositoryList = loadRepositoryList;
window.updateWorkspaceRepoSelection = updateWorkspaceRepoSelection;
window.getRepositoryUrls = getRepositoryUrls; 