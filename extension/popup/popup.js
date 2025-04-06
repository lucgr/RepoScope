document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'repoUrls', 'username'], (data) => {
        console.log('Loaded settings:', data);
        document.getElementById('backend-url').value = data.backendUrl || '';
        document.getElementById('gitlab-token').value = data.gitlabToken || '';
        
        // Load saved repos
        loadRepositoryList(data.repoUrls || '');
        
        // Validate GitLab token if it exists
        if (data.gitlabToken) {
            validateGitLabToken(data.gitlabToken);
        }
        
        // Extract username from GitLab token if not already stored
        if (data.gitlabToken && !data.username) {
            fetch('https://gitlab.com/api/v4/user', {
                headers: {
                    'Authorization': `Bearer ${data.gitlabToken}`
                }
            })
            .then(response => response.json())
            .then(user => {
                console.log('Got GitLab user:', user);
                if (user.username) {
                    chrome.storage.sync.set({ username: user.username }, () => {
                        console.log('Username saved:', user.username);
                        // Reload PRs after getting username
                        loadUnifiedPRs();
                    });
                }
            })
            .catch(error => console.error('Error fetching GitLab user:', error));
        }
        
        // If we have all required settings, load unified PRs
        if (data.backendUrl && data.gitlabToken && data.repoUrls) {
            loadUnifiedPRs();
        }
    });

    // Repository management
    function loadRepositoryList(repoUrlsString) {
        const repoList = document.getElementById('repo-list').querySelector('tbody');
        const emptyState = document.getElementById('empty-repos');
        
        // Clear existing items
        repoList.innerHTML = '';
        
        // Parse repo URLs
        const repoUrls = repoUrlsString.split('\n')
            .filter(url => url.trim())
            .map(url => url.trim());
        
        // Show/hide empty state
        if (repoUrls.length === 0) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
            
            // Add each repo to the table
            repoUrls.forEach(url => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${url}</td>
                    <td>
                        <button class="delete-repo-btn" data-url="${url}">x</button>
                    </td>
                `;
                repoList.appendChild(row);
            });
            
            // Add delete event listeners
            document.querySelectorAll('.delete-repo-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    removeRepository(this.getAttribute('data-url'));
                });
            });
        }
    }
    
    function getRepositoryUrls() {
        const repoUrls = [];
        const rows = document.querySelectorAll('#repo-list tbody tr');
        
        rows.forEach(row => {
            const url = row.cells[0].textContent.trim();
            if (url) {
                repoUrls.push(url);
            }
        });
        
        return repoUrls.join('\n');
    }
    
    function addRepository(url) {
        // Validate URL format (simple validation)
        if (!url.startsWith('https://gitlab.com/')) {
            alert('Please enter a valid GitLab repository URL (https://gitlab.com/...)');
            return false;
        }
        
        // Get existing repos
        const repoUrlsString = getRepositoryUrls();
        const repoUrls = repoUrlsString.split('\n').filter(u => u.trim());
        
        // Check if URL already exists
        if (repoUrls.includes(url)) {
            alert('This repository is already in the list');
            return false;
        }
        
        // Add to list and reload
        repoUrls.push(url);
        loadRepositoryList(repoUrls.join('\n'));
        return true;
    }
    
    function removeRepository(url) {
        // Get existing repos
        const repoUrlsString = getRepositoryUrls();
        const repoUrls = repoUrlsString.split('\n').filter(u => u.trim());
        
        // Remove the URL
        const newRepoUrls = repoUrls.filter(u => u !== url);
        loadRepositoryList(newRepoUrls.join('\n'));
    }
    
    // Add repository button event
    document.getElementById('add-repo-btn').addEventListener('click', () => {
        const newRepoInput = document.getElementById('new-repo-url');
        const url = newRepoInput.value.trim();
        
        if (url) {
            if (addRepository(url)) {
                // Clear input if successfully added
                newRepoInput.value = '';
            }
        } else {
            alert('Please enter a repository URL');
        }
    });
    
    // Allow pressing Enter in the input field to add a repo
    document.getElementById('new-repo-url').addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            document.getElementById('add-repo-btn').click();
        }
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', () => {
        const backendUrl = document.getElementById('backend-url').value;
        const gitlabToken = document.getElementById('gitlab-token').value;
        const repoUrls = getRepositoryUrls();

        console.log('Saving settings:', { backendUrl, gitlabToken, repoUrls });

        // Add status indicator for token validation
        const statusDiv = document.createElement('div');
        statusDiv.id = 'token-validation-status';
        statusDiv.className = 'validation-in-progress';
        statusDiv.textContent = 'Validating GitLab token...';
        
        // Find or create status container
        let statusContainer = document.getElementById('token-status-container');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.id = 'token-status-container';
            const tokenField = document.getElementById('gitlab-token');
            tokenField.parentNode.insertBefore(statusContainer, tokenField.nextSibling);
        }
        
        statusContainer.innerHTML = '';
        statusContainer.appendChild(statusDiv);

        // When token changes, validate it first before saving
        if (gitlabToken) {
            fetch('https://gitlab.com/api/v4/user', {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`GitLab API responded with status: ${response.status}`);
                }
                return response.json();
            })
            .then(user => {
                console.log('Got GitLab user:', user);
                if (!user.username) {
                    throw new Error('Invalid user data returned from GitLab');
                }
                
                // Update status to success
                statusDiv.className = 'validation-success';
                statusDiv.textContent = `Valid token (authenticated as ${user.username})`;
                
                // Save all settings with username
                chrome.storage.sync.set({
                    backendUrl,
                    gitlabToken,
                    repoUrls,
                    username: user.username
                }, () => {
                    console.log('Settings saved successfully with username');
                    loadUnifiedPRs();
                });
            })
            .catch(error => {
                console.error('Error validating GitLab token:', error);
                
                // Update status to error
                statusDiv.className = 'validation-error';
                statusDiv.textContent = `Invalid GitLab token: ${error.message}`;
                
                // Don't save invalid token
                chrome.storage.sync.set({
                    backendUrl,
                    repoUrls
                }, () => {
                    console.log('Settings saved without GitLab token due to validation error');
                });
            });
        } else {
            // No token provided
            statusDiv.className = 'validation-warning';
            statusDiv.textContent = 'No GitLab token provided';
            
            chrome.storage.sync.set({
                backendUrl,
                gitlabToken: '',
                repoUrls,
                username: ''
            }, () => {
                console.log('Settings saved without GitLab token');
            });
        }
    });

    // Function to validate GitLab token
    async function validateGitLabToken(token) {
        if (!token) return;
        
        // Create or get status container
        let statusContainer = document.getElementById('token-status-container');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.id = 'token-status-container';
            const tokenField = document.getElementById('gitlab-token');
            tokenField.parentNode.insertBefore(statusContainer, tokenField.nextSibling);
        }
        
        // Create status div
        const statusDiv = document.createElement('div');
        statusDiv.id = 'token-validation-status';
        statusDiv.className = 'validation-in-progress';
        statusDiv.textContent = 'Validating GitLab token...';
        statusContainer.innerHTML = '';
        statusContainer.appendChild(statusDiv);
        
        try {
            const response = await fetch('https://gitlab.com/api/v4/user', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`GitLab API responded with status: ${response.status}`);
            }
            
            const user = await response.json();
            if (!user.username) {
                throw new Error('Invalid user data returned from GitLab');
            }
            
            // Token is valid
            statusDiv.className = 'validation-success';
            statusDiv.textContent = `Valid token (authenticated as ${user.username})`;
            
            return true;
        } catch (error) {
            console.error('Error validating existing GitLab token:', error);
            
            // Token is invalid
            statusDiv.className = 'validation-error';
            statusDiv.textContent = `Invalid GitLab token: ${error.message}`;
            
            return false;
        }
    }

    // Load unified PRs
    async function loadUnifiedPRs() {
        const { backendUrl, repoUrls, gitlabToken, username } = await chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken', 'username']);
        
        console.log('Loading unified PRs with:', { 
            hasBackendUrl: !!backendUrl,
            hasRepoUrls: !!repoUrls,
            hasGitlabToken: !!gitlabToken,
            hasUsername: !!username,
            repoCount: repoUrls ? repoUrls.split('\n').filter(url => url.trim()).length : 0
        });
        
        // Clear previous results
        document.getElementById('unified-prs-list').innerHTML = '<div class="loading">Loading PRs...</div>';
        
        if (!backendUrl || !repoUrls || !gitlabToken) {
            console.error('Missing required settings:', { backendUrl, repoUrls, gitlabToken });
            document.getElementById('unified-prs-list').innerHTML = `
                <div class="error">
                    Please configure all settings (Backend URL, GitLab Token, and Repository URLs) to view unified PRs.
                </div>
            `;
            return;
        }

        try {
            // Convert newline-separated URLs to array and encode them
            const urls = repoUrls.split('\n')
                .filter(url => url.trim())
                .map(url => encodeURIComponent(url));
            
            // Join URLs with '&repo_urls=' to create the query string
            const queryString = urls.map(url => `repo_urls=${url}`).join('&');
            const apiUrl = `${backendUrl}/api/prs/unified?${queryString}`;
            
            console.log('Fetching unified PRs from:', apiUrl);
            
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            let unifiedPRs = await response.json();
            console.log('Received unified PRs (raw):', unifiedPRs);
            
            if (!unifiedPRs || unifiedPRs.length === 0) {
                document.getElementById('unified-prs-list').innerHTML = `
                    <div class="no-prs">
                        No related PRs found.
                    </div>
                `;
                return;
            }

            // Deduplicate PRs within each task based on web_url
            unifiedPRs = unifiedPRs.map(task => {
                const uniquePRs = [];
                const seenUrls = new Set();
                
                for (const pr of task.prs) {
                    if (!seenUrls.has(pr.web_url)) {
                        seenUrls.add(pr.web_url);
                        uniquePRs.push(pr);
                    } else {
                        console.log(`Removed duplicate PR: ${pr.web_url}`);
                    }
                }
                
                return {
                    ...task,
                    prs: uniquePRs
                };
            });
            
            console.log('Deduplicated unified PRs:', unifiedPRs);

            // Check approval status for each PR in each task
            const tasksWithApproval = await Promise.all(unifiedPRs.map(async (task) => {
                const prs = await Promise.all(task.prs.map(async (pr) => {
                    const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                    return { ...pr, isApproved: approvalStatus };
                }));
                return { ...task, prs };
            }));

            // Update the UI with approval status
            updateUnifiedPRsUI(tasksWithApproval);
        } catch (error) {
            console.error('Error loading unified PRs:', error);
            document.getElementById('unified-prs-list').innerHTML = `
                <div class="error">
                    Error loading PRs: ${error.message}
                </div>
            `;
        }
    }

    async function checkPRApprovalStatus(prUrl) {
        try {
            // Extract project and MR ID from URL
            const match = prUrl.match(/gitlab\.com\/([^/]+(?:\/[^/]+)*?)\/\-\/merge_requests\/(\d+)/);
            if (!match) {
                console.error('Could not extract project path and MR ID from URL:', prUrl);
                return false;
            }

            const [_, projectPath, mrId] = match;
            
            // Get GitLab token and username from storage
            const { gitlabToken, username } = await chrome.storage.sync.get(['gitlabToken', 'username']);
            if (!gitlabToken || !username) {
                console.error('Missing GitLab token or username');
                return false;
            }

            // First, get the project ID
            const projectResponse = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}`, {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            });

            if (!projectResponse.ok) {
                console.error('Failed to fetch project info:', projectResponse.status);
                return false;
            }

            const projectData = await projectResponse.json();
            const projectId = projectData.id;

            // Now fetch the MR approvals
            const approvalsResponse = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrId}/approvals`, {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            });

            if (!approvalsResponse.ok) {
                console.error('Failed to fetch approval status:', approvalsResponse.status);
                return false;
            }

            const data = await approvalsResponse.json();
            console.log('Approval status response for PR:', prUrl, data);
            
            // Check if the current user has approved
            if (data.approved_by && Array.isArray(data.approved_by)) {
                const hasApproved = data.approved_by.some(approver => 
                    approver.user && approver.user.username === username
                );
                console.log('User approval status:', { username, hasApproved, approvers: data.approved_by.map(a => a.user.username) });
                return hasApproved;
            }
            
            return false;
        } catch (error) {
            console.error('Error checking PR approval status:', error);
            return false;
        }
    }

    function updateUnifiedPRsUI(unifiedPRs) {
        const container = document.getElementById('unified-prs-list');
        if (!container) {
            console.error('Could not find unified PRs container');
            return;
        }

        console.log('Updating UI with PRs:', JSON.stringify(unifiedPRs, null, 2));

        container.innerHTML = unifiedPRs.map(task => {
            const allApproved = task.prs.every(pr => pr.isApproved);
            console.log(`Task ${task.task_name} approval status:`, {
                taskName: task.task_name,
                allApproved,
                prs: task.prs.map(pr => ({
                    url: pr.web_url,
                    isApproved: pr.isApproved
                }))
            });
            
            return `
                <div class="task-group ${allApproved ? 'all-approved' : ''}" data-task-name="${task.task_name}">
                    <h3>${task.task_name}</h3>
                    <div class="pr-list">
                        ${task.prs.map(pr => {
                            console.log(`PR ${pr.web_url} status:`, {
                                url: pr.web_url,
                                isApproved: pr.isApproved,
                                repository: pr.repository_name,
                                id: pr.iid,
                                title: pr.title
                            });
                            return `
                                <div class="pr-item ${pr.isApproved ? 'approved' : ''}" data-url="${pr.web_url}">
                                    <a href="${pr.web_url}" target="_blank" title="${pr.title || 'No title'}">
                                        <div class="pr-item-content">
                                            <span class="pr-title">${pr.title || 'No title'}</span>
                                            <span class="pr-repo-info">${pr.repository_name} #${pr.iid}</span>
                                        </div>
                                    </a>
                                    ${pr.isApproved ? 
                                        '<span class="approval-status"><i class="checkmark">&#10003;</i> Approved</span>' : 
                                        '<span class="approval-status pending">Not approved</span>'
                                    }
                                </div>
                            `;
                        }).join('')}
                    </div>
                    ${allApproved ? 
                        '<div class="status approved">All PRs Approved</div>' : 
                        `<button class="approve-all-btn" data-task-name="${task.task_name}">
                            Approve All
                        </button>`
                    }
                </div>
            `;
        }).join('');

        // Add event listeners to approve buttons
        document.querySelectorAll('.approve-all-btn').forEach(button => {
            button.addEventListener('click', async () => {
                const taskName = button.dataset.taskName;
                await approveAllPRs(taskName);
            });
        });
    }

    // Rename approvePRs to approveAllPRs to match the usage
    async function approveAllPRs(taskName) {
        console.log('Approve button clicked for task:', taskName);
        const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        
        if (!backendUrl || !repoUrls) {
            console.error('Missing required settings:', { backendUrl, repoUrls });
            return;
        }

        try {
            console.log('Approving PRs for task:', taskName);
            const urls = repoUrls.split('\n').filter(url => url.trim());
            
            console.log('Making approve request to:', `${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`);
            console.log('Request body:', {
                repo_urls: urls
            });
            
            const response = await fetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    repo_urls: urls
                })
            });

            console.log('Approve response status:', response.status);
            
            if (response.ok) {
                console.log('Successfully approved PRs');
                // Show success message but keep the existing UI
                const taskGroup = document.querySelector(`.task-group[data-task-name="${taskName}"]`);
                if (taskGroup) {
                    const statusDiv = document.createElement('div');
                    statusDiv.className = 'unified-pr-message success';
                    statusDiv.textContent = 'Successfully approved PRs';
                    taskGroup.appendChild(statusDiv);
                }
                // Wait a bit before reloading to allow GitLab API to update
                await new Promise(resolve => setTimeout(resolve, 2000));
                await loadUnifiedPRs();
            } else {
                const error = await response.text();
                console.error('Failed to approve PRs:', error);
                // Show error message
                const taskGroup = document.querySelector(`.task-group[data-task-name="${taskName}"]`);
                if (taskGroup) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'unified-pr-message error';
                    errorDiv.textContent = `Error: ${error}`;
                    taskGroup.appendChild(errorDiv);
                }
            }
        } catch (error) {
            console.error('Error approving PRs:', error);
            // Show error message
            const taskGroup = document.querySelector(`.task-group[data-task-name="${taskName}"]`);
            if (taskGroup) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'unified-pr-message error';
                errorDiv.textContent = `Error: ${error.message}`;
                taskGroup.appendChild(errorDiv);
            }
        }
    }

    // Initial load of unified PRs
    loadUnifiedPRs();
});