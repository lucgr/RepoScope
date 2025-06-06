// Workspace management functionality
console.log("Workspace module loaded and ready");

// Function to extract task name from branch name
function extractTaskFromBranch() {
    const branchInput = document.getElementById("workspace-branch-name");
    const taskInput = document.getElementById("workspace-task-name");
    
    if (!branchInput || !taskInput) return;
    
    const branchName = branchInput.value.trim();
    if (!branchName) {
        taskInput.value = "";
        return;
    }
    
    // Extract task ID using patterns
    const patterns_config = [
        // Renovate branches: group by "renovate/module"
        {regex: /^(renovate\/[^\/]+)/i, task_group_index: 1},
        // General pattern: any_string/any_string_with_dots_numbers_and_hyphens
        {regex: /^([a-zA-Z_\-]+)\/([a-zA-Z0-9_\.\-]+)/i, task_group_index: 2},
        // JIRA-style with prefix
        {regex: /^(feature|bug|bugfix|hotfix|fix|chore|task)\/([A-Z]+-\d+)/i, task_group_index: 2},
        // Just JIRA-style
        {regex: /^([A-Z]+-\d+)/i, task_group_index: 1},
        // Numeric ID with prefix
        {regex: /^(feature|bug|bugfix|hotfix|fix|chore|task)\/(\d+)/i, task_group_index: 2}
    ];
    
    for (const config of patterns_config) {
        const match = branchName.match(config.regex);
        if (match) {
            const taskName = match[config.task_group_index] || match[1]; // Fallback to group 1
            if (taskName) {
                taskInput.value = taskName.toUpperCase(); // Standardize to uppercase
                return;
            }
        }
    }
    
    // If no pattern matches, just clear the task input
    taskInput.value = "";
}

// Helper function to ensure workspace name is in URL
function ensureWorkspaceNameInUrl(url, name) {
    if (!url || !name) return url;
    
    // If URL doesn't contain the workspace name, add it
    if (!url.toLowerCase().includes(name.toLowerCase())) {
        // Add the workspace name to the end of the URL
        url = url.replace(/\.git$/, "");
        return `${url}-${name}.git`;
    }
    
    return url;
}

// Helper function to create a full clone URL
function createFullCloneUrl(baseUrl, workspaceName) {
    if (!baseUrl || !workspaceName) return null;
    // Remove .git extension if present
    baseUrl = baseUrl.replace(/\.git$/, "");
    // Remove any trailing slashes
    baseUrl = baseUrl.replace(/\/+$/, "");
    // Add workspace name and .git extension
    return `${baseUrl}/${workspaceName}.git`;
}

// Helper function to ensure we have a valid clone URL
function ensureValidCloneUrl(url, baseUrl, name) {
    // If a full URL is passed, ensure it contains the workspace name
    if (url && url.includes("://")) {
        return ensureWorkspaceNameInUrl(url, name);
    }
    // If it's a path, return it as is
    if (url && (url.startsWith("/") || url.match(/^[A-Z]:\\/i))) {
        return url;
    }
    // If no valid URL but a base URL and name, construct one
    if (baseUrl && name) {
        return createFullCloneUrl(baseUrl, name);
    }
    // If all else fails, return the original URL
    return url;
}

// Function to create a virtual workspace
function createVirtualWorkspace() {
    // Get required elements
    const workspaceNameInput = document.getElementById("workspace-name");
    const branchInput = document.getElementById("workspace-branch-name");
    const taskInput = document.getElementById("workspace-task-name");
    const resultDiv = document.getElementById("workspace-result");
    const cloneCommandEl = document.getElementById("clone-command");
    const createBtn = document.getElementById("create-workspace-btn");
    
    if (!workspaceNameInput || !branchInput || !taskInput || !resultDiv || !cloneCommandEl || !createBtn) {
        console.error("Missing required elements for workspace creation");
        return;
    }
    
    const workspaceName = workspaceNameInput.value.trim();
    const branchName = branchInput.value.trim();
    const taskName = taskInput.value.trim();
    
    if (!workspaceName) {
        alert("Please enter a workspace name");
        return;
    }
    
    if (!branchName) {
        alert("Please enter a branch name");
        return;
    }
    
    if (!taskName) {
        alert("Could not extract task name from branch. Please use the format feature/ABC-123");
        return;
    }
    
    // Get selected repositories
    const selectedRepos = [];
    const checkboxes = document.querySelectorAll("#workspace-repo-selection input[type=\"checkbox\"]:checked");
    checkboxes.forEach(function(checkbox) {
        selectedRepos.push(checkbox.value);
    });
    
    if (selectedRepos.length === 0) {
        alert("Please select at least one repository");
        return;
    }
    
    // Show loading indicator
    const originalBtnText = createBtn.textContent;
    createBtn.disabled = true;
    createBtn.textContent = "Creating workspace...";
    
    // Add a loading spinner next to the button
    const loadingSpinner = document.createElement("div");
    loadingSpinner.id = "workspace-loading";
    loadingSpinner.style.display = "inline-block";
    loadingSpinner.style.width = "20px";
    loadingSpinner.style.height = "20px";
    loadingSpinner.style.border = "3px solid rgba(0, 0, 0, 0.1)";
    loadingSpinner.style.borderTop = "3px solid #3498db";
    loadingSpinner.style.borderRadius = "50%";
    loadingSpinner.style.animation = "spin 1s linear infinite";
    loadingSpinner.style.marginLeft = "10px";
    
    // Add keyframes for spinner animation
    const style = document.createElement("style");
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    createBtn.parentNode.insertBefore(loadingSpinner, createBtn.nextSibling);
    
    // Get backend URL and token
    chrome.storage.sync.get(["backendUrl", "gitlabToken"], function(data) {
        let backendUrl = data.backendUrl;
        const gitlabToken = data.gitlabToken;
        
        if (!backendUrl || !gitlabToken) {
            alert("Please configure Backend URL and GitLab Token in Settings");
            resetCreateButton();
            return;
        }
        
        backendUrl = backendUrl.replace(/\/+$/, ""); // Remove trailing slashes
        
        function resetCreateButton() {
            createBtn.disabled = false;
            createBtn.textContent = originalBtnText;
            const spinner = document.getElementById("workspace-loading");
            if (spinner) spinner.remove();
            resultDiv.style.display = "none"; // Hide result div on reset or new attempt
            cloneCommandEl.textContent = "";
        }
        
        const payload = {
            name: workspaceName,
            workspace_name: workspaceName,
            repo_name: workspaceName,
            repository_name: workspaceName,
            project_name: workspaceName,
            task_name: taskName,
            branch_name: branchName,
            repo_urls: selectedRepos,
            use_custom_name: true,
            use_workspace_name: true,
            force_name_override: true
        };
        
        resultDiv.style.display = "none"; // Clear previous results
        cloneCommandEl.textContent = "";

        fetch(`${backendUrl}/api/workspace/prepare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken,
                "x-requested-name": workspaceName 
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    console.error("Error details from API:", errData);
                    throw new Error(`Failed to prepare workspace: ${response.status} - ${errData.detail || JSON.stringify(errData)}`);
                }).catch(parseErr => { 
                    console.error("Failed to parse error JSON, or not a JSON error:", parseErr);
                    throw new Error(`Failed to prepare workspace: ${response.status} - ${response.statusText || "Server error"}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Workspace command prepared successfully:", data.workspace_name);
            resultDiv.style.display = "block";
            
            // Update the UI to show the command 
            cloneCommandEl.innerHTML = `
                <div style="margin-bottom: 10px;">
                    Copy and run the command below to create <strong>${data.workspace_name}</strong> locally:
                </div>
                <div style="position: relative; margin-bottom: 10px;">
                    <textarea id="command-display" readonly style="width: 100%; height: 80px; background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 11px; border: 1px solid #ddd; resize: none; white-space: pre-wrap; word-wrap: break-word;">${data.command}</textarea>
                    <button id="copy-command-btn" style="position: absolute; top: 5px; right: 5px; padding: 4px 8px; font-size: 11px; background: #007cba; color: white; border: none; border-radius: 3px; cursor: pointer;">Copy</button>
                </div>
                <div style="margin-top: 8px; font-size: 12px; color: #666;">
                    <strong>The command will:</strong><br>
                    1. Create the ${data.workspace_name} directory<br>
                    2. Initialize git and set up submodules<br>
                    3. Download and run the multi-repo.sh script<br>
                    4. Ready to use! Just run: cd ${data.workspace_name}
                </div>
            `;
            
            // Add click event listener for copy button to avoid inline onclick issues
            const copyBtn = document.getElementById("copy-command-btn");
            if (copyBtn) {
                copyBtn.addEventListener("click", function(event) {
                    event.preventDefault();
                    const commandDisplay = document.getElementById("command-display");
                    if (commandDisplay) {
                        // Try to select and copy the text
                        commandDisplay.select();
                        commandDisplay.setSelectionRange(0, 99999); // For mobile devices
                        
                        try {
                            navigator.clipboard.writeText(commandDisplay.value).then(function() {
                                copyBtn.textContent = "Copied!";
                                copyBtn.style.backgroundColor = "#27ae60";
                                setTimeout(() => {
                                    copyBtn.textContent = "Copy";
                                    copyBtn.style.backgroundColor = "#007cba";
                                }, 1500);
                            }).catch(function() {
                                // Fallback to execCommand
                                const success = document.execCommand('copy');
                                if (success) {
                                    copyBtn.textContent = "Copied!";
                                    copyBtn.style.backgroundColor = "#27ae60";
                                    setTimeout(() => {
                                        copyBtn.textContent = "Copy";
                                        copyBtn.style.backgroundColor = "#007cba";
                                    }, 1500);
                                } else {
                                    alert('Copy failed. Please select the text manually and copy.');
                                }
                            });
                        } catch (err) {
                            // Final fallback
                            try {
                                const success = document.execCommand('copy');
                                if (success) {
                                    copyBtn.textContent = "Copied!";
                                    copyBtn.style.backgroundColor = "#27ae60";
                                    setTimeout(() => {
                                        copyBtn.textContent = "Copy";
                                        copyBtn.style.backgroundColor = "#007cba";
                                    }, 1500);
                                } else {
                                    alert('Copy failed. Please select the text manually and copy.');
                                }
                            } catch (execErr) {
                                alert('Copy failed. Please select the text manually and copy.');
                            }
                        }
                    }
                });
            }
            
            // Add workspace to history
            const workspaceData = {
                name: workspaceName,
                task: taskName,
                repos: selectedRepos,
                created_at: new Date().toISOString(),
                branch: branchName,
                command: data.command
            };
            addWorkspaceToHistory(workspaceData);
            
            // Reset button state but keep result visible
            createBtn.disabled = false;
            createBtn.textContent = "Create Another Workspace";
            const spinner = document.getElementById("workspace-loading");
            if (spinner) spinner.remove();
        })
        .catch(error => {
            console.error("Failed to create or download workspace:", error);
            resultDiv.style.display = "block";
            cloneCommandEl.innerHTML = `<span style="color: red;">Error: ${error.message}</span>`;
            resetCreateButton();
        });
    });
}

// Function to load workspace history
function loadWorkspaceHistory() {
    const historyContainer = document.getElementById("workspace-history");
    if (!historyContainer) return;
    
    // Get workspace history from storage
    chrome.storage.sync.get(["workspaceHistory"], function(data) {
        const history = data.workspaceHistory || [];
        
        // Clear container
        historyContainer.innerHTML = "";
        
        // Add instructions section above the workspace history
        const instructionsDiv = document.createElement("div");
        instructionsDiv.className = "workspace-instructions";
        instructionsDiv.style.marginBottom = "15px";
        instructionsDiv.style.padding = "12px";
        instructionsDiv.style.backgroundColor = "#f8f9fa";
        instructionsDiv.style.border = "1px solid #e9ecef";
        instructionsDiv.style.borderRadius = "4px";
        instructionsDiv.style.fontSize = "0.9em";
        instructionsDiv.style.color = "#495057";
        instructionsDiv.innerHTML = `
            <p style="margin-top: 0; margin-bottom: 8px;"><strong>Using Workspaces:</strong></p>
            <ol style="margin: 0; padding-left: 20px;">
                <li>Click <strong>Clone</strong> to get a workspace creation command</li>
                <li>Copy and run the command in your terminal</li>
                <li>Navigate to the created workspace: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">cd workspace_name</code></li>
            </ol>
        `;
        historyContainer.appendChild(instructionsDiv);
        
        // Show message if no history
        if (history.length === 0) {
            const emptyMsg = document.createElement("div");
            emptyMsg.className = "empty-history";
            emptyMsg.textContent = "No workspace history yet";
            historyContainer.appendChild(emptyMsg);
            return;
        }
        
        // Add a heading for the workspace history section
        const historyHeading = document.createElement("h3");
        historyHeading.style.fontSize = "1.1em";
        historyHeading.style.margin = "15px 0 10px 0";
        historyHeading.style.borderBottom = "1px solid #e9ecef";
        historyHeading.style.paddingBottom = "5px";
        historyHeading.textContent = "Workspace History";
        historyContainer.appendChild(historyHeading);
        
        // Create table for history
        const table = document.createElement("table");
        table.className = "history-table";
        
        // Add header
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        
        ["Name", "Task", "Repos", "Created", "Actions"].forEach(text => {
            const th = document.createElement("th");
            th.textContent = text;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Add body
        const tbody = document.createElement("tbody");
        
        // Sort history by creation date (newest first)
        history.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        // Add each workspace
        history.forEach(workspace => {
            const row = document.createElement("tr");
            
            // Name cell
            const nameCell = document.createElement("td");
            nameCell.textContent = workspace.name;
            row.appendChild(nameCell);
            
            // Task cell
            const taskCell = document.createElement("td");
            taskCell.textContent = workspace.task || "N/A";
            row.appendChild(taskCell);
            
            // Repos cell
            const reposCell = document.createElement("td");
            
            // Ensure repos is processed correctly to get the count
            let repoCount = "0";
            let repoTooltip = "";
            
            // First normalize the repos property if needed
            if (!workspace.repos) {
                workspace.repos = [];
            } else if (!Array.isArray(workspace.repos) && typeof workspace.repos === "string") {
                workspace.repos = workspace.repos.split(",").map(r => r.trim()).filter(r => r);
            } else if (!Array.isArray(workspace.repos)) {
                workspace.repos = [];
            }
            
            repoCount = workspace.repos.length.toString();
            repoTooltip = workspace.repos.join("\n");            
            reposCell.textContent = repoCount;
            reposCell.title = repoTooltip;
            row.appendChild(reposCell);
            
            // Created cell
            const createdCell = document.createElement("td");
            const date = new Date(workspace.created_at);
            createdCell.textContent = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
            row.appendChild(createdCell);
            
            // Actions cell
            const actionsCell = document.createElement("td");
            actionsCell.style.display = "flex";
            actionsCell.style.alignItems = "center";
            
            // Clone button
            const cloneBtn = document.createElement("button");
            cloneBtn.className = "clone-history-btn";
            cloneBtn.textContent = "Clone";
            cloneBtn.title = "Get workspace creation command";
            cloneBtn.addEventListener("click", function() {
                cloneWorkspaceFromHistory(workspace, cloneBtn, historyContainer);
            });
            
            actionsCell.appendChild(cloneBtn);
            
            // Delete button
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-history-btn";
            deleteBtn.textContent = "x";
            deleteBtn.title = "Remove this workspace from history";
            
            deleteBtn.addEventListener("click", function() {
                // Confirm before deleting
                if (confirm(`Are you sure you want to remove '${workspace.name}' from your workspace history?`)) {
                    removeWorkspaceFromHistory(workspace.name);
                }
            });
            
            actionsCell.appendChild(deleteBtn);
            row.appendChild(actionsCell);
            
            tbody.appendChild(row);
        });
        
        table.appendChild(tbody);
        historyContainer.appendChild(table);
    });
}

// Function to clone workspace from history
function cloneWorkspaceFromHistory(workspace, button, historyContainer) {
    // Show loading state
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Preparing...";
    
    // Get backend URL and token
    chrome.storage.sync.get(["backendUrl", "gitlabToken"], function(data) {
        let backendUrl = data.backendUrl;
        const gitlabToken = data.gitlabToken;
        
        if (!backendUrl || !gitlabToken) {
            alert("Please configure Backend URL and GitLab Token in Settings");
            button.disabled = false;
            button.textContent = originalText;
            return;
        }
        
        backendUrl = backendUrl.replace(/\/+$/, "");
        
        // Create payload from saved workspace data
        const payload = {
            name: workspace.name,
            workspace_name: workspace.name,
            repo_name: workspace.name,
            repository_name: workspace.name,
            project_name: workspace.name,
            task_name: workspace.task,
            branch_name: workspace.branch || workspace.task,
            repo_urls: workspace.repos,
            use_custom_name: true,
            use_workspace_name: true,
            force_name_override: true
        };
        
        // Create the workspace command again
        fetch(`${backendUrl}/api/workspace/prepare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken,
                "x-requested-name": workspace.name 
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    console.error("Error details from API:", errData);
                    throw new Error(`Failed to prepare workspace: ${response.status} - ${errData.detail || JSON.stringify(errData)}`);
                }).catch(parseErr => { 
                    console.error("Failed to parse error JSON, or not a JSON error:", parseErr);
                    throw new Error(`Failed to prepare workspace: ${response.status} - ${response.statusText || "Server error"}`);
                });
            }
            return response.json();
        })
        .then(data => {
            // Show success message
            button.textContent = "Ready";
            setTimeout(() => {
                button.disabled = false;
                button.textContent = originalText;
            }, 2000);
            
            // Update the popup UI to show what happened
            const statusEl = document.getElementById("workspace-status-message");
            if (!statusEl) {
                const statusDiv = document.createElement("div");
                statusDiv.id = "workspace-status-message";
                statusDiv.style.marginTop = "10px";
                historyContainer.insertBefore(statusDiv, historyContainer.firstChild);
            }
            
            const statusMessageId = "workspace-status-message-" + Date.now();
            document.getElementById("workspace-status-message").innerHTML = 
                `<div style="background-color: #e6f7e6; padding: 10px; border-left: 4px solid #27ae60; margin-bottom: 10px;">
                  <strong style="color: #27ae60;">SUCCESS:</strong> Workspace command ready for <strong>${data.workspace_name}</strong>!
                 </div>
                 <div style="position: relative; margin-bottom: 10px;">
                    <textarea id="history-command-display-${statusMessageId}" readonly style="width: 100%; height: 60px; background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 10px; border: 1px solid #ddd; resize: none; white-space: pre-wrap; word-wrap: break-word;">${data.command}</textarea>
                    <button id="${statusMessageId}" style="position: absolute; top: 5px; right: 5px; padding: 4px 8px; font-size: 10px; background: #007cba; color: white; border: none; border-radius: 3px; cursor: pointer;">Copy</button>
                 </div>
                 <div style="margin-top: 8px; font-size: 12px; color: #555;">
                    <strong>Next steps:</strong> 1. Run the command above 2. cd ${data.workspace_name} 3. Start coding!
                 </div>`;
            
            // Add click event listener for the copy button
            const historyCopyBtn = document.getElementById(statusMessageId);
            if (historyCopyBtn) {
                historyCopyBtn.addEventListener("click", function() {
                    const commandDisplay = document.getElementById(`history-command-display-${statusMessageId}`);
                    if (commandDisplay) {
                        copyToClipboard(commandDisplay.value);
                    }
                });
            }
        })
        .catch(error => {
            console.error("Failed to prepare workspace:", error);
            button.disabled = false;
            button.textContent = "Error";
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
            
            // Show error message
            const statusEl = document.getElementById("workspace-status-message");
            if (!statusEl) {
                const statusDiv = document.createElement("div");
                statusDiv.id = "workspace-status-message";
                statusDiv.style.marginTop = "10px";
                historyContainer.insertBefore(statusDiv, historyContainer.firstChild);
            }
            document.getElementById("workspace-status-message").innerHTML = 
                `<div style="background-color: #fae7e7; padding: 10px; border-left: 4px solid #e74c3c; margin-bottom: 10px;">
                  <strong style="color: #e74c3c;">ERROR:</strong> ${error.message}
                 </div>`;
        });
    });
}

// Function to add workspace to history
function addWorkspaceToHistory(workspace) {
    if (!workspace || !workspace.name) return;
    // Ensure repos is an array
    if (workspace.repos && !Array.isArray(workspace.repos)) {
        if (typeof workspace.repos === "string") {
            workspace.repos = workspace.repos.split(",").map(r => r.trim()).filter(r => r);
        } else {
            workspace.repos = [];
        }
    }
    
    chrome.storage.sync.get(["workspaceHistory"], function(data) {
        const history = data.workspaceHistory || [];
        
        // Add new workspace
        history.push(workspace);
        
        // Limit history size to 10 items
        if (history.length > 10) {
            history.shift(); // Remove oldest
        }
        
        // Save updated history
        chrome.storage.sync.set({ workspaceHistory: history }, function() {
            // Reload history
            loadWorkspaceHistory();
        });
    });
}

// Function to remove workspace from history
function removeWorkspaceFromHistory(workspaceName) {
    if (!workspaceName) return;
    
    chrome.storage.sync.get(["workspaceHistory"], function(data) {
        const history = data.workspaceHistory || [];
        
        // Find and remove the workspace with the matching name
        const updatedHistory = history.filter(workspace => workspace.name !== workspaceName);
        
        // Save updated history
        chrome.storage.sync.set({ workspaceHistory: updatedHistory }, function() {
            // Reload history to update UI
            loadWorkspaceHistory();
        });
    });
}

// Copy to clipboard function
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(function() {
        // Show temporary feedback
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = "Copied!";
        button.style.backgroundColor = "#27ae60";
        setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = "#007cba";
        }, 1500);
    }).catch(function(err) {
        console.error('Could not copy text: ', err);
        alert('Failed to copy to clipboard');
    });
}

// Export functions for use in other modules
window.extractTaskFromBranch = extractTaskFromBranch;
window.ensureWorkspaceNameInUrl = ensureWorkspaceNameInUrl;
window.createFullCloneUrl = createFullCloneUrl;
window.ensureValidCloneUrl = ensureValidCloneUrl;
window.createVirtualWorkspace = createVirtualWorkspace;
window.loadWorkspaceHistory = loadWorkspaceHistory;
window.addWorkspaceToHistory = addWorkspaceToHistory;
window.removeWorkspaceFromHistory = removeWorkspaceFromHistory;
window.copyToClipboard = copyToClipboard;

// Ensure the setup for branch name to task name extraction is still called if needed
document.addEventListener("DOMContentLoaded", function() {
    const branchInput = document.getElementById("workspace-branch-name");
    if (branchInput) {
        branchInput.addEventListener("input", extractTaskFromBranch);
    }
    
    const createBtn = document.getElementById("create-workspace-btn");
    if (createBtn) {
        createBtn.addEventListener("click", createVirtualWorkspace);
    }

    loadWorkspaceHistory(); // Load workspace history on popup open
}); 