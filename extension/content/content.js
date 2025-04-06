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
    console.log('Starting to add unified PR view for task:', taskName);
    // Get settings from storage
    const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
    
    if (!backendUrl || !repoUrls) {
        console.log('Missing settings:', { backendUrl, repoUrls });
        return;
    }

    try {
        // Convert newline-separated URLs to array and encode them
        const urls = repoUrls.split('\n')
            .filter(url => url.trim())
            .map(url => encodeURIComponent(url));
        
        // Join URLs with '&repo_urls=' to create the query string
        const queryString = urls.map(url => `repo_urls=${url}`).join('&');
        
        console.log('Fetching related PRs for task:', taskName);
        console.log('API URL:', `${backendUrl}/api/prs/unified?${queryString}`);
        
        // Fetch related PRs
        const response = await fetch(`${backendUrl}/api/prs/unified?${queryString}`);
        const unifiedPRs = await response.json();
        
        console.log('API Response:', unifiedPRs);
        
        // Find PRs for the current task
        const taskPRs = unifiedPRs.find(pr => pr.task_name === taskName);
        if (!taskPRs || taskPRs.prs.length <= 1) {
            console.log('No related PRs found for task:', taskName);
            return;
        }

        console.log('Found related PRs:', taskPRs);

        // Check approval status for each PR
        const prsWithApproval = await Promise.all(taskPRs.prs.map(async (pr) => {
            const approvalStatus = await checkPRApprovalStatus(pr.web_url);
            return { ...pr, isApproved: approvalStatus };
        }));

        const allApproved = prsWithApproval.every(pr => pr.isApproved);

        // Create and inject the unified view
        const unifiedView = createUnifiedView({ ...taskPRs, prs: prsWithApproval, allApproved });
        await injectUnifiedView(unifiedView);
    } catch (error) {
        console.error('Error loading unified PR view:', error);
    }
}

async function checkPRApprovalStatus(prUrl) {
    try {
        // Extract project and MR ID from URL
        const match = prUrl.match(/gitlab\.com\/([^/]+)\/-\/merge_requests\/(\d+)/);
        if (!match) return false;

        const [_, projectPath, mrId] = match;
        
        // Get GitLab token from storage
        const { gitlabToken } = await chrome.storage.sync.get(['gitlabToken']);
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
        const { username } = await chrome.storage.sync.get(['username']);
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
    
    if (taskPRs.allApproved) {
        container.innerHTML = `
            <div class="unified-pr-header">
                <h3>Related PRs for ${taskPRs.task_name}</h3>
                <span class="status approved">All Approved</span>
            </div>
            <div class="unified-pr-list">
                ${taskPRs.prs.map(pr => `
                    <div class="unified-pr-item approved">
                        <a href="${pr.web_url}" target="_blank" class="pr-link">
                            ${pr.repository_name} #${pr.iid}
                        </a>
                        <span class="pr-author">by ${pr.author.name}</span>
                        <span class="approval-status">✓ Approved</span>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="unified-pr-header">
                <h3>Related PRs for ${taskPRs.task_name}</h3>
                <span class="status ${taskPRs.status}">${taskPRs.status}</span>
            </div>
            <div class="unified-pr-list">
                ${taskPRs.prs.map(pr => `
                    <div class="unified-pr-item ${pr.isApproved ? 'approved' : ''}">
                        <a href="${pr.web_url}" target="_blank" class="pr-link">
                            ${pr.repository_name} #${pr.iid}
                        </a>
                        <span class="pr-author">by ${pr.author.name}</span>
                        ${pr.isApproved ? '<span class="approval-status">✓ Approved</span>' : ''}
                    </div>
                `).join('')}
            </div>
            <div class="unified-pr-actions">
                <button class="approve-all-btn" data-task-name="${taskPRs.task_name}">
                    Approve All
                </button>
            </div>
        `;

        // Add click event listener to the approve button
        const approveBtn = container.querySelector('.approve-all-btn');
        approveBtn.addEventListener('click', () => approveAllPRs(taskPRs.task_name));
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
            // Reload the page after a short delay
            setTimeout(() => window.location.reload(), 2000);
        } else {
            const error = await response.text();
            console.error('Failed to approve PRs:', error);
            // Show error message
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
        // Show error message
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