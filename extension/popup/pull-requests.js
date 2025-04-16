// Pull request management functionality
console.log("Pull requests module loaded and ready");

// Load unified PRs from the backend
function loadUnifiedPRs() {
    console.log("Loading unified PRs");
    
    // Show loading indicator
    const contentArea = document.getElementById("unified-prs-content");
    if (contentArea) {
        contentArea.innerHTML = "<div class=\"loading\">Loading unified PRs...</div>";
    }
    
    // Get settings from storage
    chrome.storage.sync.get(["backendUrl", "repoUrls", "gitlabToken"], function(data) {
        const backendUrl = data.backendUrl;
        const repoUrls = data.repoUrls;
        const gitlabToken = data.gitlabToken;
        
        // Check if all required settings are present
        if (!backendUrl || !repoUrls || !gitlabToken) {
            if (contentArea) {
                contentArea.innerHTML = "<div class=\"error\">Please configure Backend URL, Repository URLs, and GitLab Token in the Settings tab.</div>";
            }
            console.error("Cannot load unified PRs: Missing settings", { backendUrl, repoUrls, gitlabToken });
            return;
        }

        // Create query string from repository URLs
        const repoUrlsArray = repoUrls.split("\n").filter(url => url.trim().length > 0);
        if (repoUrlsArray.length === 0) {
            if (contentArea) {
                contentArea.innerHTML = "<div class=\"error\">No repository URLs specified.</div>";
            }
            return;
        }
        
        const repoQuery = repoUrlsArray.map(url => `repo_urls=${encodeURIComponent(url)}`).join("&");
        
        // Fetch unified PRs from backend
        const apiUrl = `${backendUrl}/api/prs/unified?${repoQuery}`;
        console.log("Fetching unified PRs from:", apiUrl);
        
        fetch(apiUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Unified PRs data structure:", JSON.stringify(data, null, 2));
            
            // First show the UI with the data we have
            updateUnifiedPRsUI(data);
            
            // Then fetch approval statuses
            fetchApprovalStatuses(data, gitlabToken);
        })
        .catch(error => {
            console.error("Failed to fetch unified PRs:", error);
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
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${gitlabToken}`
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
    if (!pr || !pr.id) return;
    
    // Find the PR element
    const prItem = document.querySelector(`.pr-item[data-pr-id="${pr.id}"]`);
    if (!prItem) return;
    
    // Find the approval status element
    const approvalStatus = prItem.querySelector(".approval-status");
    if (!approvalStatus) return;
    
    // Update approval status
    if (pr.isApproved) {
        approvalStatus.className = "approval-status approved";
        approvalStatus.innerHTML = "Approved";
        approvalStatus.title = "Approved";
        
        // Disable the approve button
        const approveBtn = prItem.querySelector(".approve-btn");
        if (approveBtn) {
            approveBtn.disabled = true;
            approveBtn.textContent = "Approved";
        }
    } else {
        approvalStatus.className = "approval-status not-approved";
        approvalStatus.innerHTML = "Not approved";
        approvalStatus.title = "Not approved";
    }
}

// Update the UI with approval status for an entire task
function updateTaskApprovalStatus(taskName) {
    if (!taskName) return;
    
    // Find the task group
    const taskHeader = findElementWithText(".task-group .task-header h3", taskName);
    if (!taskHeader) return;
    
    const taskGroup = taskHeader.closest(".task-group");
    if (!taskGroup) return;
    
    // Check if all PRs in this task are approved
    const prItems = taskGroup.querySelectorAll(".pr-item");
    let allApproved = true;
    
    prItems.forEach(item => {
        const status = item.querySelector(".approval-status");
        if (status && !status.classList.contains("approved")) {
            allApproved = false;
        }
    });
    
    // If all are approved, update the "Approve All" button
    if (allApproved) {
        const approveAllBtn = taskGroup.querySelector(".approve-all-btn");
        if (approveAllBtn) {
            const allApprovedDiv = document.createElement("div");
            allApprovedDiv.className = "all-approved";
            allApprovedDiv.textContent = "All PRs approved";
            approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
        }
    }
}

// Update unified PRs UI
function updateUnifiedPRsUI(data) {
    const contentArea = document.getElementById("unified-prs-content");
    if (!contentArea) return;
    
    // Check if data is empty or invalid
    if (!data || (Array.isArray(data) && data.length === 0)) {
        contentArea.innerHTML = "<div class=\"empty-state\">No pull requests found</div>";
        return;
    }

    console.log("Data for unified PRs:", data);

    // Clear content area
    contentArea.innerHTML = "";
    
    // Check if we got a single task or an array of tasks
    const tasks = Array.isArray(data) ? data : [data];
    
    // Process task groups
    tasks.forEach(task => {
        // Skip if no task name or PRs
        if (!task.task_name || !task.prs || task.prs.length === 0) return;
        
        console.log(`Task ${task.task_name} PRs:`, task.prs);
        
        const taskGroup = document.createElement("div");
        taskGroup.className = "task-group";
        
        // Create task header
        const taskHeader = document.createElement("div");
        taskHeader.className = "task-header";
        
        const taskTitle = document.createElement("h3");
        taskTitle.textContent = task.task_name;
        taskHeader.appendChild(taskTitle);
        
        // Add approve all button if there's more than one PR
        if (task.prs.length > 1) {
            const approveAllWrapper = document.createElement("div");
            approveAllWrapper.className = "approve-all-wrapper";
            
            const approveAllBtn = document.createElement("button");
            approveAllBtn.className = "approve-all-btn";
            approveAllBtn.textContent = "Approve All";
            approveAllBtn.dataset.task = task.task_name;
            approveAllWrapper.appendChild(approveAllBtn);
            
            taskHeader.appendChild(approveAllWrapper);
        }
        
        taskGroup.appendChild(taskHeader);
        
        // Create PR list
        const prsList = document.createElement("div");
        prsList.className = "prs-list";
        
        // Add each PR
        task.prs.forEach(pr => {
            const prItem = document.createElement("div");
            prItem.className = "pr-item";
            prItem.dataset.prId = pr.id;
            
            // Check if PR is already approved
            const isApproved = pr.isApproved === true;
            if (isApproved) {
                prItem.classList.add("approved");
            }
            
            // PR title and links
            const prHeader = document.createElement("div");
            prHeader.className = "pr-header";
            
            // Repository name
            const repoName = document.createElement("div");
            repoName.className = "repo-name";
            repoName.textContent = pr.repository_name || "Unknown repo";
            prHeader.appendChild(repoName);
            
            // PR title with link
            const prTitle = document.createElement("div");
            prTitle.className = "pr-title";
            
            const prLink = document.createElement("a");
            prLink.href = pr.web_url;
            prLink.textContent = pr.title || "Unnamed PR";
            prLink.target = "_blank";
            prTitle.appendChild(prLink);
            
            prHeader.appendChild(prTitle);
            prItem.appendChild(prHeader);
            
            // PR actions and status
            const prActions = document.createElement("div");
            prActions.className = "pr-actions";
            
            // Create a simple pipeline status badge
            let pipelineStatusValue = "unknown";
            if (pr.pipeline_status) {
                if (typeof pr.pipeline_status === 'string') {
                    // Normalize status to our standard values
                    const status = pr.pipeline_status.toLowerCase();
                    if (status.includes('success') || status === 'ace') {
                        pipelineStatusValue = 'success';
                    } else if (status.includes('fail')) {
                        pipelineStatusValue = 'failed';
                    } else if (status.includes('run')) {
                        pipelineStatusValue = 'running';
                    } else if (status.includes('pend')) {
                        pipelineStatusValue = 'pending';
                    }
                }
            }
            
            // Create a simple text badge
            const pipelineStatus = document.createElement("span");
            pipelineStatus.className = `pipeline-badge pipeline-${pipelineStatusValue}`;
            pipelineStatus.innerHTML = `<i class="material-icons">${getPipelineStatusLabel(pipelineStatusValue)}</i>`;
            pipelineStatus.title = getPipelineStatusTitle(pipelineStatusValue);
            prActions.appendChild(pipelineStatus);
            
            // Approval status
            const approvalStatus = document.createElement("div");
            if (isApproved) {
                approvalStatus.className = "approval-status approved";
                approvalStatus.innerHTML = "Approved";
                approvalStatus.title = "Approved";
            } else {
                approvalStatus.className = "approval-status not-approved";
                approvalStatus.innerHTML = "Not approved";
                approvalStatus.title = "Not approved";
            }
            prActions.appendChild(approvalStatus);
            
            // Add approve button only if PR is not already approved
            if (!isApproved) {
                const approveBtn = document.createElement("button");
                approveBtn.className = "approve-btn";
                approveBtn.textContent = "Approve";
                approveBtn.dataset.repoUrl = pr.repository_url;
                approveBtn.dataset.prId = pr.iid;
                approveBtn.onclick = function() {
                    approvePR(pr.repository_url, pr.iid, this);
                };
                prActions.appendChild(approveBtn);
            }
            
            prItem.appendChild(prActions);
            prsList.appendChild(prItem);
        });
        
        taskGroup.appendChild(prsList);
        contentArea.appendChild(taskGroup);
    });
    
    // Add event listeners for approve all buttons
    const approveAllBtns = contentArea.querySelectorAll(".approve-all-btn");
    approveAllBtns.forEach(btn => {
        btn.addEventListener("click", function() {
            const taskId = this.dataset.task;
            approveAllPRs(taskId);
        });
    });
}

// Approve a single PR
function approvePR(repoUrl, prId, button) {
    button.disabled = true;
    button.textContent = "Approving...";
    
    chrome.storage.sync.get(["gitlabToken", "backendUrl"], function(data) {
        const gitlabToken = data.gitlabToken;
        const backendUrl = data.backendUrl;
        
        if (!gitlabToken || !backendUrl) {
            alert("Please configure Backend URL and GitLab Token in Settings");
            button.disabled = false;
            button.textContent = "Approve";
            return;
        }
        
        // Find the task name from the task header
        const prItem = button.closest(".pr-item");
        const taskGroup = prItem ? prItem.closest(".task-group") : null;
        const header = taskGroup ? taskGroup.querySelector(".task-header h3") : null;
        const taskName = header ? header.textContent.trim() : null;
        
        if (!taskName) {
            console.error("Could not determine task name for approval");
            button.disabled = false;
            button.textContent = "Approve";
            return;
        }
        
        fetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken
            },
            body: JSON.stringify({
                repo_urls: [repoUrl]
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to approve: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("PR approved:", data);
            
            // Update UI to reflect approval
            const prItem = button.closest(".pr-item");
            if (prItem) {
                const approvalStatus = prItem.querySelector(".approval-status");
                if (approvalStatus) {
                    approvalStatus.className = "approval-status approved";
                    approvalStatus.innerHTML = "Approved";
                    approvalStatus.title = "Approved";
                }
                
                // Remove the approve button completely
                button.remove();
            }
            
            // Check if all PRs in this task are now approved
            checkAllTaskPRsApproved(prItem);
        })
        .catch(error => {
            console.error("Failed to approve PR:", error);
            button.disabled = false;
            button.textContent = "Approve";
            alert(`Failed to approve PR: ${error.message}`);
        });
    });
}

// Check if all PRs in a task group are approved
function checkAllTaskPRsApproved(prItem) {
    if (!prItem) return;
    
    const taskGroup = prItem.closest(".task-group");
    if (!taskGroup) return;
    
    // Check if all PRs have approval status of "approved"
    const notApprovedStatuses = taskGroup.querySelectorAll(".approval-status.not-approved");
    
    if (notApprovedStatuses.length === 0) {
        // All PRs are approved, replace the "Approve All" button with "All PRs approved" message
        const approveAllBtn = taskGroup.querySelector(".approve-all-btn");
        if (approveAllBtn) {
            const allApprovedDiv = document.createElement("div");
            allApprovedDiv.className = "all-approved";
            allApprovedDiv.textContent = "All PRs approved";
            approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
        }
    }
}

// Approve all PRs in a task group
function approveAllPRs(taskId) {
    // Find the task group using our helper function
    const taskHeader = findElementWithText(".task-group .task-header h3", taskId);
    if (!taskHeader) {
        console.error(`Task header with ID ${taskId} not found`);
        return;
    }
    
    const taskGroup = taskHeader.closest(".task-group");
    if (!taskGroup) {
        console.error("Could not find task group container");
        return;
    }
    
    const approveAllBtn = taskGroup.querySelector(".approve-all-btn");
    if (approveAllBtn) {
        approveAllBtn.disabled = true;
        approveAllBtn.textContent = "Approving...";
    }
    
    // Get all repository URLs from the task group
    const repoUrls = [];
    const approveBtns = taskGroup.querySelectorAll(".approve-btn");
    approveBtns.forEach(btn => {
        const repoUrl = btn.dataset.repoUrl;
        if (repoUrl && !repoUrls.includes(repoUrl)) {
            repoUrls.push(repoUrl);
        }
        btn.disabled = true;
        btn.textContent = "Approving...";
    });
    
    if (repoUrls.length === 0) {
        console.error("No repository URLs found in task group");
        if (approveAllBtn) {
            approveAllBtn.disabled = false;
            approveAllBtn.textContent = "Approve All";
        }
        approveBtns.forEach(btn => {
            btn.disabled = false;
            btn.textContent = "Approve";
        });
        return;
    }
    
    // Make a single API call to approve all PRs for this task
    chrome.storage.sync.get(["gitlabToken", "backendUrl"], function(data) {
        const gitlabToken = data.gitlabToken;
        const backendUrl = data.backendUrl;
        
        if (!gitlabToken || !backendUrl) {
            alert("Please configure Backend URL and GitLab Token in Settings");
            if (approveAllBtn) {
                approveAllBtn.disabled = false;
                approveAllBtn.textContent = "Approve All";
            }
            approveBtns.forEach(btn => {
                btn.disabled = false;
                btn.textContent = "Approve";
            });
            return;
        }
        
        fetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskId)}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken
            },
            body: JSON.stringify({
                repo_urls: repoUrls
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to approve all PRs: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("All PRs approved:", data);
            
            // Update UI to reflect approval
            approveBtns.forEach(btn => {
                const prItem = btn.closest(".pr-item");
                if (prItem) {
                    const approvalStatus = prItem.querySelector(".approval-status");
                    if (approvalStatus) {
                        approvalStatus.className = "approval-status approved";
                        approvalStatus.innerHTML = "Approved";
                        approvalStatus.title = "Approved";
                    }
                    
                    // Remove the approve button
                    btn.remove();
                }
            });
            
            // Replace "Approve All" with "All Approved"
            if (approveAllBtn) {
                const allApprovedDiv = document.createElement("div");
                allApprovedDiv.className = "all-approved";
                allApprovedDiv.textContent = "All PRs approved";
                approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
            }
        })
        .catch(error => {
            console.error("Failed to approve all PRs:", error);
            if (approveAllBtn) {
                approveAllBtn.disabled = false;
                approveAllBtn.textContent = "Approve All";
            }
            approveBtns.forEach(btn => {
                btn.disabled = false;
                btn.textContent = "Approve";
            });
            alert(`Failed to approve all PRs: ${error.message}`);
        });
    });
}

// Function to get pipeline status class
function getPipelineStatusClass(status) {
    // If status is undefined, null, or empty string, return unknown
    if (!status) {
        console.log("Undefined or null pipeline status, using 'unknown'");
        return "pipeline-unknown";
    }
    
    const statusMap = {
        "success": "pipeline-success",
        "failed": "pipeline-failed",
        "running": "pipeline-running",
        "pending": "pipeline-pending",
        "canceled": "pipeline-canceled",
        "skipped": "pipeline-skipped"
    };
    
    // Convert status to lowercase and check if it exists in the map
    const normalizedStatus = status.toLowerCase();
    if (statusMap[normalizedStatus]) {
        return statusMap[normalizedStatus];
    }
    
    // If the status isn't in our map, log and return unknown
    console.log(`Unknown pipeline status: "${status}", using default 'pipeline-unknown'`);
    return "pipeline-unknown";
}

// Function to get pipeline status title
function getPipelineStatusTitle(status) {
    const titleMap = {
        "success": "Pipeline succeeded",
        "failed": "Pipeline failed",
        "running": "Pipeline running",
        "pending": "Pipeline pending",
        "canceled": "Pipeline canceled",
        "skipped": "Pipeline skipped"
    };
    
    return titleMap[status] || "Pipeline status unknown";
}

// Function to get pipeline status label
function getPipelineStatusLabel(status) {
    const labelMap = {
        "success": "check_circle",
        "failed": "error",
        "running": "sync",
        "pending": "schedule",
        "canceled": "cancel",
        "skipped": "skip_next"
    };
    
    return labelMap[status] || "help";
}

// Helper function to find an element with specific text content
function findElementWithText(selector, text) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
        if (element.textContent.trim() === text) {
            return element;
        }
    }
    return null;
}

// Export functions for use in other modules
window.loadUnifiedPRs = loadUnifiedPRs;
window.fetchApprovalStatuses = fetchApprovalStatuses;
window.getProjectPathFromUrl = getProjectPathFromUrl;
window.updatePrApprovalStatus = updatePrApprovalStatus;
window.updateTaskApprovalStatus = updateTaskApprovalStatus;
window.updateUnifiedPRsUI = updateUnifiedPRsUI;
window.approvePR = approvePR;
window.checkAllTaskPRsApproved = checkAllTaskPRsApproved;
window.approveAllPRs = approveAllPRs;
window.getPipelineStatusClass = getPipelineStatusClass;
window.getPipelineStatusTitle = getPipelineStatusTitle;
window.getPipelineStatusLabel = getPipelineStatusLabel; 