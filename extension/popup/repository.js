// Repository management functions

// In-memory storage for all repos
let allRepos = [];
let filteredRepos = [];

// Function to filter repos by search term
function filterRepos(searchTerm) {
    if (!searchTerm) return allRepos;
    const lower = searchTerm.toLowerCase();
    return allRepos.filter(repo => repo.toLowerCase().includes(lower));
}

async function userHasAccessToRepo(owner, repo, token) {
    const urlEncodedPath = encodeURIComponent(owner + "/" + repo);
    const apiUrl = `https://gitlab.com/api/v4/projects/${urlEncodedPath}`;
    try {
        const resp = await fetch(apiUrl, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        return resp.ok;
    } catch (e) {
        return false;
    }
}

// Function to add a repository
function addRepository() {
    const urlInput = document.getElementById("new-repo-url");
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) {
        alert("Please enter a repository URL");
        return;
    }
    // TODO: This should still work for org-repos but make sure
    if (!url.startsWith("https://gitlab.com/")) {
        alert("Please enter a valid GitLab repository URL (https://gitlab.com/...)");
        return;
    }
    chrome.storage.sync.get(["repoUrls", "gitlabToken"], async function(data) {
        const newRepoKey = extractRepoOwnerAndName(url);
        if (!newRepoKey) {
            alert("Could not parse repository owner and name from URL");
            return;
        }
        const [owner, repo] = newRepoKey.split("/");
        const token = data.gitlabToken;
        if (!token) {
            alert("No GitLab token found. Please save your token first.");
            return;
        }
        // Check access before adding
        const hasAccess = await userHasAccessToRepo(owner, repo, token);
        if (!hasAccess) {
            alert("You do not have access to this repository with your current GitLab token.");
            return;
        }
        const existingRepos = data.repoUrls
            ? data.repoUrls.split("\n").filter(u => u.trim())
            : [];
        const existingKeys = existingRepos.map(extractRepoOwnerAndName).filter(Boolean);
        if (existingKeys.includes(newRepoKey)) {
            alert("A repository with this owner and name is already in the list");
            return;
        }
        // Add new repo
        existingRepos.push(url);
        const updatedRepoUrls = existingRepos.join("\n");
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            allRepos = updatedRepoUrls.split("\n").filter(u => u.trim());
            loadRepositoryList(updatedRepoUrls, "", true);
            updateWorkspaceRepoSelection(updatedRepoUrls, "", true);
            urlInput.value = "";
            showMessage("Repository added successfully");
        });
    });
}

// Function to remove a repository
function removeRepository(url) {
    if (!url) return;
    chrome.storage.sync.get(["repoUrls"], function(data) {
        const updatedRepos = data.repoUrls
            ? data.repoUrls.split("\n").filter(u => u.trim() && u.trim() !== url)
            : [];
        const updatedRepoUrls = updatedRepos.join("\n");
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            // Update allRepos after removal of a repo
            allRepos = updatedRepoUrls.split("\n").filter(u => u.trim());
            const searchInput = document.getElementById("repo-search");
            const searchValue = searchInput ? searchInput.value : "";
            loadRepositoryList(updatedRepoUrls, searchValue, true);
            updateWorkspaceRepoSelection(updatedRepoUrls, searchValue, true);
            showMessage("Repository removed");
        });
    });
}

// Function to load repository list (filtered)
function loadRepositoryList(repoUrlsString, searchTerm = "", updateAllRepos = false) {
    const repoList = document.getElementById("repo-list");
    if (!repoList) return;
    const tbody = repoList.querySelector("tbody");
    if (!tbody) return;
    const emptyState = document.getElementById("empty-repos");
    // Only update allRepos if explicitly told to (on initial load or after add/remove)
    if (updateAllRepos) {
        allRepos = repoUrlsString ? repoUrlsString.split("\n").filter(u => u.trim()).map(u => u.trim()) : [];
    }
    filteredRepos = filterRepos(searchTerm);
    // Clear existing items
    tbody.innerHTML = "";
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = filteredRepos.length > 0 ? "none" : "block";
    }
    // Add repos to list
    if (filteredRepos.length > 0) {
        filteredRepos.forEach(function(repo) {
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

// Update workspace repo selection (filtered)
function updateWorkspaceRepoSelection(repoUrlsString, searchTerm = "", updateAllRepos = false) {
    const container = document.getElementById("workspace-repo-selection");
    if (!container) return;
    const emptyState = document.getElementById("empty-workspace-repos");
    if (updateAllRepos) {
        allRepos = repoUrlsString ? repoUrlsString.split("\n").filter(u => u.trim()).map(u => u.trim()) : [];
    }
    filteredRepos = filterRepos(searchTerm);
    // Clear existing items
    container.innerHTML = "";
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = filteredRepos.length > 0 ? "none" : "block";
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
    if (filteredRepos.length > 0) {
        const table = document.createElement("table");
        table.style.width = "100%";
        filteredRepos.forEach(function(repo) {
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

// On DOMContentLoaded, always set allRepos from storage for faster loading
window.addEventListener("DOMContentLoaded", function() {
    chrome.storage.sync.get(["repoUrls"], function(data) {
        allRepos = data.repoUrls ? data.repoUrls.split("\n").filter(u => u.trim()) : [];
    });
    const searchInput = document.getElementById("repo-search");
    if (searchInput) {
        searchInput.addEventListener("input", function() {
            loadRepositoryList(allRepos.join("\n"), searchInput.value, false);
            updateWorkspaceRepoSelection(allRepos.join("\n"), searchInput.value, false);
        });
    }
});

// Export functions for use in other modules
window.addRepository = addRepository;
window.removeRepository = removeRepository;
window.loadRepositoryList = loadRepositoryList;
window.updateWorkspaceRepoSelection = updateWorkspaceRepoSelection;
window.getRepositoryUrls = getRepositoryUrls;

function extractRepoOwnerAndName(url) {
    // Remove protocol, trailing slash, .git, and extract owner and repo name
    let clean = url.trim().replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\.git$/, "");
    const parts = clean.split("/");
    if (parts.length < 3) return null; // e.g. gitlab.com/owner/repo
    const owner = parts[1].toLowerCase();
    const repo = parts[2].toLowerCase();
    return owner + "/" + repo;
}

// Inject Material Icons font if not already present
(function() {
    if (!document.querySelector("link[href*=\"fonts.googleapis.com/icon?family=Material+Icons\"]")) {
        const link = document.createElement("link");
        link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
        link.rel = "stylesheet";
        document.head.appendChild(link);
    }
})(); 