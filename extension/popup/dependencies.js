document.addEventListener("DOMContentLoaded", function() {
    // Initialize dependencies tab directly
    initDependenciesTab();
    
    // Also keep the event listener as fallback in case repositories load later
    document.addEventListener("reposLoaded", function() {
        initDependenciesTab();
    });
});

function initDependenciesTab() {
    const repoSelection = document.getElementById("dependency-repo-selection");
    const emptyReposMessage = document.getElementById("empty-dependency-repos");
    const checkDependenciesBtn = document.getElementById("check-dependencies-btn");
    const dependenciesResults = document.getElementById("dependencies-results");
    const pythonMismatchesContent = document.getElementById("python-mismatches-content");
    const goMismatchesContent = document.getElementById("go-mismatches-content");
    const noPythonMismatches = document.getElementById("no-python-mismatches");
    const noGoMismatches = document.getElementById("no-go-mismatches");
    const showBranchSelection = document.getElementById("show-branch-selection");
    
    // Set up branch selection toggle
    showBranchSelection.addEventListener("change", function() {
        if (this.checked) {
            repoSelection.classList.add("show-branches");
        } else {
            repoSelection.classList.remove("show-branches");
        }
    });
    
    // Clear any existing repo checkboxes
    repoSelection.innerHTML = "";
    
    console.log("Initializing dependencies tab...");
    
    // Get the saved repositories from repoUrls instead of repositories
    chrome.storage.sync.get(["repoUrls"], function(result) {
        console.log("Repository URLs from storage:", result);
        
        const repoUrlsString = result.repoUrls || "";
        const repoUrls = repoUrlsString.split("\n").filter(url => url.trim());
        
        // If no repositories, show empty message
        if (!repoUrls || repoUrls.length === 0) {
            repoSelection.style.display = "none";
            emptyReposMessage.style.display = "block";
            checkDependenciesBtn.disabled = true;
            return;
        }
        
        // Show repository selection
        emptyReposMessage.style.display = "none";
        repoSelection.style.display = "block";
        checkDependenciesBtn.disabled = false;
        
        // Create checkboxes for each repository
        repoUrls.forEach(url => {
            if (!url || !url.trim()) {
                return;
            }
            
            const url_trimmed = url.trim();
            const repoName = url_trimmed.split("/").pop().replace(".git", "");
            const container = document.createElement("div");
            container.className = "repo-checkbox-container";
            
            // Create a wrapper for the repo selection (checkbox + label + branch input)
            const repoContainer = document.createElement("div");
            repoContainer.className = "repo-container";
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = `dep-repo-${repoName}`;
            checkbox.value = url_trimmed;
            checkbox.className = "repo-checkbox";
            checkbox.checked = true;
            
            const label = document.createElement("label");
            label.htmlFor = `dep-repo-${repoName}`;
            label.textContent = repoName;
            
            // Add branch input field
            const branchInput = document.createElement("input");
            branchInput.type = "text";
            branchInput.placeholder = "main";
            branchInput.className = "branch-input";
            branchInput.dataset.repo = url_trimmed;
            
            repoContainer.appendChild(checkbox);
            repoContainer.appendChild(label);
            repoContainer.appendChild(branchInput);
            
            container.appendChild(repoContainer);
            repoSelection.appendChild(container);
        });
    });
    
    // Add event listener to the check dependencies button
    checkDependenciesBtn.addEventListener("click", function() {
        // Get selected repositories
        const selectedRepos = [];
        const repoBranches = {};
        const checkboxes = repoSelection.querySelectorAll("input.repo-checkbox:checked");
        
        if (checkboxes.length < 2) {
            showError("Please select at least two repositories to compare dependencies.");
            return;
        }
        
        // Get all selected repos and their branches
        checkboxes.forEach(checkbox => {
            const repoUrl = checkbox.value;
            selectedRepos.push(repoUrl);
            
            // If branch selection is shown, get branch values
            if (showBranchSelection.checked) {
                const branchInput = checkbox.parentElement.querySelector(".branch-input");
                if (branchInput && branchInput.value.trim()) {
                    repoBranches[repoUrl] = branchInput.value.trim();
                }
            }
        });
        
        // Show loading state
        checkDependenciesBtn.disabled = true;
        checkDependenciesBtn.textContent = "Checking...";
        
        // Clear previous results
        clearPreviousResults();
        
        // Get settings
        chrome.storage.sync.get(["backendUrl", "gitlabToken"], function(result) {
            if (!result.backendUrl || !result.gitlabToken) {
                showError("Please set up the backend URL and GitLab token in the Settings tab.");
                checkDependenciesBtn.disabled = false;
                checkDependenciesBtn.textContent = "Check Dependencies";
                return;
            }
            
            const backendUrl = result.backendUrl;
            const gitlabToken = result.gitlabToken;
            
            // Prepare request payload with branches if needed
            const payload = {
                repo_urls: selectedRepos
            };
            
            // Only include repo_branches if branches are specified
            if (Object.keys(repoBranches).length > 0) {
                payload.repo_branches = repoBranches;
            }
            
            // Call the backend API for the dependency check
            fetch(`${backendUrl}/api/dependencies/check`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gitlab-Token": gitlabToken
                },
                body: JSON.stringify(payload)
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(data => {
                        throw new Error(data.detail || "Failed to check dependencies.");
                    });
                }
                return response.json();
            })
            .then(data => {
                // Reset button state
                checkDependenciesBtn.disabled = false;
                checkDependenciesBtn.textContent = "Check Dependencies";
                
                // Display results
                dependenciesResults.style.display = "block";
                
                // Handle messages or warnings if present
                if (data.message || (data.warnings && data.warnings.length > 0)) {
                    displayMessagesAndWarnings(data, dependenciesResults);
                }
                
                // Process python mismatches
                const pythonMismatches = data.python_mismatches || {};
                if (Object.keys(pythonMismatches).length === 0) {
                    pythonMismatchesContent.innerHTML = "";
                    noPythonMismatches.style.display = "block";
                } else {
                    noPythonMismatches.style.display = "none";
                    pythonMismatchesContent.innerHTML = formatMismatches(pythonMismatches);
                }
                
                // Process Go mismatches
                const goMismatches = data.go_mismatches || {};
                if (Object.keys(goMismatches).length === 0) {
                    goMismatchesContent.innerHTML = "";
                    noGoMismatches.style.display = "block";
                } else {
                    noGoMismatches.style.display = "none";
                    goMismatchesContent.innerHTML = formatMismatches(goMismatches);
                }
            })
            .catch(error => {
                checkDependenciesBtn.disabled = false;
                checkDependenciesBtn.textContent = "Check Dependencies";
                showError(`Error: ${error.message}`);
            });
        });
    });
}

function clearPreviousResults() {
    // Clear previous warnings and messages
    const oldWarnings = document.querySelector(".warnings-container");
    if (oldWarnings) {
        oldWarnings.remove();
    }
    
    // Hide results sections
    document.getElementById("dependencies-results").style.display = "none";
    document.getElementById("python-mismatches-content").innerHTML = "";
    document.getElementById("go-mismatches-content").innerHTML = "";
    document.getElementById("no-python-mismatches").style.display = "none";
    document.getElementById("no-go-mismatches").style.display = "none";
}

function displayMessagesAndWarnings(data, container) {
    const warningsDiv = document.createElement("div");
    warningsDiv.className = "warnings-container";
    
    if (data.message) {
        const messageP = document.createElement("p");
        messageP.className = "info-message";
        messageP.textContent = data.message;
        warningsDiv.appendChild(messageP);
    }
    
    if (data.warnings && data.warnings.length > 0) {
        const warningHeader = document.createElement("p");
        warningHeader.className = "warning-header";
        warningHeader.textContent = "Warnings:";
        warningsDiv.appendChild(warningHeader);
        
        const warningList = document.createElement("ul");
        warningList.className = "warning-list";
        data.warnings.forEach(warning => {
            const item = document.createElement("li");
            item.textContent = warning;
            warningList.appendChild(item);
        });
        warningsDiv.appendChild(warningList);
    }
    
    // Insert at the top of the container
    if (container.firstChild) {
        container.insertBefore(warningsDiv, container.firstChild);
    } else {
        container.appendChild(warningsDiv);
    }
}

function formatMismatches(mismatches) {
    let html = "<table class=\"mismatches-table\">";
    html += "<thead><tr><th>Dependency</th><th>Versions</th><th>Repositories</th></tr></thead><tbody>";
    
    for (const [dependency, versions] of Object.entries(mismatches)) {
        html += `<tr><td class="dependency-name">${dependency}</td><td>`;
        
        // Collect all version information
        const versionsList = [];
        for (const [version, repos] of Object.entries(versions)) {
            versionsList.push(`<span class="version">${version}</span> <span class="repo-count">(${repos.length})</span>`);
        }
        html += versionsList.join(", ");
        html += "</td><td>";
        
        // Collect all repositories by version
        const reposByVersion = [];
        for (const [version, repos] of Object.entries(versions)) {
            reposByVersion.push(`<div><strong>${version}:</strong> ${repos.join(", ")}</div>`);
        }
        html += reposByVersion.join("");
        
        html += "</td></tr>";
    }
    
    html += "</tbody></table>";
    return html;
}

function showError(message) {
    alert(message);
} 