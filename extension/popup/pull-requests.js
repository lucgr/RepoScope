// Pull request management functionality
console.log("Pull requests module loaded and ready");

// Performance settings for fast initial loading
const FAST_LOAD_CONFIG = {
    INITIAL_LIMIT: 15,        // Very limited for first load
    EXPANDED_LIMIT: 50,       // More when user requests
    BATCH_SIZE: 5,           // Process approval checks in batches
    RETRY_DELAY: 1000        // Shorter retry delay
};

// Load unified PRs with fast initial loading
function loadUnifiedPRs(fastMode = true) {
    console.log(`[Popup Debug] loadUnifiedPRs called. Fast mode: ${fastMode}`);
    
    // Show loading indicator
    const contentArea = document.getElementById("unified-prs-content");
    if (contentArea) {
        if (fastMode) {
            contentArea.innerHTML = "<div class=\"loading\">Loading unified PRs...</div>";
        } else {
            contentArea.innerHTML = "<div class=\"loading\">Loading all PRs...</div>";
        }
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
        
        // Choose endpoint based on fast mode
        let apiUrl;
        if (fastMode) {
            // Use fast endpoint for initial load, but ensure pipeline status is included
            apiUrl = `${backendUrl}/api/prs/unified/fast?${repoQuery}&include_pipeline_status=true`;
        } else {
            // Use full endpoint with full_load=true to get all data and all PRs (higher limit)
            apiUrl = `${backendUrl}/api/prs/unified?${repoQuery}&full_load=true&include_pipeline_status=true`;
        }
        
        console.log("[Popup Debug] Fetching unified PRs from:", apiUrl);
        
        const startTime = Date.now();
        
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
            const loadTime = Date.now() - startTime;
            console.log(`Unified PRs loaded in ${loadTime}ms (${fastMode ? "fast" : "full"} mode)`);
            
            // Debug: Check if any PRs have pipeline status, TODO: remove, this was just for debugging
            // const tasks = Array.isArray(data) ? data : [data];
            // tasks.forEach(task => {
            //     console.log(`=== TASK: ${task.task_name} ===`);
            //     if (task.prs) {
            //         task.prs.forEach(pr => {
            //             console.log(`PR ${pr.iid} in ${pr.repository_name}:`, {
            //                 title: pr.title,
            //                 task_name: pr.task_name,  // This is important for backend matching
            //                 pipeline_status: pr.pipeline_status,
            //                 isApproved: pr.isApproved,
            //                 repository_url: pr.repository_url,
            //                 web_url: pr.web_url
            //             });
            //         });
            //     } else {
            //         console.log("No PRs found in task");
            //     }
            //     console.log(`=== END TASK: ${task.task_name} ===`);
            // });
            
            // Always completely replace the UI content
            updateUnifiedPRsUI(data, gitlabToken, fastMode);
            
            // For fast mode, fetch approval statuses asynchronously
            if (fastMode) {
                fetchApprovalStatusesAsync(data, gitlabToken);
            } else {
                // For full mode, fetch approval statuses normally
                fetchApprovalStatuses(data, gitlabToken);
            }
        })
        .catch(error => {
            console.error("Failed to fetch unified PRs:", error);
            if (contentArea) {
                contentArea.innerHTML = `<div class="error">Failed to load unified PRs: ${error.message}</div>`;
            }
        });
    });
}

// Async approval status fetching with batching for better performance
async function fetchApprovalStatusesAsync(data, gitlabToken) {
    if (!gitlabToken || !data) return;
    
    const tasks = Array.isArray(data) ? data : [data];
    
    // Process tasks in batches to avoid overwhelming the API
    for (let i = 0; i < tasks.length; i += FAST_LOAD_CONFIG.BATCH_SIZE) {
        const batch = tasks.slice(i, i + FAST_LOAD_CONFIG.BATCH_SIZE);
        
        // Process each task in the batch
        const batchPromises = batch.map(task => processTaskApprovals(task, gitlabToken));
        
        try {
            await Promise.all(batchPromises);
            console.log(`Processed approval batch ${Math.floor(i / FAST_LOAD_CONFIG.BATCH_SIZE) + 1}`);
        } catch (error) {
            console.error(`Error in approval batch ${Math.floor(i / FAST_LOAD_CONFIG.BATCH_SIZE) + 1}:`, error);
        }
        
        // Small delay between batches to be API-friendly
        if (i + FAST_LOAD_CONFIG.BATCH_SIZE < tasks.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
}

// Process approval status for a single task
async function processTaskApprovals(task, gitlabToken) {
    if (!task.prs || task.prs.length === 0) return;
    
    for (const pr of task.prs) {
        try {
            const projectPath = getProjectPathFromUrl(pr.repository_url);
            if (!projectPath) continue;
            
            const apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${pr.iid}/approvals`;
            
            const response = await fetch(apiUrl, {
                headers: {
                    "PRIVATE-TOKEN": gitlabToken
                }
            });
            
            if (response.ok) {
                const approvalData = await response.json();
                
                // Update PR with approval data
                pr.approved = approvalData.approved;
                pr.approved_by = approvalData.approved_by || [];
                pr.isApproved = approvalData.approved === true && 
                               approvalData.approved_by && 
                               approvalData.approved_by.length > 0;
                
                // Update UI for this specific PR
                updatePrApprovalStatus(pr);
            }
        } catch (error) {
            console.error(`Error fetching approval for PR ${pr.iid}:`, error);
        }
    }
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
                    "PRIVATE-TOKEN": gitlabToken
                }
            })
            .then(response => {
                console.log(`Approval response status: ${response.status}`);
                console.log("Approval response headers:", response.headers);
                if (!response.ok) {
                    return response.text().then(text => {
                        console.error(`Approval failed with status ${response.status}:`);
                        let errorMessage = text;
                        try {
                            const errorJson = JSON.parse(text);
                            console.error("Parsed error:", errorJson);
                            errorMessage = errorJson.detail || errorJson.message || text;
                        } catch (e) {
                            console.log("Error response is not JSON");
                        }
                        throw new Error(`Failed to approve: ${response.status} - ${errorMessage}`);
                    });
                }
                return response.json();
            })
            .then(approvalData => {
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
                
                // If all PRs processed, check if task is fully approved
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
    
    // Extract path from GitLab URL in format: https://gitlab.com/username/project
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
        
        // Remove the approve button for approved PRs
        const approveBtn = prItem.querySelector(".approve-btn");
        if (approveBtn) {
            approveBtn.remove();
        }
        
        // Add the approved class to the PR item
        prItem.classList.add("approved");
    } else {
        approvalStatus.className = "approval-status not-approved";
        approvalStatus.innerHTML = "Not approved";
        approvalStatus.title = "Not approved";
        
        // Remove the approved class if present
        prItem.classList.remove("approved");
    }
    
    // Check if all PRs in this task are now approved and update the approve all button
    const taskGroup = prItem.closest(".task-group");
    if (taskGroup) {
        const taskHeader = taskGroup.querySelector(".task-header h3");
        if (taskHeader) {
            const taskName = taskHeader.textContent.trim();
            // Remove the PR count part to get just the task name
            const taskNameOnly = taskName.split(" (")[0];
            updateTaskApprovalStatus(taskNameOnly);
        }
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

// Helper function to clean task name from any PR count information
function cleanTaskName(taskName) {
    if (!taskName) return taskName;
    // Remove PR count patterns if fetched from the DOM
    return taskName
        .replace(/\s*\(\d+\s+PRs?\)$/, "")  // Removes "(X PR)" or "(X PRs)"
        .replace(/\s*\(\d+\s+pr\)$/i, "")   // Case insensitive version
        .trim();
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
        const taskNameRaw = header ? header.textContent.trim() : null;
        
        if (!taskNameRaw) {
            console.error("Could not determine task name for approval");
            button.disabled = false;
            button.textContent = "Approve";
            return;
        }
        
        // Strip the PR count part to get just the task name
        const taskName = cleanTaskName(taskNameRaw);
        
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
                return response.text().then(text => {
                    let errorMessage = text;
                    try {
                        const errorJson = JSON.parse(text);
                        errorMessage = errorJson.detail || errorJson.message || text;
                    } catch (e) {
                        // Error response is not JSON
                    }
                    throw new Error(`Failed to approve: ${response.status} - ${errorMessage}`);
                });
            }
            return response.json();
        })
        .then(data => {
            // Update UI to reflect approval
            const prItem = button.closest(".pr-item");
            if (prItem) {
                // Add the approved class
                prItem.classList.add("approved");
                
                // Update approval status
                const approvalStatus = prItem.querySelector(".approval-status");
                if (approvalStatus) {
                    approvalStatus.className = "approval-status approved";
                    approvalStatus.innerHTML = "Approved";
                    approvalStatus.title = "Approved";
                }
                // Remove the approve button completely after approval
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

// Approve all PRs in a task group. TODO: ensure this also works for PRs matched only by branch name
function approveAllPRs(taskId) {
    let taskName;
    try {
        taskName = cleanTaskName(taskId);
    } catch (e) {
        console.error("Critical error in cleanTaskName during Approve All:", e);
        taskName = taskId; // Fallback or handle error appropriately
        alert("A critical error occurred while preparing to approve all PRs. Please check console.");
        return;
    }
    
    const taskHeaders = document.querySelectorAll(".task-group .task-header h3");
    let taskHeader = null;
    for (const header of taskHeaders) {
        const rawHeaderText = header.textContent.trim();
        const cleanedHeaderText = cleanTaskName(rawHeaderText);
        if (cleanedHeaderText === taskName) { 
            taskHeader = header;
            break;
        }
    }

    if (!taskHeader) {
        console.warn(`Approve All: No matching taskHeader found for cleaned task name "${taskName}".`);
        return;
    }
    const taskGroup = taskHeader.closest(".task-group");
    if (!taskGroup) {
        console.warn(`Approve All: No parent .task-group found for matched task header for "${taskName}".`);
        return;
    }
    
    const approveAllBtn = taskGroup.querySelector(".approve-all-btn");
    if (approveAllBtn) {
        approveAllBtn.disabled = true;
        approveAllBtn.textContent = "Approving...";
    }
    
    const approveBtns = taskGroup.querySelectorAll(".approve-btn");
    const repoUrls = [];
    approveBtns.forEach(btn => {
        const repoUrl = btn.dataset.repoUrl;
        if (repoUrl && !repoUrls.includes(repoUrl)) {
            repoUrls.push(repoUrl);
        }
        btn.disabled = true;
        btn.textContent = "Approving...";
    });
    
    if (repoUrls.length === 0) {
        console.warn(`Approve All: No repoUrls collected for task "${taskName}". Re-enabling button.`);
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
        
        fetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
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
                return response.text().then(text => {
                    let errorMessage = text;
                    try {
                        const errorJson = JSON.parse(text);
                        errorMessage = errorJson.detail || errorJson.message || text;
                    } catch (e) {
                        // Error response is not JSON
                    }
                    throw new Error(`Failed to approve all PRs: ${response.status} - ${errorMessage}`);
                });
            }
            return response.json();
        })
        .then(data => {
            approveBtns.forEach(btn => {
                const prItem = btn.closest(".pr-item");
                if (prItem) {
                    prItem.classList.add("approved");
                    
                    const approvalStatus = prItem.querySelector(".approval-status");
                    if (approvalStatus) {
                        approvalStatus.className = "approval-status approved";
                        approvalStatus.innerHTML = "Approved";
                        approvalStatus.title = "Approved";
                    }
                    
                    btn.remove();
                }
            });
            
            if (approveAllBtn) {
                const allApprovedDiv = document.createElement("div");
                allApprovedDiv.className = "all-approved";
                allApprovedDiv.textContent = "All PRs approved";
                approveAllBtn.parentNode.replaceChild(allApprovedDiv, approveAllBtn);
            }
        })
        .catch(error => {
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
        "skipped": "Pipeline skipped",
        "no_pipeline": "No pipeline run for this MR"
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
        "skipped": "skip_next",
        "no_pipeline": "do_not_disturb_on" // Icon for no pipeline
    };
    
    return labelMap[status] || "help"; // Default to "help" if state is actually unknown
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

// Add "Load More" option for fast mode. TODO: do I even use this anymore? Check if it can be removed.
function addLoadMoreOption(contentArea) {
    const loadMoreDiv = document.createElement("div");
    loadMoreDiv.className = "load-more-section";
    loadMoreDiv.innerHTML = `
        <div class="load-more-info">
            <p><strong>Quick view loaded!</strong> Showing recent PRs with multiple merge requests per task.</p>
            <button id="load-more-btn" class="load-more-btn">Load All PRs & Tasks</button>
            <p class="help-text">This will load all PRs including single-PR tasks and older PRs.</p>
        </div>
    `;
    contentArea.appendChild(loadMoreDiv);
    
    document.getElementById("load-more-btn").addEventListener("click", () => {
        // Remove the load more section
        loadMoreDiv.remove();
        
        // Show loading state immediately
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "loading-overlay";
        loadingDiv.innerHTML = "<div class=\"loading\">Loading all data...</div>";
        contentArea.appendChild(loadingDiv);
        
        // Load with full data (this will replace everything)
        loadUnifiedPRs(false);
    });
}

// Helper function to normalize pipeline status strings
function normalizeStatusString(statusString) {
    if (!statusString || typeof statusString !== "string") {
        return "unknown";
    }
    const rawStatus = statusString.toLowerCase();
    if (rawStatus.includes("success") || rawStatus === "ace" || rawStatus === "passed" || rawStatus === "succeeded") {
        return "success";
    } else if (rawStatus.includes("fail") || rawStatus === "error") {
        return "failed";
    } else if (rawStatus.includes("run")) { // Covers "running"
        return "running";
    } else if (rawStatus.includes("pend")) { // Covers "pending"
        return "pending";
    } else if (rawStatus === "canceled" || rawStatus === "cancelled") {
        return "canceled";
    } else if (rawStatus === "skipped") {
        return "skipped";
    } else if (rawStatus === "no_pipeline") { // Specific status if API confirms no pipelines
        return "no_pipeline";
    }
    console.log(`[Pipeline Normalize] Unknown status string: "${rawStatus}", defaulting to "unknown"`);
    return "unknown";
}

// Async function to fetch pipeline status directly from GitLab for a single PR
async function fetchPipelineStatusForPR(pr, gitlabToken) {
    if (!pr || !pr.repository_url || !pr.iid || !gitlabToken) {
        console.warn("[Pipeline Client Fetch] Missing data for fetching pipeline status for PR:", pr ? pr.title : "Unknown PR");
        return null; // Return null to indicate fetch couldn't be attempted or failed early
    }

    const projectPath = getProjectPathFromUrl(pr.repository_url);
    if (!projectPath) {
        console.warn("[Pipeline Client Fetch] Could not extract project path for PR:", pr.title, pr.repository_url);
        return null;
    }
    const apiUrl = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${pr.iid}/pipelines`;

    try {
        const response = await fetch(apiUrl, {
            method: "GET",
            headers: {
                "PRIVATE-TOKEN": gitlabToken,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            let errorText = `Status: ${response.status}`;
            try {
                const apiError = await response.json();
                errorText = apiError.message || JSON.stringify(apiError) || errorText;
            } catch (e) {
                try {
                    errorText = (await response.text()) || errorText;
                } catch (e_text) { /* ignore */ }
            }
            console.error(`[Pipeline Client Fetch] Failed to fetch pipelines for MR !${pr.iid} in ${projectPath}. ${errorText}`);
            return null; // Indicate failure
        }

        const pipelines = await response.json();
        if (pipelines && pipelines.length > 0) {
            const latestPipeline = pipelines[0]; // GitLab API returns latest first
            console.log(`[Pipeline Client Fetch] Successfully fetched pipeline status for MR !${pr.iid} (${pr.title}): ${latestPipeline.status}`);
            return latestPipeline.status;
        } else {
            console.log(`[Pipeline Client Fetch] No pipelines found for MR !${pr.iid} (${pr.title}) in ${projectPath}.`);
            return "no_pipeline";
        }
    } catch (error) {
        console.error(`[Pipeline Client Fetch] Error fetching pipelines for MR !${pr.iid} (${pr.title}) in ${projectPath}:`, error);
        return null; // Indicate failure
    }
}

// Update unified PRs UI with fast mode support
function updateUnifiedPRsUI(data, gitlabToken, fastMode = false) {
    const contentArea = document.getElementById("unified-prs-content");
    if (!contentArea) return;
    
    contentArea.innerHTML = ""; // Clear previous content
    
    if (!data || (Array.isArray(data) && data.length === 0)) {
        if (fastMode) {
            contentArea.innerHTML = "<div class=\"empty-state\">No recent multi-PR tasks found.<br><a href=\"#\" onclick=\"loadUnifiedPRs(false)\">Load all PRs to see everything</a></div>";
        } else {
            contentArea.innerHTML = "<div class=\"empty-state\">No pull requests found</div>";
        }
        return;
    }
    
    // Add performance info for fast mode
    if (fastMode) {
        const infoDiv = document.createElement("div");
        infoDiv.className = "performance-info";
        infoDiv.innerHTML = `
            <div class="quick-load-notice">
                <span>Quick load enabled - showing recent multi-PR tasks</span>
            </div>
        `;
        contentArea.appendChild(infoDiv);
    } else {
        // Add info for full mode
        const infoDiv = document.createElement("div");
        infoDiv.className = "performance-info";
        infoDiv.style.background = "#e8f5e9";
        infoDiv.style.borderColor = "#c8e6c9";
        infoDiv.innerHTML = `
            <div class="quick-load-notice" style="color: #2e7d32;">
                <span>Full data loaded - showing all PRs and tasks</span>
            </div>
        `;
        contentArea.appendChild(infoDiv);
    }
    
    const tasks = Array.isArray(data) ? data : [data];
    console.log(`Displaying ${tasks.length} tasks in ${fastMode ? "fast" : "full"} mode`);
    
    tasks.forEach(task => {
        if (!task.task_name || !task.prs || task.prs.length === 0) return;
        
        const taskGroup = document.createElement("div");
        taskGroup.className = "task-group";
        
        // Create task header
        const taskHeader = document.createElement("div");
        taskHeader.className = "task-header";
        
        const taskTitle = document.createElement("h3");
        taskTitle.textContent = task.task_name;
        taskHeader.appendChild(taskTitle);
        
        // Add PR count indicator
        const prCount = document.createElement("span");
        prCount.className = "pr-count";
        prCount.style.fontSize = "12px";
        prCount.style.color = "#666";
        prCount.style.marginLeft = "8px";
        prCount.textContent = `(${task.prs.length} PR${task.prs.length > 1 ? "s" : ""})`;
        taskTitle.appendChild(prCount);
        
        // Add approve all button if there's more than one PR and not all are approved
        if (task.prs.length > 1) {
            // Check if all PRs are already approved
            const allApproved = task.prs.every(pr => pr.isApproved === true);
            
            if (!allApproved) {
                const approveAllWrapper = document.createElement("div");
                approveAllWrapper.className = "approve-all-wrapper";
                
                const approveAllBtn = document.createElement("button");
                approveAllBtn.className = "approve-all-btn";
                approveAllBtn.textContent = "Approve All";
                approveAllBtn.dataset.task = task.task_name;
                
                approveAllWrapper.appendChild(approveAllBtn);
                
                taskHeader.appendChild(approveAllWrapper);
            } else {
                // If all PRs are approved, show "All PRs approved" message instead
                const allApprovedWrapper = document.createElement("div");
                allApprovedWrapper.className = "all-approved";
                allApprovedWrapper.textContent = "All PRs approved";
                taskHeader.appendChild(allApprovedWrapper);
            }
        }
        
        taskGroup.appendChild(taskHeader);
        
        const prsList = document.createElement("div");
        prsList.className = "prs-list";
        
        task.prs.forEach(pr => {
            // console.log(`Rendering PR: ${pr.title}, repo: ${pr.repository_url}, pipeline_status (from backend): ${pr.pipeline_status}, isApproved: ${pr.isApproved}`);
            
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
            
            const prActions = document.createElement("div");
            prActions.className = "pr-actions";

            // Initial Pipeline Status Display (from backend data or default)
            let initialStatusToNormalize = null;
            if (pr.pipeline_status) {
                if (typeof pr.pipeline_status === "object" && pr.pipeline_status !== null && typeof pr.pipeline_status.status === "string") {
                    initialStatusToNormalize = pr.pipeline_status.status;
                } else if (typeof pr.pipeline_status === "string") {
                    initialStatusToNormalize = pr.pipeline_status;
                }
            }
            let currentNormalizedStatus = normalizeStatusString(initialStatusToNormalize);

            const pipelineStatusEl = document.createElement("span");
            pipelineStatusEl.className = "pipeline-badge " + getPipelineStatusClass(currentNormalizedStatus);
            pipelineStatusEl.innerHTML = `<i class="material-icons">${getPipelineStatusLabel(currentNormalizedStatus)}</i>`;
            pipelineStatusEl.title = getPipelineStatusTitle(currentNormalizedStatus);
            prActions.appendChild(pipelineStatusEl);

            // If backend status is null, try to fetch from GitLab directly, 
            // using a combination of task name and PR IID for a more unique ID.
            const pipelineStatusElId = `pipeline-status-${task.task_name.replace(/\s+/g, "-")}-${pr.iid}`;
            pipelineStatusEl.id = pipelineStatusElId;

            if (pr.pipeline_status === null && gitlabToken) {
                console.log(`[Pipeline Fallback] Backend status for PR ${pr.title} is null. Attempting direct GitLab fetch.`);
                fetchPipelineStatusForPR(pr, gitlabToken).then(gitlabStatus => {
                    if (gitlabStatus) {
                        const newNormalizedStatus = normalizeStatusString(gitlabStatus);
                        // Update the PR object in memory as well
                        pr.pipeline_status_fetched = newNormalizedStatus; // Store a separate field to avoid re-fetching on simple UI redraws
                        
                        const elToUpdate = document.getElementById(pipelineStatusElId);
                        if (elToUpdate) {
                            console.log(`[Pipeline Fallback] Updating PR ${pr.title} with fetched status: ${newNormalizedStatus}`);
                            elToUpdate.className = "pipeline-badge " + getPipelineStatusClass(newNormalizedStatus);
                            elToUpdate.innerHTML = `<i class="material-icons">${getPipelineStatusLabel(newNormalizedStatus)}</i>`;
                            elToUpdate.title = getPipelineStatusTitle(newNormalizedStatus);
                        } else {
                            console.warn(`[Pipeline Fallback] Could not find element with ID ${pipelineStatusElId} to update for PR ${pr.title}`);
                        }
                    } else if (gitlabStatus === null) {
                        // Fetch failed or couldn't be attempted, icon remains as initially set (likely 'unknown')
                        console.log(`[Pipeline Fallback] Direct fetch for PR ${pr.title} returned null or failed, no UI update for icon.`);
                    }
                }).catch(error => {
                    console.error(`[Pipeline Fallback] Error during direct fetch for PR ${pr.title}:`, error);
                });
            }
            
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

    approveAllBtns.forEach((btn, index) => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener("click", function() {
            const rawTaskId = this.dataset.task;
            if (!rawTaskId) {
                alert("Error: Could not approve all PRs because task ID is missing.");
                return;
            }
            try {
                const cleanedTaskId = cleanTaskName(rawTaskId);
                approveAllPRs(cleanedTaskId);
            } catch (error) {
                alert(`Error during 'Approve All': ${error.message}`);
            }
        });
    });
    
    // Add load more option for fast mode only
    if (fastMode) {
        addLoadMoreOption(contentArea);
    }
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