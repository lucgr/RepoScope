// This file is responsible for the content script that runs on the page.

console.log("%c MultiRepoHub Extension Loaded ", "background: #222; color:rgb(82, 218, 172); font-size: 16px;");

// Immediately check storage to verify settings
chrome.storage.sync.get(["backendUrl", "repoUrls"], (result) => {
    console.log("%c Extension Settings ", "background: #222; color:rgb(115, 245, 165)", {
        hasBackendUrl: !!result.backendUrl,
        hasRepoUrls: !!result.repoUrls,
        backendUrl: result.backendUrl ? result.backendUrl.substring(0, 10) + "..." : "not set",
        repoUrls: result.repoUrls ? result.repoUrls.split("\n").length + " repos configured" : "not set"
    });
});

// Function to initialize the PR view
async function initializePRView() {
    try {
        // Debug the current page URL
        console.log("Current URL:", window.location.href);
        console.log("Pathname:", window.location.pathname);
        
        // Check if we're on a merge request page
        if (!window.location.pathname.includes("/-/merge_requests/")) {
            console.log("Not on a merge request page, skipping injection");
            return;
        }
        console.log("On a merge request page, proceeding with injection");

        // Get settings from storage
        const settings = await chrome.storage.sync.get(["backendUrl", "repoUrls", "gitlabToken", "username"]);
        if (!settings.backendUrl || !settings.repoUrls || !settings.gitlabToken || !settings.username) {
            console.error("Missing required settings:", {
                hasBackendUrl: !!settings.backendUrl,
                hasRepoUrls: !!settings.repoUrls,
                hasGitlabToken: !!settings.gitlabToken,
                hasUsername: !!settings.username
            });
            return;
        }
        console.log("All required settings found, proceeding with branch detection");

        // Try multiple selectors for the branch name
        const branchSelectors = [
            ".ref-container",                      // Primary selector based on actual DOM
            ".detail-page-description .ref-container", // Fallback for description area
            ".merge-request-details .ref-name",    // Additional selector
            ".merge-request-title-source"          // Title source element
        ];

        // Try to get branch name from URL first
        const urlMatch = window.location.pathname.match(/\/-\/merge_requests\/\d+\/diffs\?diff_id=\d+&start_sha=([^&]+)/);
        let branchName = urlMatch ? urlMatch[1] : null;

        // If no branch name from URL, try DOM selectors
        if (!branchName) {

            let branchElement = null;
            for (const selector of branchSelectors) {
                const elements = document.querySelectorAll(selector);
                console.log(`Selector ${selector} found ${elements.length} elements`);
                
                for (const element of elements) {
                    // Try to get branch name from different sources
                    const text = element.textContent?.trim();
                    const title = element.getAttribute("title");
                    
                    console.log("Checking element:", {
                        selector,
                        text,
                        title,
                        html: element.outerHTML
                    });
                    
                    if (title) {
                        branchElement = element;
                        branchName = title;
                        console.log("Found branch name from title:", branchName);
                        break;
                    } else if (text) {
                        branchElement = element;
                        branchName = text;
                        console.log("Found branch name from text:", branchName);
                        break;
                    }
                }
                
                if (branchName) break;
            }
        }

        if (!branchName) {
            console.error("Could not find branch name after all attempts");
            return;
        }

        // Extract task name from branch name
        const taskName = extractTaskName(branchName);
        if (!taskName) {
            console.log("Could not extract task name from branch:", branchName);
            return;
        }
        console.log("Extracted task name:", taskName);

        // Add unified PR view to the page
        addUnifiedPRView(taskName);
    } catch (error) {
        console.error("Error initializing PR view:", error);
    }
}

// Watch for URL changes
let lastUrl = window.location.href;
new MutationObserver(() => { // This observer watches for changes in the DOM
    const url = window.location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        initializePRView();
    }
}).observe(document, { subtree: true, childList: true });

// Run on initial page load
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializePRView);
} else {
    initializePRView();
}

// TODO: Make this more robust and configurable. Make sure it matches the backend's task name format.
function extractTaskName(branchName) {
    const patterns = [
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/([A-Z]+-\d+)/i, // JIRA-style with more prefixes
        /^(feature|bug|bugfix|hotfix|fix|chore|task)\/(\d+)/i, // Numeric with more prefixes
        /^([A-Z]+-\d+)/ // Just ticket number
    ];
    
    for (const pattern of patterns) {
        const match = branchName.match(pattern);
        if (match) {
            return match[2] || match[1];
        }
    }
    return null;
}

// Add a helper function for proxied fetch requests from the background script.
function proxyFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "PROXY_FETCH",
            url: url,
            options: options
        }, response => {
            if (chrome.runtime.lastError) {
                console.error("Error in proxyFetch runtime:", chrome.runtime.lastError);
                return reject(new Error(chrome.runtime.lastError.message));
            }
            
            if (response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response.error || "Unknown error in proxy fetch"));
            }
        });
    });
}

// Function to add the unified PR view (injected) into the page.
async function addUnifiedPRView(taskName) {
    try {
        console.log("Starting to add unified PR view for task:", taskName);
        
        const { backendUrl, repoUrls, gitlabToken, username } = await chrome.storage.sync.get(["backendUrl", "repoUrls", "gitlabToken", "username"]);
        
        if (!backendUrl || !repoUrls || !gitlabToken || !username) {
            console.error("Missing required settings");
            return;
        }

        const urls = repoUrls.split("\n")
            .filter(url => url.trim())
            .map(url => encodeURIComponent(url));
        
        const queryString = urls.map(url => `repo_urls=${url}`).join("&");
        // Include username for the backend to determine 'user_has_approved'
        const apiUrl = `${backendUrl}/api/prs/unified?${queryString}&username=${encodeURIComponent(username)}`;
        
        console.log("Fetching unified PRs using proxy from:", apiUrl);
        const rawUnifiedPRs = await proxyFetch(apiUrl, {
            headers: {
                "x-gitlab-token": gitlabToken
            }
        });
        console.log("Received unified PRs data:", rawUnifiedPRs);
        
        // Add more detailed logging to inspect PR data structure
        if (Array.isArray(rawUnifiedPRs)) {
            rawUnifiedPRs.forEach((task, i) => {
                console.log(`Task ${i} (${task.task_name}) data:`, task);
                if (task.prs && task.prs.length > 0) {
                    console.log(`First PR in task ${task.task_name}:`, task.prs[0]);
                    console.log(`Approval status field exists: ${task.prs[0].hasOwnProperty("user_has_approved")}`);
                }
            });
        }
        
        // Check if rawUnifiedPRs is an array, if not wrap it in an array
        const unifiedPRsArray = Array.isArray(rawUnifiedPRs) ? rawUnifiedPRs : [rawUnifiedPRs];
        
        // Deduplicate PRs within each task based on web_url - this step might be redundant if backend handles it,
        // but could be good for client-side robustness if multiple identical PRs were somehow returned for a task.
        const dedupedUnifiedPRs = unifiedPRsArray.map(task => {
            const uniquePRs = [];
            const seenUrls = new Set();
            if (task.prs) {
                for (const pr of task.prs) {
                    if (!seenUrls.has(pr.web_url)) {
                        seenUrls.add(pr.web_url);
                        uniquePRs.push(pr);
                    }
                }
            }
            return {
                ...task,
                prs: uniquePRs
            };
        });
        
        const taskData = dedupedUnifiedPRs.find(task => task.task_name === taskName);
        if (!taskData || !taskData.prs || taskData.prs.length === 0) {
            console.warn("No PRs found for task:", taskName, "after processing server response.");
             const existingView = document.querySelector(".unified-pr-view");
            if (existingView) existingView.remove(); // Remove old view if any
            return;
        }

        console.log("Found matching task with PRs:", taskData);

        // Data from the backend already contains approval and pipeline status per PR
        // The `isApproved` field for the view now comes from `pr.user_has_approved` or `pr.approved_by_user`
        const taskWithStatus = {
            ...taskData,
            prs: taskData.prs.map(pr => {
                // Use the approval status from the backend response
                // Check for different possible approval status field names from the API
                const approvalStatus = pr.user_has_approved !== undefined ? pr.user_has_approved : false;
                    
                return {
                    ...pr,
                    isApproved: approvalStatus
                };
            })
        };
        
        console.log("Task with mapped status:", taskWithStatus);
        
        const unifiedView = createUnifiedView(taskWithStatus);
        await injectUnifiedView(unifiedView);
        console.log("Unified view successfully injected");

        // Setup periodic refresh
        // Clear previous interval if one already exists to avoid multiple intervals running
        if (window.unifiedPRViewRefreshInterval) {
            clearInterval(window.unifiedPRViewRefreshInterval);
        }
        window.unifiedPRViewRefreshInterval = setInterval(async () => {
            try {
                console.log("Refreshing unified PR view for task:", taskName);
                // Re-fetch data and update the view for the current task
                const freshRawUnifiedPRs = await proxyFetch(apiUrl, {
                    headers: {
                        "x-gitlab-token": gitlabToken
                    }
                }); // apiUrl already includes username
                
                // Check if freshRawUnifiedPRs is an array, if not wrap it in an array
                const freshUnifiedPRsArray = Array.isArray(freshRawUnifiedPRs) ? freshRawUnifiedPRs : [freshRawUnifiedPRs];
                
                const freshDedupedUnifiedPRs = freshUnifiedPRsArray.map(task => {
                    const uniquePRs = [];
                    const seenUrls = new Set();
                    if (task.prs) {
                        for (const pr of task.prs) {
                            if (!seenUrls.has(pr.web_url)) {
                                seenUrls.add(pr.web_url);
                                uniquePRs.push(pr);
                            }
                        }
                    }
                    return { ...task, prs: uniquePRs };
                });

                // Find the task with the matching task name from the deduplicated list.
                const freshTaskData = freshDedupedUnifiedPRs.find(task => task.task_name === taskName);
                
                // If the task data is found and has PRs, create a new view with the updated data.
                if (freshTaskData && freshTaskData.prs && freshTaskData.prs.length > 0) {
                    const freshTaskWithStatus = {
                        ...freshTaskData,
                        prs: freshTaskData.prs.map(pr => {
                            // Use the approval status from the backend response
                            // Check for different possible approval status field names from the API
                            const approvalStatus = pr.user_has_approved !== undefined ? pr.user_has_approved : false;
                                
                            return {
                                ...pr,
                                isApproved: approvalStatus
                            };
                        })
                    };
                    const updatedView = createUnifiedView(freshTaskWithStatus);
                    const existingView = document.querySelector(".unified-pr-view");
                    if (existingView) {
                        existingView.replaceWith(updatedView);
                        console.log("Unified view refreshed successfully");
                    } else {
                        // If view was removed (user navigated away and came back, or initial load failed partway) try to inject it again.
                        await injectUnifiedView(updatedView);
                    }
                } else { // No data for task during refresh, view not updated or may be removed.
                    console.log("No data for task during refresh, view not updated or may be removed.");
                     const existingView = document.querySelector(".unified-pr-view");
                     if (existingView) {
                         existingView.innerHTML = "<p>Related PRs for this task may have been merged or closed. Refreshing...</p>"; 
                     }
                }
            } catch (error) {
                console.error("Error during periodic refresh:", error);
            }
        }, 60000); // Refresh every 60 seconds

    } catch (error) {
        console.error("Error adding unified PR view:", error);
    }
}

// Function to get pipeline status emoji to display in the PR view.
function getPipelineStatusEmoji(status) {
    if (!status) return "<span class=\"pipeline-status no-pipeline\">No pipelines</span>";
    
    // Using Unicode symbols instead of material icons
    switch (status) {
        case "success":
            return "<span class=\"pipeline-status success\">✅ Pipeline succeeded</span>";
        case "failed":
            return "<span class=\"pipeline-status failed\">❌ Pipeline failed</span>";
        case "running":
        case "pending":
            return "<span class=\"pipeline-status running\">⏳ Pipeline running</span>";
        default:
            return "<span class=\"pipeline-status unknown\">❓ " + status + "</span>";
    }
}

// Function to create the unified PR view (UI).
function createUnifiedView(taskPRs) {
    const container = document.createElement("div");
    container.className = "unified-pr-view";
    
    // Create header
    const header = document.createElement("div");
    header.className = "unified-pr-header";
    header.innerHTML = `
        <h3>Related Merge Requests</h3>
        <div class="task-name">Task: ${taskPRs.task_name}</div>
        <button class="refresh-view-btn">🔄 Refresh</button>
    `;
    
    // Add event listener for refresh button
    setTimeout(() => {
        const refreshBtn = container.querySelector(".refresh-view-btn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", async () => {
                console.log("Manual refresh triggered");
                // Refresh the view
                await addUnifiedPRView(taskPRs.task_name);
            });
        }
    }, 0);
    
    container.appendChild(header);

    // Create PR list
    const prList = document.createElement("div");
    prList.className = "unified-pr-list";
    
    // Check if all PRs are approved
    const allApproved = taskPRs.prs.every(pr => pr.isApproved);

    // Add PR items
    taskPRs.prs.forEach(pr => {
        const prItem = document.createElement("div");
        prItem.className = `pr-item ${pr.isApproved ? "approved" : ""}`;
        prItem.innerHTML = `
            <a href="${pr.web_url}" target="_blank">${pr.repository_name} #${pr.iid}</a>
            <div class="status-badges">
                ${getPipelineStatusEmoji(pr.pipeline_status)}
                ${pr.isApproved ? 
                    "<span class=\"approval-status\">Approved</span>" : 
                    "<span class=\"approval-status pending\">Not approved</span>"
                }
            </div>
        `;
        prList.appendChild(prItem);
    });
    
    container.appendChild(prList);

    // Add approve button only if there are PRs to approve
    if (!allApproved) {
        const approveButton = document.createElement("button");
        approveButton.className = "approve-all-btn";
        approveButton.textContent = "Approve All";
        approveButton.onclick = () => approveAllPRs(taskPRs.task_name);
        container.appendChild(approveButton);
    } else {
        const approvedStatus = document.createElement("div");
        approvedStatus.className = "status approved";
        approvedStatus.textContent = "All PRs Approved";
        container.appendChild(approvedStatus);
    }

    return container;
}

async function injectUnifiedView(view) {
    // Try multiple possible injection points
    const injectionPoints = [
        ".merge-request-description",
        ".detail-page-description",
        "[data-testid=\"merge-request-description\"]",
        ".merge-request-details",
        ".merge-request-info",
        ".mr-widget-content",
        ".mr-widget-section",
        ".description"
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
        console.error("Could not find injection point");
        return;
    }

    // Remove existing unified view if present
    const existingView = document.querySelector(".unified-pr-view");
    if (existingView) {
        existingView.remove();
    }

    // Insert the unified view after the injection point
    injectionPoint.parentNode.insertBefore(view, injectionPoint.nextSibling);
}

async function approveAllPRs(taskName) {
    try {
        const { backendUrl, repoUrls, gitlabToken } = await chrome.storage.sync.get(["backendUrl", "repoUrls", "gitlabToken"]);
        
        if (!backendUrl || !repoUrls || !gitlabToken) {
            console.error("Missing required settings");
            return;
        }

        const urls = repoUrls.split("\n").filter(url => url.trim());
        
        // Use proxy fetch for approval
        const approveResponse = await proxyFetch(`${backendUrl}/api/prs/approve?task_name=${encodeURIComponent(taskName)}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gitlab-token": gitlabToken
            },
            body: JSON.stringify({
                repo_urls: urls
            })
        });
        
        console.log("Approve response:", approveResponse);

        // Show success message
        const unifiedView = document.querySelector(".unified-pr-view");
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
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Instead of reloading the page, update the view with new data
        const queryString = urls.map(url => `repo_urls=${encodeURIComponent(url)}`).join("&");
        try {
            const unifiedPRs = await proxyFetch(`${backendUrl}/api/prs/unified?${queryString}`, {
                headers: {
                    "x-gitlab-token": gitlabToken
                }
            });
            const taskPRs = unifiedPRs.find(task => task.task_name === taskName);
            
            if (taskPRs) {
                // Check approval status for each PR and pipeline status if needed
                const prsWithStatus = await Promise.all(taskPRs.prs.map(async (pr) => {
                    // Use the approval status from the backend response
                    // Check for different possible approval status field names from the API
                    const approvalStatus = pr.user_has_approved !== undefined ? pr.user_has_approved : false;
                    
                    // Check pipeline status if not available
                    let pipelineStatus = pr.pipeline_status;
                    if (!pipelineStatus) {
                        pipelineStatus = pr.pipeline_status; // Just use what we already have
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
        } catch (error) {
            console.error("Error refreshing PRs after approval:", error);
            if (unifiedView) {
                unifiedView.innerHTML += `
                    <div class="unified-pr-message warning">
                        PRs were approved, but there was an error refreshing the view. Please reload the page.
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error("Error approving PRs:", error);
        const unifiedView = document.querySelector(".unified-pr-view");
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

// Ensure the CSS file is loaded
function loadCSS(path) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = chrome.runtime.getURL(path);
    document.head.appendChild(link);
}

// Load the external CSS file
loadCSS("content/content.css");