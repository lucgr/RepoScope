document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.sync.get(['backendUrl', 'gitlabToken', 'repoUrls'], (data) => {
        console.log('Loaded settings:', data);
        document.getElementById('backend-url').value = data.backendUrl || '';
        document.getElementById('gitlab-token').value = data.gitlabToken || '';
        document.getElementById('repo-urls').value = data.repoUrls || '';
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
        const { backendUrl, repoUrls } = await chrome.storage.sync.get(['backendUrl', 'repoUrls']);
        
        console.log('Loading unified PRs with:', { backendUrl, repoUrls });
        
        if (!backendUrl || !repoUrls) {
            console.error('Missing required settings:', { backendUrl, repoUrls });
            return;
        }

        try {
            // Convert newline-separated URLs to array and encode them
            const urls = repoUrls.split('\n')
                .filter(url => url.trim())
                .map(url => encodeURIComponent(url));
            
            console.log('Processed URLs:', urls);
            
            // Join URLs with '&repo_urls=' to create the query string
            const queryString = urls.map(url => `repo_urls=${url}`).join('&');
            const apiUrl = `${backendUrl}/api/prs/unified?${queryString}`;
            
            console.log('Making API request to:', apiUrl);
            
            const response = await fetch(apiUrl);
            console.log('API response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            
            const unifiedPRs = await response.json();
            console.log('Received PRs:', unifiedPRs);
            
            const prsList = document.getElementById('unified-prs-list');
            prsList.innerHTML = '';

            if (unifiedPRs.length === 0) {
                prsList.innerHTML = '<p class="no-prs">No related PRs found</p>';
                return;
            }

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
                    <button class="approve-btn" data-task-name="${pr.task_name}">
                        Approve All
                    </button>
                `;

                // Add click event listener to the button
                const approveBtn = prCard.querySelector('.approve-btn');
                approveBtn.addEventListener('click', () => approvePRs(pr.task_name));

                prsList.appendChild(prCard);
            });
        } catch (error) {
            console.error('Error loading unified PRs:', error);
            const prsList = document.getElementById('unified-prs-list');
            prsList.innerHTML = `<p class="error">Error loading PRs: ${error.message}</p>`;
        }
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