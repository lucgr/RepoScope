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
        // Debug the current page URL
        console.log('Current URL:', window.location.href);
        console.log('Pathname:', window.location.pathname);
        
        // Check if we're on a merge request page
        if (!window.location.pathname.includes('/-/merge_requests/')) {
            console.log('Not on a merge request page, skipping injection');
            return;
        }
        
        console.log('On a merge request page, proceeding with injection');

        // Get settings from storage
        const settings = await chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken', 'username']);
        if (!settings.backendUrl || !settings.repoUrls || !settings.gitlabToken || !settings.username) {
            console.error('Missing required settings:', {
                hasBackendUrl: !!settings.backendUrl,
                hasRepoUrls: !!settings.repoUrls,
                hasGitlabToken: !!settings.gitlabToken,
                hasUsername: !!settings.username
            });
            return;
        }
        
        console.log('All required settings found, proceeding with branch detection');

        // Try multiple selectors for the branch name
        const branchSelectors = [
            '.ref-container',                      // Primary selector based on actual DOM
            '.detail-page-description .ref-container', 
            '.js-source-branch-copy',              // Copy button selector
            '[data-clipboard-text]',               // Data attribute selector
            '.js-source-branch',                   // Original selector
            '.merge-request-details .ref-name',    // Additional selector
            '.merge-request-title-source'          // Title source element
        ];

        // Try to get branch name from URL first
        const urlMatch = window.location.pathname.match(/\/-\/merge_requests\/\d+\/diffs\?diff_id=\d+&start_sha=([^&]+)/);
        let branchName = urlMatch ? urlMatch[1] : null;

        // If no branch name from URL, try DOM selectors
        if (!branchName) {
            // Try each selector
            let branchElement = null;
            
            for (const selector of branchSelectors) {
                const elements = document.querySelectorAll(selector);
                console.log(`Selector ${selector} found ${elements.length} elements`);
                
                for (const element of elements) {
                    // Try to get branch name from different sources
                    const text = element.textContent?.trim();
                    const title = element.getAttribute('title');
                    const clipboardText = element.getAttribute('data-clipboard-text');
                    
                    console.log(`Checking element:`, {
                        selector,
                        text,
                        title,
                        clipboardText,
                        html: element.outerHTML
                    });
                    
                    if (clipboardText) {
                        branchElement = element;
                        branchName = clipboardText;
                        console.log('Found branch name from clipboard text:', branchName);
                        break;
                    } else if (title) {
                        branchElement = element;
                        branchName = title;
                        console.log('Found branch name from title:', branchName);
                        break;
                    } else if (text) {
                        branchElement = element;
                        branchName = text;
                        console.log('Found branch name from text:', branchName);
                        break;
                    }
                }
                
                if (branchName) break;
            }

            // If no element found, try to get from page data
            if (!branchName) {
                try {
                    // GitLab stores data in a script tag with id="js-merge-request-data"
                    const dataElement = document.getElementById('js-merge-request-data');
                    if (dataElement) {
                        const mrData = JSON.parse(dataElement.textContent);
                        if (mrData && mrData.source_branch) {
                            branchName = mrData.source_branch;
                            console.log('Found branch name from JS data:', branchName);
                        }
                    } else {
                        console.log('No js-merge-request-data element found');
                    }
                } catch (err) {
                    console.error('Error extracting branch from JS data:', err);
                }
            }
            
            // As a fallback, try waiting for dynamic content
            if (!branchName) {
                try {
                    console.log('No branch found, waiting for dynamic content...');
                    // Wait for any of the selectors to appear
                    const selectorString = branchSelectors.join(',');
                    branchElement = await waitForElement(selectorString, 10000);
                    branchName = branchElement.textContent?.trim();
                    console.log('Found branch after waiting:', branchName);
                } catch (error) {
                    console.error('Timeout waiting for branch element:', error);
                    return;
                }
            }
        }

        if (!branchName) {
            console.error('Could not find branch name after all attempts');
            return;
        }

        // Log the found branch name
        console.log('Final branch name detected:', branchName);

        // Extract task name from branch name
        const taskName = extractTaskName(branchName);
        if (!taskName) {
            console.log('Could not extract task name from branch:', branchName);
            return;
        }
        
        console.log('Extracted task name:', taskName);

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

// Add a helper function for proxied fetch requests
function proxyFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'PROXY_FETCH',
            url: url,
            options: options
        }, response => {
            if (chrome.runtime.lastError) {
                console.error('Error in proxyFetch runtime:', chrome.runtime.lastError);
                return reject(new Error(chrome.runtime.lastError.message));
            }
            
            if (response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response.error || 'Unknown error in proxy fetch'));
            }
        });
    });
}

async function addUnifiedPRView(taskName) {
    try {
        console.log('Starting to add unified PR view for task:', taskName);
        
        // Get settings from storage
        const { backendUrl, repoUrls, gitlabToken, username } = await chrome.storage.sync.get(['backendUrl', 'repoUrls', 'gitlabToken', 'username']);
        
        if (!backendUrl || !repoUrls || !gitlabToken || !username) {
            console.error('Missing required settings:', {
                hasBackendUrl: !!backendUrl,
                hasRepoUrls: !!repoUrls,
                hasGitlabToken: !!gitlabToken,
                hasUsername: !!username
            });
            return;
        }

        console.log('All settings present, proceeding with fetch');

        // Convert newline-separated URLs to array and encode them
        const urls = repoUrls.split('\n')
            .filter(url => url.trim())
            .map(url => encodeURIComponent(url));
        
        // Join URLs with '&repo_urls=' to create the query string
        const queryString = urls.map(url => `repo_urls=${url}`).join('&');
        const apiUrl = `${backendUrl}/api/prs/unified?${queryString}`;
        
        console.log('Fetching unified PRs using proxy from:', apiUrl);
        
        // Use the proxy fetch instead of direct fetch
        const unifiedPRs = await proxyFetch(apiUrl);
        console.log('Received unified PRs data:', unifiedPRs);
        
        // Deduplicate PRs within each task based on web_url
        const dedupedPRs = unifiedPRs.map(task => {
            const uniquePRs = [];
            const seenUrls = new Set();
            
            for (const pr of task.prs) {
                if (!seenUrls.has(pr.web_url)) {
                    seenUrls.add(pr.web_url);
                    uniquePRs.push(pr);
                }
            }
            
            return {
                ...task,
                prs: uniquePRs
            };
        });
        
        // Find the task with matching name
        const taskPRs = dedupedPRs.find(task => task.task_name === taskName);
        if (!taskPRs) {
            console.error('No PRs found for task:', taskName);
            return;
        }

        console.log('Found matching task:', taskPRs);

        // For each PR, check approval status
        const prsWithApproval = [];
        
        for (const pr of taskPRs.prs) {
            try {
                // Use a more direct approach for status checking to avoid multiple network requests
                const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                prsWithApproval.push({
                    ...pr,
                    isApproved: approvalStatus
                });
            } catch (err) {
                console.error('Error checking approval for PR:', pr.web_url, err);
                prsWithApproval.push({
                    ...pr,
                    isApproved: false
                });
            }
        }

        const taskWithApproval = { ...taskPRs, prs: prsWithApproval };
        console.log('Task with approval status:', taskWithApproval);
        
        // Create and inject the unified view
        const unifiedView = createUnifiedView(taskWithApproval);
        await injectUnifiedView(unifiedView);
        console.log('Unified view successfully injected');

        // Set up periodic refresh of approval status
        setInterval(async () => {
            try {
                const updatedPrsWithApproval = [];
                
                for (const pr of taskPRs.prs) {
                    try {
                        const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                        updatedPrsWithApproval.push({
                            ...pr,
                            isApproved: approvalStatus
                        });
                    } catch (err) {
                        console.error('Error in refresh approval check:', err);
                        updatedPrsWithApproval.push({
                            ...pr,
                            isApproved: false
                        });
                    }
                }
                
                const updatedTaskWithApproval = { ...taskPRs, prs: updatedPrsWithApproval };
                const updatedView = createUnifiedView(updatedTaskWithApproval);
                
                const existingView = document.querySelector('.unified-pr-view');
                if (existingView) {
                    existingView.replaceWith(updatedView);
                    console.log('Unified view refreshed successfully');
                }
            } catch (error) {
                console.error('Error during periodic refresh:', error);
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

        // Use proxy fetch for project info
        try {
            // First, get the project ID using proxy fetch
            const projectData = await proxyFetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}`, {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            });

            const projectId = projectData.id;

            // Now fetch the MR approvals using proxy fetch
            const approvalData = await proxyFetch(`https://gitlab.com/api/v4/projects/${projectId}/merge_requests/${mrId}/approvals`, {
                headers: {
                    'Authorization': `Bearer ${gitlabToken}`
                }
            });

            // Check if the current user has approved
            if (approvalData.approved_by && Array.isArray(approvalData.approved_by)) {
                const hasApproved = approvalData.approved_by.some(approver => 
                    approver.user && approver.user.username === username
                );
                console.log(`Approval status for PR ${prUrl}:`, {
                    username,
                    hasApproved,
                    approvers: approvalData.approved_by.map(a => a.user?.username).filter(Boolean)
                });
                return hasApproved;
            }
            
            return false;
        } catch (error) {
            console.error('Error in proxy fetch for approval status:', error);
            return false;
        }
    } catch (error) {
        console.error('Error checking PR approval status:', error);
        return false;
    }
}

async function approveAllPRs(taskName) {
    try {
        const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        
        if (!backendUrl || !repoUrls) {
            console.error('Missing required settings');
            return;
        }

        const urls = repoUrls.split('\n').filter(url => url.trim());
        
        // Use proxy fetch for approval
        const approveResponse = await proxyFetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                repo_urls: urls
            })
        });
        
        console.log('Approve response:', approveResponse);

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
        try {
            const unifiedPRs = await proxyFetch(`${backendUrl}/api/prs/unified?${queryString}`);
            const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
            
            if (taskPRs) {
                // Check approval status for each PR
                const prsWithApproval = [];
                
                for (const pr of taskPRs.prs) {
                    try {
                        const approvalStatus = await checkPRApprovalStatus(pr.web_url);
                        prsWithApproval.push({
                            ...pr,
                            isApproved: approvalStatus
                        });
                    } catch (err) {
                        console.error('Error checking approval after approve all:', err);
                        prsWithApproval.push({
                            ...pr,
                            isApproved: false
                        });
                    }
                }

                const taskWithApproval = { ...taskPRs, prs: prsWithApproval };
                
                // Create and inject the updated view
                const updatedView = createUnifiedView(taskWithApproval);
                if (unifiedView) {
                    unifiedView.replaceWith(updatedView);
                }
            }
        } catch (error) {
            console.error('Error refreshing PRs after approval:', error);
            if (unifiedView) {
                unifiedView.innerHTML += `
                    <div class="unified-pr-message warning">
                        PRs were approved, but there was an error refreshing the view. Please reload the page.
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
        '.description',
        '.issuable-details',                 // Added
        '.detail-page-header',               // Added
        '.merge-request'                     // Added
    ];
    
    console.log('Attempting to inject unified view, searching for injection points...');
    
    let injectionPoint = null;
    for (const selector of injectionPoints) {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector ${selector} found ${elements.length} elements`);
        
        if (elements.length > 0) {
            injectionPoint = elements[0];
            console.log('Found injection point:', {
                selector,
                element: injectionPoint.outerHTML.substring(0, 100) + '...'
            });
            break;
        }
    }
    
    if (!injectionPoint) {
        console.error('Could not find injection point, using body as fallback');
        // Use body as a fallback
        const container = document.createElement('div');
        container.className = 'unified-pr-view-container';
        container.appendChild(view);
        document.body.prepend(container);
        return;
    }

    // Remove existing unified view if present
    const existingView = document.querySelector('.unified-pr-view');
    if (existingView) {
        console.log('Removing existing unified view');
        existingView.remove();
    }

    // Insert the unified view after the injection point
    console.log('Injecting unified view after:', injectionPoint);
    injectionPoint.parentNode.insertBefore(view, injectionPoint.nextSibling);
    console.log('Unified view injected successfully');
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
    overflow: hidden;
}

.pr-item a:hover {
    text-decoration: underline;
}

.pr-item-content {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.pr-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
}

.pr-repo-info {
    font-size: 12px;
    color: var(--gl-text-secondary, #586069);
}

.approval-status {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 12px;
    margin-left: 8px;
    flex-shrink: 0;
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