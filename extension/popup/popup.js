document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'projectIds'], (data) => {
        document.getElementById('backend-url').value = data.backendUrl || '';
        document.getElementById('gitlab-token').value = data.gitlabToken || '';
        document.getElementById('project-ids').value = data.projectIds || '';
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', () => {
        const backendUrl = document.getElementById('backend-url').value;
        const gitlabToken = document.getElementById('gitlab-token').value;
        const projectIds = document.getElementById('project-ids').value;

        chrome.storage.sync.set({
            backendUrl,
            gitlabToken,
            projectIds
        }, () => {
            // Reload unified PRs after saving settings
            loadUnifiedPRs();
        });
    });

    // Load unified PRs
    async function loadUnifiedPRs() {
        const { backendUrl, projectIds } = await chrome.storage.sync.get(['backendUrl', 'projectIds']);
        
        if (!backendUrl || !projectIds) {
            return;
        }

        try {
            const response = await fetch(`${backendUrl}/api/prs/unified?project_ids=${projectIds}`);
            const unifiedPRs = await response.json();
            
            const prsList = document.getElementById('unified-prs-list');
            prsList.innerHTML = '';

            unifiedPRs.forEach(pr => {
                const prCard = document.createElement('div');
                prCard.className = 'pr-card';
                
                prCard.innerHTML = `
                    <h3>${pr.task_name}</h3>
                    <span class="status ${pr.status}">${pr.status}</span>
                    <div class="pr-links">
                        ${pr.prs.map(p => `
                            <a href="${p.web_url}" target="_blank" class="pr-link">
                                ${p.repository_name} #${p.iid}
                            </a>
                        `).join('')}
                    </div>
                    <div class="pr-stats">
                        <span>Changes: ${pr.total_changes}</span>
                        <span>Comments: ${pr.total_comments}</span>
                    </div>
                    <button onclick="approvePRs('${pr.task_name}')" class="approve-btn">
                        Approve All
                    </button>
                `;

                prsList.appendChild(prCard);
            });
        } catch (error) {
            console.error('Error loading unified PRs:', error);
        }
    }

    // Approve all PRs for a task
    window.approvePRs = async (taskName) => {
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
                // Reload the PRs list
                loadUnifiedPRs();
            }
        } catch (error) {
            console.error('Error approving PRs:', error);
        }
    };

    // Initial load of unified PRs
    loadUnifiedPRs();
}); 