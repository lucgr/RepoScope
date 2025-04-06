// Wait for the page to load
document.addEventListener('DOMContentLoaded', () => {
    // Check if we're on a merge request page
    if (!window.location.pathname.includes('/-/merge_requests/')) {
        return;
    }

    // Get the current PR's branch name
    const branchName = document.querySelector('.branch-name')?.textContent?.trim();
    if (!branchName) {
        return;
    }

    // Extract task name from branch name
    const taskName = extractTaskName(branchName);
    if (!taskName) {
        return;
    }

    // Add unified PR view to the page
    addUnifiedPRView(taskName);
});

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
    // Get settings from storage
    const { backendUrl, projectIds } = await chrome.storage.sync.get(['backendUrl', 'projectIds']);
    
    if (!backendUrl || !projectIds) {
        return;
    }

    try {
        // Fetch related PRs
        const response = await fetch(`${backendUrl}/api/prs/unified?project_ids=${projectIds}`);
        const unifiedPRs = await response.json();
        
        // Find PRs for the current task
        const taskPRs = unifiedPRs.find(pr => pr.task_name === taskName);
        if (!taskPRs || taskPRs.prs.length <= 1) {
            return;
        }

        // Create and inject the unified view
        const unifiedView = createUnifiedView(taskPRs);
        injectUnifiedView(unifiedView);
    } catch (error) {
        console.error('Error loading unified PR view:', error);
    }
}

function createUnifiedView(taskPRs) {
    const container = document.createElement('div');
    container.className = 'unified-pr-view';
    
    container.innerHTML = `
        <div class="unified-pr-header">
            <h3>Related PRs for ${taskPRs.task_name}</h3>
            <span class="status ${taskPRs.status}">${taskPRs.status}</span>
        </div>
        <div class="unified-pr-list">
            ${taskPRs.prs.map(pr => `
                <div class="unified-pr-item">
                    <a href="${pr.web_url}" target="_blank" class="pr-link">
                        ${pr.repository_name} #${pr.iid}
                    </a>
                    <span class="pr-author">by ${pr.author.name}</span>
                </div>
            `).join('')}
        </div>
        <div class="unified-pr-actions">
            <button class="approve-all-btn" onclick="approveAllPRs('${taskPRs.task_name}')">
                Approve All
            </button>
        </div>
    `;

    return container;
}

function injectUnifiedView(view) {
    // Find the merge request description section
    const descriptionSection = document.querySelector('.merge-request-description');
    if (!descriptionSection) {
        return;
    }

    // Insert the unified view after the description
    descriptionSection.parentNode.insertBefore(view, descriptionSection.nextSibling);
}

// Add approve all function to window
window.approveAllPRs = async (taskName) => {
    const { backendUrl, projectIds } = await chrome.storage.sync.get(['backendUrl', 'projectIds']);
    
    if (!backendUrl || !projectIds) {
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/api/prs/approve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                task_name: taskName,
                project_ids: projectIds.split(',').map(id => parseInt(id.trim()))
            })
        });

        if (response.ok) {
            // Reload the page to show updated status
            window.location.reload();
        }
    } catch (error) {
        console.error('Error approving PRs:', error);
    }
}; 