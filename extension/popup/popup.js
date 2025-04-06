document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'repoUrls', 'username'], (data) => {
        console.log('Loaded settings:', data);
        document.getElementById('backend-url').value = data.backendUrl || '';
        document.getElementById('gitlab-token').value = data.gitlabToken || '';
        document.getElementById('repo-urls').value = data.repoUrls || '';
        
        // If we have all required settings, load unified PRs
        if (data.backendUrl && data.gitlabToken && data.repoUrls) {
            loadUnifiedPRs();
        }
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', () => {
        const backendUrl = document.getElementById('backend-url').value;
        const gitlabToken = document.getElementById('gitlab-token').value;
        const repoUrls = document.getElementById('repo-urls').value;

        console.log('Saving settings:', { backendUrl, gitlabToken, repoUrls });

        chrome.storage.sync.set({
            backendUrl,
            gitlabToken,
            repoUrls
        }, () => {
            console.log('Settings saved successfully');
            // Reload unified PRs after saving settings
            loadUnifiedPRs();
        });
    });

    // Load unified PRs
    async function loadUnifiedPRs() {
        const { backendUrl, repoUrls, gitlabToken } = await chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken']);
        
        console.log('Loading unified PRs with:', { 
            hasBackendUrl: !!backendUrl,
            hasRepoUrls: !!repoUrls,
            hasGitlabToken: !!gitlabToken,
            repoCount: repoUrls ? repoUrls.split('\n').filter(url => url.trim()).length : 0
        });
        
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
            
            const unifiedPRs = await response.json();
            console.log('Received unified PRs:', unifiedPRs);
            
            if (!unifiedPRs || unifiedPRs.length === 0) {
                document.getElementById('unified-prs-list').innerHTML = `
                    <div class="no-prs">
                        No related PRs found.
                    </div>
                `;
                return;
            }

            // Check approval status for each PR
            const prsWithApproval = await Promise.all(unifiedPRs.map(async (task) => {
                const prs = await Promise.all(task.prs.map(async (pr) => {
                    const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                    return { ...pr, isApproved: approvalStatus };
                }));
                const allApproved = prs.every(pr => pr.isApproved);
                return { ...task, prs, allApproved };
            }));

            // Update the UI
            updateUnifiedPRsUI(prsWithApproval);
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
            const match = prUrl.match(/gitlab\.com\/([^/]+)\/-\/merge_requests\/(\d+)/);
            if (!match) return false;

            const [_, projectPath, mrId] = match;
            
            // Get GitLab token from storage
            const { gitlabToken, username } = await chrome.storage.sync.get(['gitlabToken', 'username']);
            if (!gitlabToken) {
                console.error('GitLab token not found');
                return false;
            }

            // Fetch approval status from GitLab API
            const response = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${mrId}/approvals`, {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            });

            if (!response.ok) {
                console.error('Failed to fetch approval status:', response.status);
                return false;
            }

            const data = await response.json();
            console.log('Approval status response:', data);
            
            // Check if the current user has approved
            if (username && data.approved_by) {
                const hasApproved = data.approved_by.some(approver => approver.user.username === username);
                console.log('User approval status:', { username, hasApproved });
                return hasApproved;
            }
            
            return data.approved || false;
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

        container.innerHTML = unifiedPRs.map(task => `
            <div class="task-group ${task.allApproved ? 'all-approved' : ''}">
                <h3>${task.task_name}</h3>
                ${task.allApproved ? '<div class="status approved">All Approved</div>' : ''}
                <div class="pr-list">
                    ${task.prs.map(pr => `
                        <div class="pr-item ${pr.isApproved ? 'approved' : ''}">
                            <a href="${pr.web_url}" target="_blank">${pr.repository_name} #${pr.iid}</a>
                            ${pr.isApproved ? '<span class="approval-status">✓ Approved</span>' : ''}
                        </div>
                    `).join('')}
                </div>
                ${!task.allApproved ? `
                    <button class="approve-all-btn" data-task-name="${task.task_name}">
                        Approve All
                    </button>
                ` : ''}
            </div>
        `).join('');

        // Add event listeners to approve buttons
        document.querySelectorAll('.approve-all-btn').forEach(button => {
            button.addEventListener('click', () => {
                const taskName = button.dataset.taskName;
                approveAllPRs(taskName);
            });
        });
    }

    // Define approvePRs function
    async function approvePRs(taskName) {
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
                // Show success message
                const prsList = document.getElementById('unified-prs-list');
                prsList.innerHTML = `<p class="success">Successfully approved PRs for ${taskName}</p>`;
                // Reload the PRs list after a short delay
                setTimeout(loadUnifiedPRs, 2000);
            } else {
                const error = await response.text();
                console.error('Failed to approve PRs:', error);
                // Show error message
                const prsList = document.getElementById('unified-prs-list');
                prsList.innerHTML = `<p class="error">Error approving PRs: ${error}</p>`;
            }
        } catch (error) {
            console.error('Error approving PRs:', error);
            // Show error message
            const prsList = document.getElementById('unified-prs-list');
            prsList.innerHTML = `<p class="error">Error approving PRs: ${error.message}</p>`;
        }
    }

    // Initial load of unified PRs
    loadUnifiedPRs();
}); 