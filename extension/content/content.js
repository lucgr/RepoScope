console.log('%c Unified PR Viewer Extension Loaded ', 'background: #222; color: #bada55; font-size: 16px;');

// Immediately check storage to verify settings
chrome.storage.sync.get(['backendUrl', 'repoUrls'], (result) => {
    console.log('%c Extension Settings ', 'background: #222; color: #bada55', {
        hasBackendUrl: !!result.backendUrl,
        hasRepoUrls: !!result.repoUrls,
        backendUrl: result.backendUrl ? result.backendUrl.substring(0, 10) + '...' : 'not set',
        repoUrls: result.repoUrls ? result.repoUrls.split('\n').length + ' repos configured' : 'not set'
    });
});

// Function to initialize the PR view
async function initializePRView() {
    try {
        // Check if we're on a merge request page
        if (!window.location.pathname.includes('/-/merge_requests/')) {
            return;
        }

        // Get settings from storage
        const settings = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        if (!settings.backendUrl || !settings.repoUrls) {
            console.error('Missing required settings:', settings);
            return;
        }

        // Try multiple selectors for the branch name
        const branchSelectors = [
            '.ref-container',                      // Primary selector based on actual DOM
            '.detail-page-description .ref-container', 
            '.js-source-branch-copy',              // Copy button selector
            '[data-clipboard-text]',               // Data attribute selector
            '.js-source-branch'                    // Original selector
        ];

        // Try to get branch name from URL first
        const urlMatch = window.location.pathname.match(/\/-\/merge_requests\/\d+\/diffs\?diff_id=\d+&start_sha=([^&]+)/);
        let branchName = urlMatch ? urlMatch[1] : null;

        // If no branch name from URL, try DOM selectors
        if (!branchName) {
            // Try each selector
            let branchElement = null;
            
            for (const selector of branchSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // Try to get branch name from different sources
                    const text = element.textContent?.trim();
                    const title = element.getAttribute('title');
                    const clipboardText = element.getAttribute('data-clipboard-text');
                    
                    if (clipboardText) {
                        branchElement = element;
                        branchName = clipboardText;
                        break;
                    } else if (title) {
                        branchElement = element;
                        branchName = title;
                        break;
                    } else if (text) {
                        branchElement = element;
                        branchName = text;
                        break;
                    }
                }
            }

            // If no element found, wait for dynamic loading
            if (!branchElement) {
                try {
                    // Wait for any of the selectors to appear
                    const selectorString = branchSelectors.join(',');
                    branchElement = await waitForElement(selectorString, 10000);
                    branchName = branchElement.textContent?.trim();
                } catch (error) {
                    console.error('Timeout waiting for branch element');
                    return;
                }
            }
        }

        if (!branchName) {
            console.error('Could not find branch name');
            return;
        }

        // Extract task name from branch name
        const taskName = extractTaskName(branchName);
        if (!taskName) {
            console.log('Could not extract task name from branch:', branchName);
            return;
        }

        // Add unified PR view to the page
        addUnifiedPRView(taskName);
    } catch (error) {
        console.error('Error initializing PR view:', error);
    }
}

// Helper function to wait for an element to appear in the DOM
function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                clearTimeout(timeoutId);
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

// Watch for URL changes (for GitLab's SPA navigation)
let lastUrl = window.location.href;
new MutationObserver(() => {
    const url = window.location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        initializePRView();
    }
}).observe(document, { subtree: true, childList: true });

// Run on initial page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePRView);
} else {
    initializePRView();
}

function extractTaskName(branchName) {
    const patterns = [
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/([A-Z]+-\d+)/i,  // JIRA-style with more prefixes
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/(\d+)/i,         // Numeric with more prefixes
        /^([A-Z]+-\d+)/                                                // Just ticket number
    ];
    
    for (const pattern of patterns) {
        const match = branchName.match(pattern);
        if (match) {
            return match[2] || match[1];
        }
    }
    
    return null;
}

async function addUnifiedPRView(taskName) {
    try {
        // Get settings from storage
        const { backendUrl, repoUrls, gitlabToken, username } = await chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken', 'username']);
        
        if (!backendUrl || !repoUrls || !gitlabToken || !username) {
            console.error('Missing required settings');
            return;
        }

        // Convert newline-separated URLs to array and encode them
        const urls = repoUrls.split('\n')
            .filter(url => url.trim())
            .map(url => encodeURIComponent(url));
        
        // Join URLs with '&repo_urls=' to create the query string
        const queryString = urls.map(url => `repo_urls=${url}`).join('&');
        const apiUrl = `${backendUrl}/api/prs/unified?${queryString}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const unifiedPRs = await response.json();
        
        // Find the task with matching name
        const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
        if (!taskPRs) {
            console.error('No PRs found for task:', taskName);
            return;
        }

        // Check approval status for each PR using the updated approval checking logic
        const prsWithApproval = await Promise.all(taskPRs.prs.map(async (pr) => {
            const approvalStatus = await checkPRApprovalStatus(pr.web_url);
            return { ...pr, isApproved: approvalStatus };
        }));

        const taskWithApproval = { ...taskPRs, prs: prsWithApproval };
        
        // Create and inject the unified view
        const unifiedView = createUnifiedView(taskWithApproval);
        await injectUnifiedView(unifiedView);

        // Set up periodic refresh of approval status
        setInterval(async () => {
            const updatedPrsWithApproval = await Promise.all(taskPRs.prs.map(async (pr) => {
                const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                return { ...pr, isApproved: approvalStatus };
            }));
            
            const updatedTaskWithApproval = { ...taskPRs, prs: updatedPrsWithApproval };
            const updatedView = createUnifiedView(updatedTaskWithApproval);
            
            const existingView = document.querySelector('.unified-pr-view');
            if (existingView) {
                existingView.replaceWith(updatedView);
            }
        }, 30000); // Refresh every 30 seconds
    } catch (error) {
        console.error('Error adding unified PR view:', error);
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
        
        // Check if the current user has approved
        if (data.approved_by && Array.isArray(data.approved_by)) {
            const hasApproved = data.approved_by.some(approver => 
                approver.user && approver.user.username === username
            );
            return hasApproved;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking PR approval status:', error);
        return false;
    }
}

async function checkPRPipelineStatus(prUrl) {
    try {
        // Extract project and MR ID from URL
        const match = prUrl.match(/gitlab\.com\/([^/]+(?:\/[^/]+)*?)\/\-\/merge_requests\/(\d+)/);
        if (!match) {
            console.error('Could not extract project path and MR ID from URL:', prUrl);
            return null;
        }

        const [_, projectPath, mrId] = match;
        
        // Get GitLab token
        const { gitlabToken } = await chrome.storage.sync.get(['gitlabToken']);
        if (!gitlabToken) {
            console.error('Missing GitLab token');
            return null;
        }

        // First, get the project ID
        const projectResponse = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}`, {
            headers: {
                'Authorization': `Bearer ${gitlabToken}`
            }
        });

        if (!projectResponse.ok) {
            console.error('Failed to fetch project info:', projectResponse.status);
            return null;
        }

        const projectData = await projectResponse.json();
        const projectId = projectData.id;

        // Now fetch the MR pipelines
        const pipelinesResponse = await fetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrId}/pipelines`, {
            headers: {
                'Authorization': `Bearer ${gitlabToken}`
            }
        });

        if (!pipelinesResponse.ok) {
            console.error('Failed to fetch pipeline status:', pipelinesResponse.status);
            return null;
        }

        const pipelines = await pipelinesResponse.json();
        
        // Return the status of the latest pipeline, if any
        if (pipelines && pipelines.length > 0) {
            return pipelines[0].status;
        }
        
        return null;
    } catch (error) {
        console.error('Error checking PR pipeline status:', error);
        return null;
    }
}

// Function to get pipeline status emoji
function getPipelineStatusEmoji(status) {
    if (!status) return '<span class="pipeline-status no-pipeline">No pipelines</span>';
    
    switch (status) {
        case 'success':
            return '<span class="pipeline-status success">Pipeline Success ✅</span>';
        case 'failed':
            return '<span class="pipeline-status failed">Pipeline Failed ❌</span>';
        case 'running':
        case 'pending':
            return '<span class="pipeline-status running">Pipeline Running ⏳</span>';
        default:
            return '<span class="pipeline-status unknown">' + status + '</span>';
    }
}

function createUnifiedView(taskPRs) {
    const container = document.createElement('div');
    container.className = 'unified-pr-view';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'unified-pr-header';
    header.innerHTML = `
        <h3>Related Merge Requests</h3>
        <div class="task-name">Task: ${taskPRs.task_name}</div>
    `;
    container.appendChild(header);

    // Create PR list
    const prList = document.createElement('div');
    prList.className = 'unified-pr-list';
    
    // Check if all PRs are approved
    const allApproved = taskPRs.prs.every(pr => pr.isApproved);

    // Add PR items
    taskPRs.prs.forEach(pr => {
        const prItem = document.createElement('div');
        prItem.className = `pr-item ${pr.isApproved ? 'approved' : ''}`;
        prItem.innerHTML = `
            <a href="${pr.web_url}" target="_blank">${pr.repository_name} #${pr.iid}</a>
            <div class="status-badges">
                ${getPipelineStatusEmoji(pr.pipeline_status)}
                ${pr.isApproved ? 
                    '<span class="approval-status"><i class="checkmark">&#10003;</i> Approved</span>' : 
                    '<span class="approval-status pending">Not approved</span>'
                }
            </div>
        `;
        prList.appendChild(prItem);
    });
    
    container.appendChild(prList);

    // Add approve button or approved status
    if (!allApproved) {
        const approveButton = document.createElement('button');
        approveButton.className = 'approve-all-btn';
        approveButton.textContent = 'Approve All';
        approveButton.onclick = () => approveAllPRs(taskPRs.task_name);
        container.appendChild(approveButton);
    } else {
        const approvedStatus = document.createElement('div');
        approvedStatus.className = 'status approved';
        approvedStatus.textContent = 'All PRs Approved';
        container.appendChild(approvedStatus);
    }

    return container;
}

async function injectUnifiedView(view) {
    // Try multiple possible injection points
    const injectionPoints = [
        '.merge-request-description',
        '.detail-page-description',
        '[data-testid="merge-request-description"]',
        '.merge-request-details',
        '.merge-request-info',
        '.mr-widget-content',
        '.mr-widget-section',
        '.description'
    ];
    
    let injectionPoint = null;
    for (const selector of injectionPoints) {
        const element = document.querySelector(selector);
        if (element) {
            injectionPoint = element;
            break;
        }
    }
    
    if (!injectionPoint) {
        console.error('Could not find injection point');
        return;
    }

    // Remove existing unified view if present
    const existingView = document.querySelector('.unified-pr-view');
    if (existingView) {
        existingView.remove();
    }

    // Insert the unified view after the injection point
    injectionPoint.parentNode.insertBefore(view, injectionPoint.nextSibling);
}

async function approveAllPRs(taskName) {
    const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
    
    if (!backendUrl || !repoUrls) {
        console.error('Missing required settings');
        return;
    }

    try {
        const urls = repoUrls.split('\n').filter(url => url.trim());
        
        const response = await fetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                repo_urls: urls
            })
        });

        if (response.ok) {
            // Show success message
            const unifiedView = document.querySelector('.unified-pr-view');
            if (unifiedView) {
                unifiedView.innerHTML = `
                    <div class="unified-pr-header">
                        <h3>Related Merge Requests</h3>
                        <div class="task-name">Task: ${taskName}</div>
                        <div class="status approved">All PRs Approved</div>
                    </div>
                    <div class="unified-pr-message success">
                        Successfully approved all related PRs
                    </div>
                `;
            }
            
            // Wait longer before reloading to allow GitLab API to update
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Instead of reloading the page, update the view with new data
            const queryString = urls.map(url => `repo_urls=${encodeURIComponent(url)}`).join('&');
            const prsResponse = await fetch(`${backendUrl}/api/prs/unified?${queryString}`);
            
            if (prsResponse.ok) {
                const unifiedPRs = await prsResponse.json();
                const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
                
                if (taskPRs) {
                    // Check approval status for each PR and pipeline status if needed
                    const prsWithStatus = await Promise.all(taskPRs.prs.map(async (pr) => {
                        const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                        
                        // Check pipeline status if not available
                        let pipelineStatus = pr.pipeline_status;
                        if (!pipelineStatus) {
                            pipelineStatus = await checkPRPipelineStatus(pr.web_url);
                        }
                        
                        return { 
                            ...pr, 
                            isApproved: approvalStatus,
                            pipeline_status: pipelineStatus 
                        };
                    }));

                    const taskWithStatus = { ...taskPRs, prs: prsWithStatus };
                    
                    // Create and inject the updated view
                    const updatedView = createUnifiedView(taskWithStatus);
                    if (unifiedView) {
                        unifiedView.replaceWith(updatedView);
                    }
                }
            }
        } else {
            const error = await response.text();
            console.error('Failed to approve PRs:', error);
            const unifiedView = document.querySelector('.unified-pr-view');
            if (unifiedView) {
                unifiedView.innerHTML = `
                    <div class="unified-pr-header">
                        <h3>Related Merge Requests</h3>
                        <div class="task-name">Task: ${taskName}</div>
                        <div class="status error">Error</div>
                    </div>
                    <div class="unified-pr-message error">
                        Error approving PRs: ${error}
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error approving PRs:', error);
        const unifiedView = document.querySelector('.unified-pr-view');
        if (unifiedView) {
            unifiedView.innerHTML = `
                <div class="unified-pr-header">
                    <h3>Related Merge Requests</h3>
                    <div class="task-name">Task: ${taskName}</div>
                    <div class="status error">Error</div>
                </div>
                <div class="unified-pr-message error">
                    Error approving PRs: ${error.message}
                </div>
            `;
        }
    }
}

// Add CSS styles for the unified PR view
const styles = `
.unified-pr-view {
    margin: 16px 0;
    padding: 16px;
    background: var(--gray-10, #fafafa);
    border: 1px solid var(--border-color, #e5e5e5);
    border-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.unified-pr-header {
    margin-bottom: 16px;
}

.unified-pr-header h3 {
    margin: 0 0 8px 0;
    font-size: 16px;
    color: var(--gl-theme-accent, #1f75cb);
    font-weight: 600;
}

.task-name {
    color: var(--gl-text-secondary, #586069);
    font-size: 14px;
}

.unified-pr-list {
    margin-bottom: 16px;
}

.pr-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: 4px;
    background: var(--white, white);
    border: 1px solid var(--border-color, #e5e5e5);
}

.pr-item.approved {
    background: var(--green-50, #f0faf5);
    border-color: var(--green-200, #cbe2d1);
}

.pr-item a {
    color: var(--blue-600, #1068bf);
    text-decoration: none;
    font-size: 14px;
    flex-grow: 1;
}

.pr-item a:hover {
    text-decoration: underline;
}

.approval-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    margin-left: 8px;
}

.approval-status .checkmark {
    font-style: normal;
    margin-right: 4px;
    font-weight: bold;
}

.approval-status.pending {
    background: var(--gray-50, #f0f0f0);
    color: var(--gl-text-secondary, #666);
}

.pr-item .approval-status {
    background: var(--green-50, #f0faf5);
    color: var(--green-600, #1aaa55);
    border: 1px solid var(--green-200, #cbe2d1);
}

.approve-all-btn {
    background: var(--green-500, #1aaa55);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 16px;
    font-size: 14px;
    cursor: pointer;
    width: 100%;
    transition: background-color 0.2s;
}

.approve-all-btn:hover {
    background: var(--green-600, #168f48);
}

.status {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    margin-top: 8px;
}

.status.approved {
    background: var(--green-50, #f0faf5);
    color: var(--green-600, #1aaa55);
    border: 1px solid var(--green-200, #cbe2d1);
}

.unified-pr-message {
    padding: 10px;
    border-radius: 4px;
    margin: 10px 0;
}

.unified-pr-message.success {
    background: var(--green-50, #f0faf5);
    color: var(--green-600, #1aaa55);
    border: 1px solid var(--green-200, #cbe2d1);
}

.unified-pr-message.error {
    background: var(--red-50, #fff0f0);
    color: var(--red-600, #c92100);
    border: 1px solid var(--red-200, #fcc);
}
`;

// Inject styles
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet); 