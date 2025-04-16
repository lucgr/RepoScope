// Minimal version with extensive logging
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
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.backgroundColor = '#ffeeee';
        errorDiv.style.padding = '10px';
        errorDiv.style.margin = '10px';
        errorDiv.style.border = '1px solid red';
        errorDiv.innerHTML = `<strong>${title}:</strong> ${message}`;
        document.body.prepend(errorDiv);
    } catch (e) {
        console.error("Error in displayError:", e);
    }
}

// Show message
function showMessage(message) {
    const existingMessage = document.querySelector('.status-message');
    if (existingMessage) {
        existingMessage.parentNode.removeChild(existingMessage);
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'status-message';
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 3000);
}

// Function to add a repository
function addRepository() {
    const urlInput = document.getElementById('new-repo-url');
    if (!urlInput) return;
    
    const url = urlInput.value.trim();
    if (!url) {
        alert('Please enter a repository URL');
        return;
    }
    
    if (!url.startsWith('https://gitlab.com/')) {
        alert('Please enter a valid GitLab repository URL (https://gitlab.com/...)');
        return;
    }
    
    chrome.storage.sync.get(['repoUrls'], function(data) {
        // Parse existing repos
        const existingRepos = data.repoUrls ? 
            data.repoUrls.split('\n').filter(u => u.trim()).map(u => u.trim()) : 
            [];
        
        // Check if repo already exists
        if (existingRepos.includes(url)) {
            alert('This repository is already in the list');
            return;
        }
        
        // Add new repo
        existingRepos.push(url);
        const updatedRepoUrls = existingRepos.join('\n');
        
        // Save to storage
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            // Update UI
            loadRepositoryList(updatedRepoUrls);
            updateWorkspaceRepoSelection(updatedRepoUrls);
            
            // Clear input
            urlInput.value = '';
            
            // Show success message
            showMessage('Repository added successfully');
        });
    });
}

// Function to remove a repository
function removeRepository(url) {
    if (!url) return;
    
    chrome.storage.sync.get(['repoUrls'], function(data) {
        // Parse existing repos
        const existingRepos = data.repoUrls ? 
            data.repoUrls.split('\n').filter(u => u.trim()).map(u => u.trim()) : 
            [];
        
        // Remove repo
        const updatedRepos = existingRepos.filter(r => r !== url);
        const updatedRepoUrls = updatedRepos.join('\n');
        
        // Save to storage
        chrome.storage.sync.set({ repoUrls: updatedRepoUrls }, function() {
            // Update UI
            loadRepositoryList(updatedRepoUrls);
            updateWorkspaceRepoSelection(updatedRepoUrls);
            
            // Show success message
            showMessage('Repository removed');
        });
    });
}

// Function to load repository list
function loadRepositoryList(repoUrlsString) {
    const repoList = document.getElementById('repo-list');
    if (!repoList) return;
    
    const tbody = repoList.querySelector('tbody');
    if (!tbody) return;
    
    const emptyState = document.getElementById('empty-repos');
    
    // Parse repos
    const repos = repoUrlsString ? 
        repoUrlsString.split('\n').filter(u => u.trim()).map(u => u.trim()) : 
        [];
    
    // Clear existing items
    tbody.innerHTML = '';
    
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = repos.length > 0 ? 'none' : 'block';
    }
    
    // Add repos to list
    if (repos.length > 0) {
        repos.forEach(function(repo) {
            const row = document.createElement('tr');
            
            // URL cell
            const urlCell = document.createElement('td');
            urlCell.textContent = repo;
            row.appendChild(urlCell);
            
            // Action cell
            const actionCell = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-repo-btn';
            deleteBtn.textContent = 'x';
            deleteBtn.setAttribute('data-url', repo);
            deleteBtn.onclick = function() {
                removeRepository(repo);
            };
            actionCell.appendChild(deleteBtn);
            row.appendChild(actionCell);
            
            tbody.appendChild(row);
        });
    }
}

// Function to update workspace repo selection
function updateWorkspaceRepoSelection(repoUrlsString) {
    const container = document.getElementById('workspace-repo-selection');
    if (!container) return;
    
    const emptyState = document.getElementById('empty-workspace-repos');
    
    // Parse repos
    const repos = repoUrlsString ? 
        repoUrlsString.split('\n').filter(u => u.trim()).map(u => u.trim()) : 
        [];
    
    // Clear existing items
    container.innerHTML = '';
    
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = repos.length > 0 ? 'none' : 'block';
    }
    
    // Add repos to selection
    if (repos.length > 0) {
        repos.forEach(function(repo, index) {
            const repoName = repo.split('/').pop().replace('.git', '');
            
            const item = document.createElement('div');
            item.className = 'repo-checkbox-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = 'repo-' + index;
            checkbox.value = repo;
            checkbox.checked = true;
            
            const label = document.createElement('label');
            label.htmlFor = 'repo-' + index;
            label.title = repo;
            label.textContent = repoName + ' (' + repo + ')';
            
            item.appendChild(checkbox);
            item.appendChild(label);
            container.appendChild(item);
        });
    }
}

// Function to save settings
function saveSettings() {
    const backendUrl = document.getElementById('backend-url')?.value || '';
    const gitlabToken = document.getElementById('gitlab-token')?.value || '';
    const repoUrls = getRepositoryUrls();
    
    if (gitlabToken) {
        // Validate token
        fetch('https://gitlab.com/api/v4/user', {
            headers: {
                'Authorization': 'Bearer ' + gitlabToken
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Invalid token: ' + response.status);
            }
            return response.json();
        })
        .then(user => {
            if (!user.username) {
                throw new Error('Invalid user data');
            }
            
            // Save all settings with username
            chrome.storage.sync.set({
                backendUrl: backendUrl,
                gitlabToken: gitlabToken,
                repoUrls: repoUrls,
                username: user.username
            }, function() {
                showMessage('Settings saved successfully!');
            });
        })
        .catch(error => {
            console.error('Token validation error:', error);
            alert('GitLab token is invalid. Please check and try again.');
            
            // Save other settings
            chrome.storage.sync.set({
                backendUrl: backendUrl,
                repoUrls: repoUrls
            }, function() {
                showMessage('Settings saved (without token)');
            });
        });
    } else {
        // Save without token
        chrome.storage.sync.set({
            backendUrl: backendUrl,
            repoUrls: repoUrls
        }, function() {
            showMessage('Settings saved');
        });
    }
}

// Function to get repository URLs from the table
function getRepositoryUrls() {
    const rows = document.querySelectorAll('#repo-list tbody tr');
    const urls = [];
    
    rows.forEach(function(row) {
        if (row.cells[0]) {
            const url = row.cells[0].textContent.trim();
            if (url) {
                urls.push(url);
            }
        }
    });
    
    return urls.join('\n');
}

// Handle tab switching
function setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabSections = document.querySelectorAll('.tab-section');
    
    tabButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            // Remove active class from all tabs
            tabButtons.forEach(function(btn) {
                btn.classList.remove('active');
            });
            
            tabSections.forEach(function(section) {
                section.classList.remove('active');
            });
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Show corresponding section
            const tabId = this.getAttribute('data-tab');
            if (tabId) {
                const section = document.getElementById(tabId);
                if (section) {
                    section.classList.add('active');
                }
            }
        });
    });
}

// Initialize popup - Called when DOM is ready
function initializePopup() {
    console.log('Initializing popup');
    
    // 1. Setup tab navigation
    setupTabNavigation();
    
    // 2. Setup Add Repository button
    const addRepoBtn = document.getElementById('add-repo-btn');
    if (addRepoBtn) {
        addRepoBtn.addEventListener('click', addRepository);
    }
    
    // 3. Setup Enter key for repo URL input
    const repoUrlInput = document.getElementById('new-repo-url');
    if (repoUrlInput) {
        repoUrlInput.addEventListener('keyup', function(event) {
            if (event.key === 'Enter' && addRepoBtn) {
                addRepoBtn.click();
            }
        });
    }
    
    // 4. Setup Save Settings button
    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', saveSettings);
    }
    
    // 5. Setup Refresh PRs button
    const refreshPRsBtn = document.getElementById('refresh-prs-btn');
    if (refreshPRsBtn) {
        refreshPRsBtn.addEventListener('click', loadUnifiedPRs);
    }
    
    // 6. Load saved settings
    chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'repoUrls'], function(data) {
        // Set backend URL
        const backendUrlInput = document.getElementById('backend-url');
        if (backendUrlInput && data.backendUrl) {
            backendUrlInput.value = data.backendUrl;
        }
        
        // Set GitLab token
        const gitlabTokenInput = document.getElementById('gitlab-token');
        if (gitlabTokenInput && data.gitlabToken) {
            gitlabTokenInput.value = data.gitlabToken;
        }
        
        // Load repository list
        loadRepositoryList(data.repoUrls || '');
        
        // Update workspace repo selection
        updateWorkspaceRepoSelection(data.repoUrls || '');
        
        // Load unified PRs
        loadUnifiedPRs();
    });
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', initializePopup);

// Load unified PRs from the backend
function loadUnifiedPRs() {
    console.log('Loading unified PRs');
    
    // Show loading indicator
    const contentArea = document.getElementById('unified-prs-content');
    if (contentArea) {
        contentArea.innerHTML = '<div class="loading">Loading unified PRs...</div>';
    }
    
    // Get settings from storage
    chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken'], function(data) {
        const backendUrl = data.backendUrl;
        const repoUrls = data.repoUrls;
        const gitlabToken = data.gitlabToken;
        
        // Check if all required settings are present
        if (!backendUrl || !repoUrls || !gitlabToken) {
            if (contentArea) {
                contentArea.innerHTML = '<div class="error">Please configure Backend URL, Repository URLs, and GitLab Token in the Settings tab.</div>';
            }
            console.error('Cannot load unified PRs: Missing settings', { backendUrl, repoUrls, gitlabToken });
            return;
        }

        // Create query string from repository URLs
        const repoUrlsArray = repoUrls.split('\n').filter(url => url.trim().length > 0);
        if (repoUrlsArray.length === 0) {
            if (contentArea) {
                contentArea.innerHTML = '<div class="error">No repository URLs specified.</div>';
            }
            return;
        }
        
        const repoQuery = repoUrlsArray.map(url => `repo_urls=${encodeURIComponent(url)}`).join('&');
        
        // Fetch unified PRs from backend
        const apiUrl = `${backendUrl}/api/prs/unified?${repoQuery}`;
        console.log('Fetching unified PRs from:', apiUrl);
        
        fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-gitlab-token': gitlabToken
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Unified PRs data structure:', JSON.stringify(data, null, 2));
            
            // First show the UI with the data we have
            updateUnifiedPRsUI(data);
            
            // Then fetch approval statuses
            fetchApprovalStatuses(data, gitlabToken);
        })
        .catch(error => {
            console.error('Failed to fetch unified PRs:', error);
            if (contentArea) {
                contentArea.innerHTML = `<div class="error">Failed to load unified PRs: ${error.message}</div>`;
            }
        });
    });
}

// Fetch approval statuses from GitLab API
function fetchApprovalStatuses(data, gitlabToken) {
    // Skip if no token
    if (!gitlabToken) return;
    
    // Check if we got a single task or an array of tasks
    const tasks = Array.isArray(data) ? data : [data];
    
    // Process each task
    tasks.forEach(task => {
        const prs = task.prs || [];
        let approvedCount = 0;
        
        // Process each PR to fetch its approval status
        prs.forEach(pr => {
            // Extract project ID and merge request IID
            const projectPath = getProjectPathFromUrl(pr.repository_url);
            const mrIid = pr.iid;
            
            if (!projectPath || !mrIid) return;
            
            // Construct GitLab API URL
            const apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrIid}/approvals`;
            
            // Fetch approval data
            fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to fetch approval status: ${response.status}`);
                }
                return response.json();
            })
            .then(approvalData => {
                console.log(`Approval data for PR ${pr.id}:`, approvalData);
                
                // Update PR with approval data
                pr.approved = approvalData.approved;
                pr.approved_by = approvalData.approved_by || [];
                pr.approvals_required = approvalData.approvals_required || 0;
                
                // More strict check for approval status
                pr.isApproved = approvalData.approved === true && 
                                approvalData.approved_by && 
                                approvalData.approved_by.length > 0;
                
                // Update UI for this PR
                updatePrApprovalStatus(pr);
                
                // Count approved PRs
                if (pr.isApproved) {
                    approvedCount++;
                }
                
                // If we've processed all PRs, check if task is fully approved
                if (approvedCount === prs.length) {
                    updateTaskApprovalStatus(task.task_name);
                }
            })
            .catch(error => {
                console.error(`Failed to fetch approval status for PR ${pr.id}:`, error);
            });
        });
    });
}

// Helper function to extract project path from repository URL
function getProjectPathFromUrl(repoUrl) {
    if (!repoUrl) return null;
    
    // Extract path from GitLab URL
    // Format: https://gitlab.com/username/project
    const match = repoUrl.match(/gitlab\.com\/([^\/]+\/[^\/]+)(?:\/|$)/);
    return match ? match[1] : null;
}

// Update the UI with approval status for a single PR
function updatePrApprovalStatus(pr) {
    // Find the PR item in the DOM
    const prItem = document.querySelector(`.pr-item[data-pr-id="${pr.id}"]`);
    if (!prItem) return;
    
    // Update the approve button
    const approveBtn = prItem.querySelector('.approve-btn');
    if (approveBtn) {
        if (pr.isApproved) {
            approveBtn.disabled = true;
            approveBtn.textContent = 'Approved';
        } else {
            // Make sure it's not incorrectly marked as approved
            approveBtn.disabled = false;
            approveBtn.textContent = 'Approve';
        }
    }
}

// Check if all PRs in a task are approved and update UI
function updateTaskApprovalStatus(taskName) {
    // Find the task group in the DOM
    const taskGroups = document.querySelectorAll('.task-group');
    
    // Go through each task group
    taskGroups.forEach(taskGroup => {
        const header = taskGroup.querySelector('.task-header h3');
        if (!header || !header.textContent.includes(taskName)) return;
        
        // Check if all PR buttons are disabled (meaning they're all approved)
        const allButtons = taskGroup.querySelectorAll('.approve-btn');
        const notApprovedButtons = taskGroup.querySelectorAll('.approve-btn:not([disabled])');
        
        // Only update if all PRs are approved and there's at least one PR
        if (notApprovedButtons.length === 0 && allButtons.length > 0) {
            // All PRs are approved, replace the "Approve All" button with "All PRs approved" message
            const approveAllBtn = taskGroup.querySelector('.approve-all-btn');
            if (approveAllBtn) {
                const allApprovedDiv = document.createElement('div');
                allApprovedDiv.className = 'all-approved';
                allApprovedDiv.textContent = 'All PRs approved';
                approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
            }
        }
    });
}

// Update UI with unified PRs
function updateUnifiedPRsUI(data) {
    const contentArea = document.getElementById('unified-prs-content');
    if (!contentArea) return;
    
    // Handle case where no tasks are returned
    if (!data) {
        contentArea.innerHTML = '<div class="no-prs">No tasks or pull requests found.</div>';
        return;
    }
    
    // Check if we got a single task or an array of tasks
    const tasks = Array.isArray(data) ? data : [data];
    
    if (tasks.length === 0) {
        contentArea.innerHTML = '<div class="no-prs">No tasks found.</div>';
        return;
    }
    
    // Add some inline CSS to properly style the pipeline badges
    const inlineStyles = `
        <style>
            .pipeline-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.8em;
                margin-right: 8px;
                white-space: nowrap;
                text-align: center;
                min-width: 80px;
            }
            .pipeline-badge.success {
                background-color: #27AE60;
                color: white;
            }
            .pipeline-badge.failed {
                background-color: #E74C3C;
                color: white;
            }
            .pipeline-badge.running, .pipeline-badge.pending {
                background-color: #F39C12;
                color: white;
            }
            .pipeline-badge.none {
                background-color: #95A5A6;
                color: white;
            }
            .pr-item {
                display: flex;
                align-items: center;
                padding: 8px;
                border-bottom: 1px solid #eee;
            }
            .pr-info {
                flex-grow: 1;
            }
            .pr-status {
                margin: 0 10px;
            }
            .all-approved {
                color: #27AE60;
                font-weight: bold;
                text-align: center;
                padding: 8px;
            }
            .approve-btn:disabled {
                background-color: #95A5A6;
                color: white;
                cursor: not-allowed;
                opacity: 0.7;
            }
        </style>
    `;
    
    let html = inlineStyles;
    
    // Process each task
    for (const task of tasks) {
        const taskId = task.task_name || 'Unknown Task';
        const prs = task.prs || [];
        
        if (prs.length === 0) {
            continue; // Skip tasks with no PRs
        }
        
        // For initial rendering, we don't know approval status yet
        // It will be updated via GitLab API later
        
        html += `
            <div class="task-group">
                <div class="task-header">
                    <h3>${taskId}</h3>
                    <button class="approve-all-btn" data-task="${taskId}">Approve All</button>
                </div>
                <div class="pr-list">
        `;
        
        for (const pr of prs) {
            // Extract required fields with fallbacks
            const id = pr.id || '';
            const title = pr.title || 'Untitled PR';
            const repo = pr.repository_name || 'Unknown Repo';
            const web_url = pr.web_url || '#';
            
            // Handle pipeline status
            const pipelineStatus = pr.pipeline_status || 'none';
            const pipelineClass = getPipelineStatusClass(pipelineStatus);
            const pipelineTitle = getPipelineStatusTitle(pipelineStatus);
            const pipelineLabel = getPipelineStatusLabel(pipelineStatus);
            
            html += `
                <div class="pr-item" data-pr-id="${id}" data-repo="${repo}">
                    <div class="pr-info">
                        <a href="${web_url}" target="_blank" class="pr-title">${title}</a>
                        <span class="pr-project">${repo}</span>
                    </div>
                    <div class="pr-status">
                        <span class="pipeline-badge ${pipelineClass}" title="${pipelineTitle}">
                            ${pipelineLabel}
                        </span>
                    </div>
                    <div class="pr-actions">
                        <button class="approve-btn" data-pr-id="${id}" data-repo-url="${pr.repository_url || ''}">
                            Approve
                        </button>
                    </div>
                </div>
            `;
        }
        
        html += `
                </div>
            </div>
        `;
    }
    
    if (html === '') {
        contentArea.innerHTML = '<div class="no-prs">No pull requests found in any task.</div>';
    } else {
        contentArea.innerHTML = html;
    }
    
    // Add event listeners for approve buttons
    const approveBtns = contentArea.querySelectorAll('.approve-btn:not([disabled])');
    approveBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const prId = this.dataset.prId;
            const repoUrl = this.dataset.repoUrl;
            approvePR(repoUrl, prId, this);
        });
    });
    
    // Add event listeners for approve all buttons
    const approveAllBtns = contentArea.querySelectorAll('.approve-all-btn');
    approveAllBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const taskId = this.dataset.task;
            approveAllPRs(taskId);
        });
    });
}

// Approve a single PR
function approvePR(repoUrl, prId, button) {
    button.disabled = true;
    button.textContent = 'Approving...';
    
    chrome.storage.sync.get(['gitlabToken', 'backendUrl'], function(data) {
        const gitlabToken = data.gitlabToken;
        const backendUrl = data.backendUrl;
        
        if (!gitlabToken || !backendUrl) {
            alert('GitLab token or Backend URL not set');
            button.disabled = false;
            button.textContent = 'Approve';
            return;
        }

        fetch(`${backendUrl}/api/prs/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-gitlab-token': gitlabToken
            },
            body: JSON.stringify({
                repositoryUrl: repoUrl,
                mergeRequestId: prId
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to approve: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('PR approved:', data);
            button.textContent = 'Approved';
            button.disabled = true;
            
            // Mark this PR as approved
            const prItem = button.closest('.pr-item');
            if (prItem) {
                prItem.dataset.approved = 'true';
            }
            
            // Check if all PRs in this task are now approved
            checkAllTaskPRsApproved(button);
        })
        .catch(error => {
            console.error('Failed to approve PR:', error);
            button.disabled = false;
            button.textContent = 'Approve';
            alert(`Failed to approve PR: ${error.message}`);
        });
    });
}

// Check if all PRs in a task group are approved
function checkAllTaskPRsApproved(button) {
    const prItem = button.closest('.pr-item');
    if (!prItem) return;
    
    const taskGroup = prItem.closest('.task-group');
    if (!taskGroup) return;
    
    // Check if all approve buttons are disabled (meaning they're all approved)
    const notApprovedButtons = taskGroup.querySelectorAll('.approve-btn:not([disabled])');
    
    if (notApprovedButtons.length === 0) {
        // All PRs are approved, replace the "Approve All" button with "All PRs approved" message
        const approveAllBtn = taskGroup.querySelector('.approve-all-btn');
        if (approveAllBtn) {
            const allApprovedDiv = document.createElement('div');
            allApprovedDiv.className = 'all-approved';
            allApprovedDiv.textContent = 'All PRs approved';
            approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
        }
    }
}

// Approve all PRs in a task group
function approveAllPRs(taskId) {
    const taskGroup = document.querySelector(`.task-group .task-header h3:contains('${taskId}')`).closest('.task-group');
    if (!taskGroup) return;
    
    const approveAllBtn = taskGroup.querySelector('.approve-all-btn');
    if (approveAllBtn) {
        approveAllBtn.disabled = true;
        approveAllBtn.textContent = 'Approving...';
    }
    
    const approveBtns = taskGroup.querySelectorAll('.approve-btn:not([disabled])');
    let approvalPromises = [];
    
    approveBtns.forEach(btn => {
        const prId = btn.dataset.prId;
        const repoUrl = btn.dataset.repoUrl;
        
        btn.disabled = true;
        btn.textContent = 'Approving...';
        
        const promise = new Promise((resolve, reject) => {
            chrome.storage.sync.get(['gitlabToken', 'backendUrl'], function(data) {
                const gitlabToken = data.gitlabToken;
                const backendUrl = data.backendUrl;
                
                if (!gitlabToken || !backendUrl) {
                    reject(new Error('GitLab token or Backend URL not set'));
                    return;
                }
                
                fetch(`${backendUrl}/api/prs/approve`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-gitlab-token': gitlabToken
                    },
                    body: JSON.stringify({
                        repositoryUrl: repoUrl,
                        mergeRequestId: prId
                    })
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to approve: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('PR approved:', data);
                    btn.textContent = 'Approved';
                    
                    // Update UI to reflect approval
                    const prItem = btn.closest('.pr-item');
                    if (prItem) {
                        const approvalStatus = prItem.querySelector('.approval-status');
                        if (approvalStatus) {
                            approvalStatus.className = 'approval-status approved';
                            approvalStatus.innerHTML = '✓';
                            approvalStatus.title = 'Approved';
                        }
                    }
                    
                    resolve();
                })
                .catch(error => {
                    console.error('Failed to approve PR:', error);
                    btn.disabled = false;
                    btn.textContent = 'Approve';
                    reject(error);
                });
            });
        });
        
        approvalPromises.push(promise);
    });
    
    Promise.allSettled(approvalPromises)
        .then(results => {
            if (approveAllBtn) {
                const failures = results.filter(r => r.status === 'rejected').length;
                
                if (failures === 0) {
                    approveAllBtn.textContent = 'All Approved';
                } else {
                    approveAllBtn.textContent = `Failed ${failures}/${approvalPromises.length}`;
                    approveAllBtn.disabled = false;
                }
            }
        });
}

// Helper function for contains-like selector (since it's not standard)
Element.prototype.contains = function(text) {
    return this.textContent.includes(text);
};

// Helper function to get pipeline status class
function getPipelineStatusClass(status) {
    if (!status || status === 'none' || status === 'null') return 'none';
    
    switch(status.toLowerCase()) {
        case 'success':
        case 'passed':
            return 'success';
        case 'failed':
            return 'failed';
        case 'running':
        case 'pending':
            return 'running';
        default:
            return status.toLowerCase();
    }
}

// Helper function to get pipeline status title
function getPipelineStatusTitle(status) {
    if (!status || status === 'none' || status === 'null') return 'No pipeline';
    
    switch(status.toLowerCase()) {
        case 'success':
        case 'passed':
            return 'Pipeline: Success';
        case 'failed':
            return 'Pipeline: Failed';
        case 'running':
            return 'Pipeline: Running';
        case 'pending':
            return 'Pipeline: Pending';
        default:
            return `Pipeline: ${status}`;
    }
}

// Helper function to get pipeline status label
function getPipelineStatusLabel(status) {
    if (!status || status === 'none' || status === 'null') return 'No CI';
    
    switch(status.toLowerCase()) {
        case 'success':
        case 'passed':
            return 'CI: Success';
        case 'failed':
            return 'CI: Failed';
        case 'running':
            return 'CI: Running';
        case 'pending':
            return 'CI: Pending';
        default:
            return `CI: ${status}`;
    }
}