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
        
        // Normalize backend URL - remove any trailing slashes
        backendUrl = backendUrl.replace(/\/+$/, "");
        
        // Function to reset create button
        function resetCreateButton() {
            createBtn.disabled = false;
            createBtn.textContent = originalBtnText;
            const spinner = document.getElementById("workspace-loading");
            if (spinner) spinner.remove();
        }
        
        // Read the commit submodules script content
        fetch(chrome.runtime.getURL("/backend-scripts/commit-submodules.sh"))
            .then(response => response.text())
            .then(scriptContent => {
                // Prepare comprehensive payload with explicit naming directives
                const payload = {
                    name: workspaceName,                  // Standard name field
                    workspace_name: workspaceName,        // Older API compatibility
                    repo_name: workspaceName,             // Explicit repository name
                    repository_name: workspaceName,       // Alternative naming field
                    project_name: workspaceName,          // GitLab specific
                    task_name: taskName,
                    branch_name: branchName,
                    repo_urls: selectedRepos,
                    use_custom_name: true,                // Flag to use custom name
                    use_workspace_name: true,             // Alternative flag
                    force_name_override: true,            // Force override branch-based naming
                    script_content: scriptContent
                };
                
                console.log("Creating workspace with payload:", payload);
                
                // Create workspace request
                fetch(`${backendUrl}/api/workspace/create`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-gitlab-token": gitlabToken,
                        "x-requested-name": workspaceName         // Additional header for name
                    },
                    body: JSON.stringify(payload)
                })
                .then(response => {
                    if (!response.ok) {
                        // Try to get error details from response
                        return response.json().then(errData => {
                            console.error("Error details from API:", errData);
                            throw new Error(`Failed to create workspace: ${response.status} - ${errData.detail || JSON.stringify(errData)}`);
                        }).catch(err => {
                            if (err.message.includes("Failed to create workspace")) {
                                throw err;
                            }
                            throw new Error(`Failed to create workspace: ${response.status}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log("Workspace created, API response:", data);
                    
                    // Show result
                    resultDiv.style.display = "block";
                    
                    // Log all potential URL fields for debugging
                    console.log("URL fields in response:", {
                        clone_url: data.clone_url,
                        cloneUrl: data.cloneUrl,
                        url: data.url,
                        path: data.path,
                        local_path: data.local_path,
                        git_url: data.git_url,
                        ssh_url: data.ssh_url,
                        repository_url: data.repository_url
                    });
                    
                    let cloneUrl;
                    
                    // Check if we have a local file path (Windows or Unix style)
                    const isWindowsPath = /^[A-Z]:\\/.test(data.clone_url || data.cloneUrl || data.path || data.local_path || "");
                    const isUnixPath = /^\/(?!http)/.test(data.clone_url || data.cloneUrl || data.path || data.local_path || "");
                    
                    if (isWindowsPath || isUnixPath) {
                        console.log("Detected local file path");
                        
                        // If we have a local file path, use it directly
                        const localPaths = [
                            data.local_path,
                            data.path,
                            data.clone_url,
                            data.cloneUrl
                        ].filter(p => p && (p.includes(":\\") || p.startsWith("/"))); // Filter for valid file paths
                        
                        if (localPaths.length > 0) {
                            // Check if the path contains the workspace name
                            const pathWithWorkspaceName = localPaths.find(p => 
                                p.includes(workspaceName) || 
                                p.endsWith(workspaceName) || 
                                p.endsWith(`${workspaceName}.git`)
                            );
                            
                            // Prefer path with workspace name, otherwise use the first path
                            cloneUrl = pathWithWorkspaceName || localPaths[0];
                            
                            console.log("Using local file path:", cloneUrl);
                        } else {
                            // Construct a path based on standard temp directories
                            console.log("No valid local path found, constructing a default");
                            
                            // Guess a reasonable local path
                            if (navigator.platform.includes("Win")) {
                                cloneUrl = `C:\\Users\\${navigator.userAgent.split("Windows NT ")[1]?.split(";")[0] || "username"}\\AppData\\Local\\Temp\\virtual_workspaces\\${workspaceName}`;
                            } else {
                                cloneUrl = `/tmp/virtual_workspaces/${workspaceName}`;
                            }
                        }
                    } else {
                        // Not a local path, proceed with the normal URL handling
                        // Complete URLs provided by the API (prefer these)
                        const possibleUrls = [
                            data.clone_url,
                            data.cloneUrl,
                            data.git_url,
                            data.url,
                            data.repository_url,
                            data.web_url
                        ].filter(u => u); // Filter out undefined or empty values
                        
                        // First try to find a URL that contains the workspace name
                        const preferredUrl = possibleUrls.find(url => 
                            url.includes(workspaceName) || url.includes(encodeURIComponent(workspaceName))
                        );
                        
                        // Use the preferred URL if found, otherwise use the first URL in the list
                        cloneUrl = preferredUrl || possibleUrls[0];
                        
                        // If we still don't have a URL, construct one using our helper
                        if (!cloneUrl) {
                            if (selectedRepos.length > 0) {
                                // Use the first selected repo URL as a base
                                const baseUrl = selectedRepos[0].replace(/\/[^\/]+\.git$/, "");
                                cloneUrl = ensureValidCloneUrl(null, baseUrl, workspaceName);
                            } else {
                                // Last resort: guess a URL
                                cloneUrl = `https://gitlab.com/your-user/${workspaceName}.git`;
                            }
                        }
                    }
                    
                    // Final validation and cleanup
                    if (cloneUrl) {
                        // Update clone command with the correct URL
                        updateCloneCommand(cloneUrl);
                        
                        // Record workspace in history
                        const workspace = {
                            name: workspaceName,
                            branch: branchName,
                            task: taskName,
                            repos: selectedRepos, // Ensure this is an array of repo URLs
                            clone_url: cloneUrl,
                            created_at: new Date().toISOString()
                        };
                        
                        // Debug: log what's being stored
                        console.log("Storing workspace with repos:", workspace.repos);
                        console.log("Storing clone URL:", cloneUrl);
                        
                        addWorkspaceToHistory(workspace);
                    } else {
                        document.getElementById("clone-command").textContent = "# Error: Could not determine clone URL";
                        document.getElementById("workspace-result").style.display = "block";
                    }
                    
                    // Reset button
                    resetCreateButton();
                })
                .catch(error => {
                    console.error("Failed to create workspace:", error);
                    
                    // Show error message
                    resultDiv.style.display = "block";
                    document.getElementById("clone-command").textContent = `# Error: ${error.message}`;
                    
                    // Reset button
                    resetCreateButton();
                });
            })
            .catch(error => {
                console.error("Failed to load commit-submodules.sh:", error);
                resetCreateButton();
                resultDiv.style.display = "block";
                document.getElementById("clone-command").textContent = `# Error: Failed to load helper scripts: ${error.message}`;
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
            } else if (!Array.isArray(workspace.repos) && typeof workspace.repos === 'string') {
                workspace.repos = workspace.repos.split(',').map(r => r.trim()).filter(r => r);
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
                
                // Create or update command textarea
                let commandEl = resultDiv.querySelector("textarea");
                if (!commandEl) {
                    commandEl = document.createElement("textarea");
                    commandEl.readOnly = true;
                    resultDiv.appendChild(commandEl);
                }
                
                // Determine if it's a local path or remote URL
                const url = workspace.clone_url;
                const isLocalPath = url && (url.includes(":\\") || url.startsWith("/"));
                
                if (isLocalPath) {
                    // For local path, use cd command
                    const cd = navigator.platform.includes("Win") ? "cd" : "cd";
                    const command = `${cd} "${url}"

# Initialize and update all submodules
./multi-repo init

# To create branches in all submodules
./multi-repo branch ${workspace.branch || "feature/your-branch"}

# For help on other commands
./multi-repo help`;
                    
                    commandEl.value = command;
                } else {
                    // For remote URL, use git clone
                    const command = `git clone "${url}" ${workspace.name}
cd ${workspace.name}

# Initialize and update all submodules
./multi-repo init

# To create branches in all submodules
./multi-repo branch ${workspace.branch || "feature/your-branch"}

# For help on other commands
./multi-repo help`;
                    
                    commandEl.value = command;
                }
                
                // Create or update copy button
                let copyBtn = resultDiv.querySelector("button");
                if (!copyBtn) {
                    copyBtn = document.createElement("button");
                    copyBtn.className = "copy-history-cmd-btn";
                    copyBtn.textContent = "Copy";
                    resultDiv.appendChild(copyBtn);
                }
                
                copyBtn.addEventListener("click", function() {
                    copyToClipboard(commandEl.value, function(success) {
                        if (success) {
                            copyBtn.textContent = "Copied!";
                            setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
                        } else {
                            copyBtn.textContent = "Failed";
                            setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
                        }
                    });
                });
                
                // Show the result
                resultDiv.style.display = "block";
            });
            
            actionsCell.appendChild(cloneBtn);
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
        if (typeof workspace.repos === 'string') {
            workspace.repos = workspace.repos.split(',').map(r => r.trim()).filter(r => r);
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

// Function to update clone command for a workspace result
function updateCloneCommand(url) {
    if (!url) {
        document.getElementById("clone-command").textContent = "# Error: No clone URL available";
        return;
    }
    
    console.log("Original URL for clone command:", url);
    
    const cloneCommandEl = document.getElementById("clone-command");
    if (!cloneCommandEl) {
        console.error("Clone command element not found");
        return;
    }
    
    // Get workspace name and branch
    const workspaceName = document.getElementById("workspace-name").value.trim();
    const branchName = document.getElementById("workspace-branch-name").value.trim();
    
    // Determine if it's a local path or remote URL
    const isLocalPath = url.includes(":\\") || url.startsWith("/");
    
    // Format the URL properly for git
    let formattedUrl = url;
    
    if (isLocalPath) {
        // For local paths, convert them to file:/// format for Git
        formattedUrl = url.replace(/\\/g, '/');
        if (formattedUrl.startsWith('/')) {
            formattedUrl = 'file://' + formattedUrl;
        } else {
            // Windows path needs three slashes
            formattedUrl = 'file:///' + formattedUrl;
        }
        console.log("Converted local path to Git URL:", formattedUrl);
    }
    
    // For all URLs, use git clone format
    const command = `git clone "${formattedUrl}" ${workspaceName}`;
    console.log("Generated clone command:", command);
    
    // Set the command text - just show the clone command, not the notes
    cloneCommandEl.textContent = command;
    
    // Style the clone command
    cloneCommandEl.style.backgroundColor = "#272822";
    cloneCommandEl.style.color = "#f8f8f2";
    cloneCommandEl.style.padding = "10px";
    cloneCommandEl.style.borderRadius = "4px";
    cloneCommandEl.style.border = "1px solid #1e1f1c";
    cloneCommandEl.style.fontFamily = "monospace";
    cloneCommandEl.style.fontSize = "13px";
    cloneCommandEl.style.width = "100%";
    cloneCommandEl.style.boxSizing = "border-box";
    cloneCommandEl.style.display = "block";
    cloneCommandEl.style.overflow = "auto";
    cloneCommandEl.style.whiteSpace = "pre";
    
    // Ensure the result div is visible
    document.getElementById("workspace-result").style.display = "block";
    
    // Add note about next steps in a separate element
    let noteEl = document.getElementById("clone-command-note");
    if (!noteEl) {
        noteEl = document.createElement("div");
        noteEl.id = "clone-command-note";
        noteEl.style.marginTop = "15px";
        noteEl.style.fontSize = "0.9em";
        noteEl.style.color = "#555";
        noteEl.style.backgroundColor = "#f5f7f9";
        noteEl.style.padding = "10px";
        noteEl.style.borderRadius = "4px";
        noteEl.style.border = "1px solid #e0e5e9";
        cloneCommandEl.parentNode.appendChild(noteEl);
    }
    
    noteEl.innerHTML = `
        <p style="margin-top: 0; font-weight: 600;">After cloning:</p>
        <ol style="padding-left: 20px; margin-bottom: 0;">
            <li>Change to the directory: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">cd ${workspaceName}</code></li>
            <li>Initialize submodules: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">./multi-repo init</code></li>
            <li>Create branches: <code style="background: #eee; padding: 2px 4px; border-radius: 3px;">./multi-repo branch ${branchName}</code></li>
        </ol>
    `;
    
    // Setup copy button
    setupCopyCloneButton();
}

// Setup the copy functionality for the clone command
function setupCopyCloneButton() {
    const copyBtn = document.getElementById("copy-clone-command");
    const cloneCommandEl = document.getElementById("clone-command");
    
    if (!copyBtn || !cloneCommandEl) {
        console.error("Copy button or clone command element not found");
        return;
    }
    
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
    
    // Make sure the container has position relative for absolute positioning of the button
    const commandContainer = cloneCommandEl.parentNode;
    if (commandContainer) {
        commandContainer.style.position = "relative";
    }
    
    // Remove existing listeners by cloning and replacing the button
    const newCopyBtn = copyBtn.cloneNode(true);
    // Transfer all styles
    newCopyBtn.style.cssText = copyBtn.style.cssText;
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    
    // Add new click listener
    newCopyBtn.addEventListener("click", function() {
        const commandText = cloneCommandEl.textContent;
        if (!commandText) {
            console.error("No command text to copy");
            return;
        }
        
        // Only copy the clone command, not any notes
        copyToClipboard(commandText, function(success) {
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
}

// Export functions for use in other modules
window.extractTaskFromBranch = extractTaskFromBranch;
window.ensureWorkspaceNameInUrl = ensureWorkspaceNameInUrl;
window.createFullCloneUrl = createFullCloneUrl;
window.ensureValidCloneUrl = ensureValidCloneUrl;
window.createVirtualWorkspace = createVirtualWorkspace;
window.loadWorkspaceHistory = loadWorkspaceHistory;
window.addWorkspaceToHistory = addWorkspaceToHistory;
window.updateCloneCommand = updateCloneCommand;
window.setupCopyCloneButton = setupCopyCloneButton; 