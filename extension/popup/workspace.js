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
    // Example: feature/ABC-123 -> ABC-123
    const patterns = [
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/([A-Z]+-\d+)/i, // JIRA-style with prefix
        /^([A-Z]+-\d+)/i,                                          // Just JIRA-style
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/(\d+)/i      // Numeric ID with prefix
    ];
    
    for (const pattern of patterns) {
        const match = branchName.match(pattern);
        if (match) {
            // Use the second group if it exists (task ID), otherwise first group
            taskInput.value = match[2] || match[1];
            return;
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
    // If we have a full URL, ensure it contains the workspace name
    if (url && url.includes("://")) {
        return ensureWorkspaceNameInUrl(url, name);
    }
    
    // If it's a path, return it as is
    if (url && (url.startsWith("/") || url.match(/^[A-Z]:\\/i))) {
        return url;
    }
    
    // If we don't have a valid URL but have a base URL and name, construct one
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
        alert("Could not extract task name from branch. Please use format feature/ABC-123");
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
        
        backendUrl = backendUrl.replace(/\/+$/, "");
        
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
        
        console.log("Creating workspace with payload:", payload);
        resultDiv.style.display = "none"; // Clear previous results
        cloneCommandEl.textContent = "";

        fetch(`${backendUrl}/api/workspace/create`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json", // Ensure this is set for sending JSON payload
                "x-gitlab-token": gitlabToken,
                "x-requested-name": workspaceName 
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                // If response is not OK, it's likely an error JSON from FastAPI
                return response.json().then(errData => {
                    console.error("Error details from API:", errData);
                    throw new Error(`Failed to create workspace: ${response.status} - ${errData.detail || JSON.stringify(errData)}`);
                }).catch(parseErr => { 
                    console.error("Failed to parse error JSON, or not a JSON error:", parseErr);
                    throw new Error(`Failed to create workspace: ${response.status} - ${response.statusText || "Server error"}`);
                });
            }
            // If response.ok, it should be the zip file
            const contentDisposition = response.headers.get("content-disposition");
            let filename = "virtual_workspace.zip"; // Default filename
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
                if (filenameMatch && filenameMatch.length > 1) {
                    filename = filenameMatch[1];
                }
            }
            return response.blob().then(blob => ({ blob, filename }));
        })
        .then(({ blob, filename }) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            console.log("Workspace ZIP downloaded successfully:", filename);
            resultDiv.style.display = "block";
            cloneCommandEl.innerHTML = `✅ Workspace <strong style="font-family: monospace;">${filename}</strong> downloaded successfully! Check your downloads folder.`;
            
            resetCreateButton();
            createBtn.textContent = "Create Another Workspace";
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
        
        // DEBUG: Log workspace history objects
        console.log("Workspace history objects:", history);
        
        // Clear container
        historyContainer.innerHTML = "";
        
        // Show message if no history
        if (history.length === 0) {
            const emptyMsg = document.createElement("div");
            emptyMsg.className = "empty-history";
            emptyMsg.textContent = "No workspace history yet";
            historyContainer.appendChild(emptyMsg);
            return;
        }
        
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
            
            // First, normalize the repos property if needed
            if (!workspace.repos) {
                workspace.repos = [];
            } else if (!Array.isArray(workspace.repos) && typeof workspace.repos === "string") {
                workspace.repos = workspace.repos.split(",").map(r => r.trim()).filter(r => r);
            } else if (!Array.isArray(workspace.repos)) {
                workspace.repos = [];
            }
            
            // Now we're sure workspace.repos is an array
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
            cloneBtn.title = "Show clone command";
            cloneBtn.addEventListener("click", function() {
                // Find or create result div
                let resultDiv = document.getElementById("history-clone-result");
                if (!resultDiv) {
                    resultDiv = document.createElement("div");
                    resultDiv.id = "history-clone-result";
                    resultDiv.className = "clone-result";
                    historyContainer.appendChild(resultDiv);
                }
                
                // Create or update clone command code element
                let commandEl = resultDiv.querySelector("code");
                if (!commandEl) {
                    commandEl = document.createElement("code");
                    commandEl.id = "history-clone-command";
                    
                    // Style the clone command
                    commandEl.style.backgroundColor = "#272822";
                    commandEl.style.color = "#f8f8f2";
                    commandEl.style.padding = "10px";
                    commandEl.style.paddingLeft = "15px"; // Add more left padding for better visibility
                    commandEl.style.borderRadius = "4px";
                    commandEl.style.border = "1px solid #1e1f1c";
                    commandEl.style.fontFamily = "monospace";
                    commandEl.style.fontSize = "13px";
                    commandEl.style.width = "100%";
                    commandEl.style.boxSizing = "border-box";
                    commandEl.style.display = "block";
                    commandEl.style.overflow = "auto";
                    commandEl.style.whiteSpace = "pre-wrap"; // Change to pre-wrap for better text wrapping
                    commandEl.style.minHeight = "40px"; // Ensure minimum height
                    commandEl.style.position = "relative"; // Set position to relative
                    commandEl.style.zIndex = "2"; // Ensure command is on top
                    
                    resultDiv.appendChild(commandEl);
                }
                
                // Command container should be relative for absolute positioned copy button
                resultDiv.style.position = "relative";
                
                // Determine if it's a local path or remote URL
                const url = workspace.clone_url;
                const isLocalPath = url && (url.includes(":\\") || url.startsWith("/"));
                
                // Format the URL properly for git
                let formattedUrl = url;
                
                if (isLocalPath) {
                    // For local paths, convert them to file:/// format for Git
                    formattedUrl = url.replace(/\\/g, "/");
                    if (formattedUrl.startsWith("/")) {
                        formattedUrl = "file://" + formattedUrl;
                    } else {
                        // Windows path needs three slashes
                        formattedUrl = "file:///" + formattedUrl;
                    }
                    console.log("Converted history local path to Git URL:", formattedUrl);
                }
                
                // For all URLs, use git clone format
                const command = `git clone "${formattedUrl}" ${workspace.name}`;
                console.log("Generated history clone command:", command);
                
                // Set the command text - just show the clone command, not the notes
                commandEl.textContent = command;
                
                // Add note about next steps in a separate element
                let noteEl = resultDiv.querySelector(".history-note");
                if (!noteEl) {
                    noteEl = document.createElement("div");
                    noteEl.className = "history-note";
                    noteEl.style.marginTop = "15px";
                    noteEl.style.fontSize = "0.9em";
                    noteEl.style.color = "#555";
                    noteEl.style.backgroundColor = "#f5f7f9";
                    noteEl.style.padding = "10px";
                    noteEl.style.borderRadius = "4px";
                    noteEl.style.border = "1px solid #e0e5e9";
                    resultDiv.appendChild(noteEl);
                }
                
                noteEl.innerHTML = `
                    <p style="margin-top: 0; font-weight: 600;">After cloning:</p>
                    <ol style="padding-left: 20px; margin-bottom: 0;">
                        <li>Initialize workspace: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">bash multi-repo.sh init</code></li>
                    </ol>
                `;
                
                // Create or update copy button
                let copyBtn = resultDiv.querySelector(".copy-history-cmd-btn");
                if (!copyBtn) {
                    copyBtn = document.createElement("button");
                    copyBtn.className = "copy-history-cmd-btn";
                    copyBtn.textContent = "Copy";
                    
                    // Style the copy button
                    copyBtn.style.position = "absolute";
                    copyBtn.style.right = "10px";
                    copyBtn.style.top = "8px";
                    copyBtn.style.padding = "4px 8px";
                    copyBtn.style.fontSize = "12px";
                    copyBtn.style.backgroundColor = "#3E3D32";
                    copyBtn.style.border = "1px solid #4E4D42";
                    copyBtn.style.color = "#f8f8f2";
                    copyBtn.style.borderRadius = "3px";
                    copyBtn.style.cursor = "pointer";
                    
                    resultDiv.appendChild(copyBtn);
                }
                
                // Remove existing listeners by cloning and replacing the button
                const newCopyBtn = copyBtn.cloneNode(true);
                // Transfer all styles
                newCopyBtn.style.cssText = copyBtn.style.cssText;
                copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
                
                newCopyBtn.addEventListener("click", function() {
                    copyToClipboard(commandEl.textContent, function(success) {
                        if (success) {
                            newCopyBtn.textContent = "Copied!";
                            newCopyBtn.style.backgroundColor = "#27AE60";
                            setTimeout(() => { 
                                newCopyBtn.textContent = "Copy"; 
                                newCopyBtn.style.backgroundColor = "#3E3D32";
                            }, 2000);
                        } else {
                            newCopyBtn.textContent = "Failed";
                            newCopyBtn.style.backgroundColor = "#E74C3C";
                            setTimeout(() => { 
                                newCopyBtn.textContent = "Copy"; 
                                newCopyBtn.style.backgroundColor = "#3E3D32";
                            }, 2000);
                        }
                    });
                });
                
                // Show the result
                resultDiv.style.display = "block";
            });
            
            actionsCell.appendChild(cloneBtn);
            
            // Delete button
            const deleteBtn = document.createElement("button");
            deleteBtn.className = "delete-history-btn";
            deleteBtn.textContent = "x"; // Using a simple lowercase 'x' instead
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
        
        // Debug: log what's being saved
        console.log("Saving workspace history with repos:", history.map(w => ({name: w.name, reposCount: w.repos ? w.repos.length : 0})));
        
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

// Export functions for use in other modules
window.extractTaskFromBranch = extractTaskFromBranch;
window.ensureWorkspaceNameInUrl = ensureWorkspaceNameInUrl;
window.createFullCloneUrl = createFullCloneUrl;
window.ensureValidCloneUrl = ensureValidCloneUrl;
window.createVirtualWorkspace = createVirtualWorkspace;
window.loadWorkspaceHistory = loadWorkspaceHistory;
window.addWorkspaceToHistory = addWorkspaceToHistory;
window.removeWorkspaceFromHistory = removeWorkspaceFromHistory;

// Ensure the setup for branch name to task name extraction is still called if needed
document.addEventListener("DOMContentLoaded", function() {
    // ... (your existing DOMContentLoaded listeners) ...
    const branchInput = document.getElementById("workspace-branch-name");
    if (branchInput) {
        branchInput.addEventListener("input", extractTaskFromBranch);
    }
    
    const createBtn = document.getElementById("create-workspace-btn");
    if (createBtn) {
        createBtn.addEventListener("click", createVirtualWorkspace);
    }

    // loadWorkspaceHistory(); // If you still want this feature
    // Consider removing or repurposing the copy clone command button logic
    // const copyBtn = document.getElementById("copy-clone-command-btn");
    // if (copyBtn) copyBtn.style.display = "none"; 
}); 