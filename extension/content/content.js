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
    console.log('%c Initializing PR View on: ' + window.location.href, 'background: #222; color: #bada55');
    
    try {
        // Check if we're on a merge request page
        if (!window.location.pathname.includes('/-/merge_requests/')) {
            console.log('Not a merge request page:', window.location.pathname);
            return;
        }

        // Get settings from storage
        const settings = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        if (!settings.backendUrl || !settings.repoUrls) {
            console.error('Missing required settings:', settings);
            return;
        }

        // Debug: Log DOM state
        console.log('Current DOM state:', {
            title: document.title,
            pathname: window.location.pathname,
            bodyClasses: document.body.className,
            settings: {
                hasBackendUrl: !!settings.backendUrl,
                hasRepoUrls: !!settings.repoUrls,
                backendUrl: settings.backendUrl ? settings.backendUrl.substring(0, 10) + '...' : 'not set',
                repoUrls: settings.repoUrls ? settings.repoUrls.split('\n').length + ' repos configured' : 'not set'
            }
        });

        // Try multiple selectors for the branch name
        const branchSelectors = [
            '.ref-container',                      // Primary selector based on actual DOM
            '.detail-page-description .ref-container', // More specific selector
            '.is-merge-request .ref-container',    // Another specific selector
            '.js-source-branch-copy',              // Copy button selector
            '[data-clipboard-text]',               // Data attribute selector
            '.js-source-branch',                   // Original selector
            '.merge-request-details .ref-name',    // Fallback selector
            '.merge-request-details .source-branch' // Fallback selector
        ];

        console.log('Trying branch selectors:', branchSelectors);

        // Try to get branch name from URL first
        const urlMatch = window.location.pathname.match(/\/-\/merge_requests\/\d+\/diffs\?diff_id=\d+&start_sha=([^&]+)/);
        let branchName = urlMatch ? urlMatch[1] : null;

        // If no branch name from URL, try DOM selectors
        if (!branchName) {
            // Log all elements that might contain branch information
            console.log('DOM elements that might contain branch info:', {
                elementsWithBranch: Array.from(document.querySelectorAll('*'))
                    .filter(el => el.textContent?.toLowerCase().includes('branch'))
                    .map(el => ({
                        tag: el.tagName,
                        classes: el.className || '',
                        text: el.textContent?.trim(),
                        html: el.innerHTML,
                        isVisible: el.offsetParent !== null
                    })),
                elementsWithRef: Array.from(document.querySelectorAll('*'))
                    .filter(el => {
                        const className = el.className || '';
                        return typeof className === 'string' && className.toLowerCase().includes('ref');
                    })
                    .map(el => ({
                        tag: el.tagName,
                        classes: el.className || '',
                        text: el.textContent?.trim(),
                        html: el.innerHTML,
                        isVisible: el.offsetParent !== null
                    }))
            });

            // Try each selector
            let branchElement = null;
            
            for (const selector of branchSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    console.log('Found potential branch element with selector:', selector, {
                        element,
                        text: element.textContent,
                        html: element.innerHTML,
                        isVisible: element.offsetParent !== null,
                        attributes: Array.from(element.attributes).map(attr => ({
                            name: attr.name,
                            value: attr.value
                        }))
                    });
                    
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

            // If no element found, wait for dynamic loading with increased timeout
            if (!branchElement) {
                console.log('No branch element found immediately, waiting for dynamic content...');
                try {
                    // Wait for any of the selectors to appear with increased timeout
                    const selectorString = branchSelectors.join(',');
                    branchElement = await waitForElement(selectorString, 15000); // Increased timeout to 15 seconds
                    branchName = branchElement.textContent?.trim();
                    console.log('Found branch element after waiting:', {
                        element: branchElement,
                        text: branchName,
                        selector: branchElement.matches(branchSelectors.map(s => `${s}`).join(','))
                    });
                } catch (error) {
                    console.error('Timeout waiting for branch element. DOM state:', {
                        bodyHTML: document.body.innerHTML.substring(0, 500),
                        allElements: document.querySelectorAll('*').length,
                        possibleElements: Array.from(document.querySelectorAll('*'))
                            .filter(el => el.textContent?.includes('branch'))
                            .map(el => ({
                                tag: el.tagName,
                                classes: el.className || '',
                                text: el.textContent?.trim()
                            }))
                    });
                    return;
                }
            }
        }

        if (!branchName) {
            console.error('Could not find branch name');
            return;
        }

        console.log('Found branch name:', branchName);

        // Extract task name from branch name
        const taskName = extractTaskName(branchName);
        if (!taskName) {
            console.log('Could not extract task name from branch:', branchName);
            console.log('Tried patterns:', [
                /^(feature|bugfix|hotfix)\/([A-Z]+-\d+)/,
                /^(feature|bugfix|hotfix)\/(\d+)/,
                /^([A-Z]+-\d+)/
            ].map(pattern => ({
                pattern: pattern.toString(),
                match: branchName.match(pattern)
            })));
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
        console.log('URL changed to:', url);
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
        /^(feature|bugfix|hotfix)\/([A-Z]+-\d+)/,  // JIRA-style
        /^(feature|bugfix|hotfix)\/(\d+)/,         // Numeric
        /^([A-Z]+-\d+)/                            // Just ticket number
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
        
        if (!backendUrl || !repoUrls || !gitlabToken) {
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
        
        console.log('Fetching unified PRs from:', apiUrl);
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const unifiedPRs = await response.json();
        console.log('Received unified PRs:', unifiedPRs);
        
        // Find the task with matching name
        const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
        if (!taskPRs) {
            console.error('No PRs found for task:', taskName);
            return;
        }

        // Check approval status for each PR
        const prsWithApproval = await Promise.all(taskPRs.prs.map(async (pr) => {
            const approvalStatus = await checkPRApprovalStatus(pr.web_url);
            return { ...pr, isApproved: approvalStatus };
        }));

        const taskWithApproval = { ...taskPRs, prs: prsWithApproval };
        
        // Create and inject the unified view
        const unifiedView = createUnifiedView(taskWithApproval);
        injectUnifiedView(unifiedView);
    } catch (error) {
        console.error('Error adding unified PR view:', error);
    }
}

async function checkPRApprovalStatus(prUrl) {
    try {
        // Extract project and MR ID from URL
        const match = prUrl.match(/gitlab\.com\/([^/]+)\/-\/merge_requests\/(\d+)/);
        if (!match) return false;

        const [_, projectPath, mrId] = match;
        
        // Get GitLab token and username from storage
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
    console.log('Task approval status:', { taskName: taskPRs.task_name, allApproved, prs: taskPRs.prs });

    // Add PR items
    taskPRs.prs.forEach(pr => {
        console.log('PR approval status:', { prUrl: pr.web_url, isApproved: pr.isApproved });
        const prItem = document.createElement('div');
        prItem.className = `pr-item ${pr.isApproved ? 'approved' : ''}`;
        prItem.innerHTML = `
            <a href="${pr.web_url}" target="_blank">${pr.repository_name} #${pr.iid}</a>
            ${pr.isApproved ? '<span class="approval-status">✓ Approved</span>' : ''}
        `;
        prList.appendChild(prItem);
    });
    
    container.appendChild(prList);

    // Add approve button if not all PRs are approved
    if (!allApproved) {
        const approveButton = document.createElement('button');
        approveButton.className = 'approve-all-btn';
        approveButton.textContent = 'Approve All';
        approveButton.onclick = () => approveAllPRs(taskPRs.task_name);
        container.appendChild(approveButton);
    } else {
        const approvedStatus = document.createElement('div');
        approvedStatus.className = 'status approved';
        approvedStatus.textContent = 'All Approved';
        container.appendChild(approvedStatus);
    }

    return container;
}

async function injectUnifiedView(view) {
    console.log('Attempting to inject unified view...');
    
    // Try multiple possible injection points
    const injectionPoints = [
        '.description',
        '.merge-request-description',
        '.detail-page-description',
        '[data-testid="merge-request-description"]',
        '.merge-request-details',
        '.merge-request-info',
        '.mr-widget-content',
        '.mr-widget-section'
    ];
    
    let injectionPoint = null;
    for (const selector of injectionPoints) {
        const element = document.querySelector(selector);
        if (element) {
            console.log('Found injection point with selector:', selector);
            injectionPoint = element;
            break;
        }
    }
    
    if (!injectionPoint) {
        console.error('Could not find injection point. Available elements:', 
            document.body.innerHTML.substring(0, 1000));
        return;
    }

    // Check if we've already injected the view
    if (document.querySelector('.unified-pr-view')) {
        console.log('Unified view already exists');
        return;
    }

    // Insert the unified view after the injection point
    injectionPoint.parentNode.insertBefore(view, injectionPoint.nextSibling);
    console.log('Successfully injected unified view');
}

async function approveAllPRs(taskName) {
    const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
    
    if (!backendUrl || !repoUrls) {
        console.error('Missing required settings:', { backendUrl, repoUrls });
        return;
    }

    try {
        const urls = repoUrls.split('\n').filter(url => url.trim());
        
        console.log('Approving PRs for task:', taskName);
        
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
            console.log('Successfully approved PRs');
            // Show success message
            const unifiedView = document.querySelector('.unified-pr-view');
            if (unifiedView) {
                unifiedView.innerHTML = `
                    <div class="unified-pr-header">
                        <h3>Related PRs for ${taskName}</h3>
                        <span class="status success">Approved</span>
                    </div>
                    <div class="unified-pr-message success">
                        Successfully approved all related PRs
                    </div>
                `;
            }
            
            // Wait longer before reloading to allow GitLab API to update
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Verify approval status before reloading
            const verificationAttempts = 3;
            for (let i = 0; i < verificationAttempts; i++) {
                const allApproved = await verifyAllPRsApproved(taskName);
                if (allApproved) {
                    window.location.reload();
                    return;
                }
                // Wait between verification attempts
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // If we get here, show a warning that approval might take longer
            if (unifiedView) {
                unifiedView.innerHTML += `
                    <div class="unified-pr-message warning">
                        Approval successful but changes may take a few moments to reflect in GitLab.
                    </div>
                `;
            }
            // Reload anyway after warning
            setTimeout(() => window.location.reload(), 2000);
        } else {
            const error = await response.text();
            console.error('Failed to approve PRs:', error);
            const unifiedView = document.querySelector('.unified-pr-view');
            if (unifiedView) {
                unifiedView.innerHTML = `
                    <div class="unified-pr-header">
                        <h3>Related PRs for ${taskName}</h3>
                        <span class="status error">Error</span>
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
                    <h3>Related PRs for ${taskName}</h3>
                    <span class="status error">Error</span>
                </div>
                <div class="unified-pr-message error">
                    Error approving PRs: ${error.message}
                </div>
            `;
        }
    }
}

// Helper function to verify all PRs are approved
async function verifyAllPRsApproved(taskName) {
    try {
        const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        const urls = repoUrls.split('\n').filter(url => url.trim()).map(url => encodeURIComponent(url));
        const queryString = urls.map(url => `repo_urls=${url}`).join('&');
        const response = await fetch(`${backendUrl}/api/prs/unified?${queryString}`);
        
        if (!response.ok) return false;
        
        const unifiedPRs = await response.json();
        const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
        
        if (!taskPRs) return false;
        
        const approvalStatuses = await Promise.all(taskPRs.prs.map(pr => checkPRApprovalStatus(pr.web_url)));
        return approvalStatuses.every(status => status === true);
    } catch (error) {
        console.error('Error verifying PR approvals:', error);
        return false;
    }
} 