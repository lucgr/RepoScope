// --- extension_client.js ---
// Client-side JavaScript for browser extension to interact with the dependency checker API

/**
 * Fetches the dependency discrepancy report from your backend.
 * @param {Array<Object>} projects - An array of project objects.
 *   Each object should be like: { id: "string", type: "go" | "python", content: "file_content_string" }
 * @returns {Promise<Object>} A promise that resolves to the API response (parsed JSON)
 *                            or an object with an error key if the request fails.
 */
async function checkProjectDependencies(projects) {
    // IMPORTANT: Replace with your actual backend API URL
    // For local development with FastAPI default, it's often http://localhost:8000
    const backendApiUrl = 'http://localhost:8000/api/dependencies/check'; 
    // Or, if deployed: const backendApiUrl = 'https://your-backend-domain.com/api/dependencies/check';

    console.log("Sending request to backend:", backendApiUrl, "with projects:", projects);

    try {
        const response = await fetch(backendApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add any other necessary headers, like authentication tokens if your API requires them
                // 'Authorization': 'Bearer YOUR_ACCESS_TOKEN', 
            },
            body: JSON.stringify({ projects: projects }), // Match the DependencyCheckRequest model
        });

        if (!response.ok) {
            let errorDetail = 'Failed to fetch dependency report.';
            try {
                const errorData = await response.json();
                errorDetail = errorData.detail || errorData.error || JSON.stringify(errorData);
            } catch (e) {
                errorDetail = `API request failed with status ${response.status}. Response not JSON.`;
            }
            console.error('API Error:', response.status, errorDetail);
            return { 
                discrepancies: [], 
                errors: [{ project_id: 'API_REQUEST', type: 'unknown', error: errorDetail }] 
            };
        }

        const results = await response.json(); // This will be DependencyCheckResponse
        console.log("Received results from backend:", results);
        return results;

    } catch (error) {
        console.error('Network or other error calling the backend:', error);
        return { 
            discrepancies: [], 
            errors: [{ project_id: 'NETWORK_REQUEST', type: 'unknown', error: `Network error: ${error.message}` }]
        };
    }
}

/**
 * Placeholder function: Implement this based on your extension's "virtual workspace" APIs.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of project objects.
 */
async function getProjectDataFromVirtualWorkspace() {
    console.log("Attempting to gather project data from the virtual workspace...");
    let projects = [];

    // ======================================================================
    // START: ### YOUR EXTENSION-SPECIFIC IMPLEMENTATION REQUIRED HERE ###
    // This section needs to be replaced with your extension's actual logic
    // for accessing file contents from its virtual workspace.
    // ======================================================================
    try {
        // --- Hypothetical Example: Using a browser extension API (e.g., chrome.storage or a custom one) ---
        // const workspaceFiles = await chrome.runtime.sendMessage({ type: "GET_WORKSPACE_FILES" });
        // for (const file of workspaceFiles) {
        //     if (file.name === 'go.mod') {
        //         projects.push({ id: file.projectId || 'unknown-go-project', type: 'go', content: file.content });
        //     } else if (file.name === 'requirements.txt') {
        //         projects.push({ id: file.projectId || 'unknown-python-project', type: 'python', content: file.content });
        //     }
        // }

        // --- Fallback to Manual/Example data for testing if no live data source is implemented yet ---
        console.warn("Using placeholder data for getProjectDataFromVirtualWorkspace. Implement actual data fetching!");
        const goProjectContent = 
`module my-go-project

go 1.20

require (
  github.com/gin-gonic/gin v1.9.0
  example.com/another/dep v1.2.3
  golang.org/x/text v0.13.0 // indirect
)`
        ;
        const pythonProjectContent1 = 
`fastapi==0.103.2
uvicorn[standard]==0.23.2
example.com/another/dep==1.2.4
requests==2.31.0`
        ;
        const pythonProjectContent2 = 
`requests==2.28.1
aiohttp==3.8.5
example.com/another/dep==1.2.5` // Different version for testing
        ;

        projects.push({ id: "sample-go-project", type: "go", content: goProjectContent });
        projects.push({ id: "sample-python-project-1", type: "python", content: pythonProjectContent1 });
        projects.push({ id: "sample-python-project-2", type: "python", content: pythonProjectContent2 });
        
    } catch (e) {
        console.error("Error getting project data from virtual workspace:", e);
        // Update UI or notify user appropriately
        alert("Error fetching project data from virtual workspace: " + e.message);
    }
    // ======================================================================
    // END: ### YOUR EXTENSION-SPECIFIC IMPLEMENTATION REQUIRED HERE ###
    // ======================================================================
    
    console.log(`Found ${projects.length} projects to analyze from virtual workspace.`);
    return projects.filter(p => p.content && p.content.trim() !== ""); // Ensure content is not empty
}

/**
 * Placeholder function: Implement this to display the results in your extension's UI.
 * @param {Object} reportData - The data returned from checkProjectDependencies.
 */
function displayDependencyReport(reportData) {
    console.log("\n--- Dependency Discrepancy Report (Extension UI) ---");

    // Example: Find a DOM element in your extension's popup or panel to show results
    const resultsContainer = document.getElementById('dependency-results-container');
    if (!resultsContainer) {
        console.warn("'dependency-results-container' DOM element not found. Cannot display report in UI.");
        // Fallback to console logging if UI element isn't found
        console.log("Report Data:", JSON.stringify(reportData, null, 2));
        return;
    }

    resultsContainer.innerHTML = ''; // Clear previous results

    if (reportData.discrepancies && reportData.discrepancies.length > 0) {
        const h3 = document.createElement('h3');
        h3.textContent = "Discrepancies Found:";
        resultsContainer.appendChild(h3);
        const ul = document.createElement('ul');
        reportData.discrepancies.forEach(discrepancy => {
            const li = document.createElement('li');
            li.innerHTML = `<strong>Dependency:</strong> ${discrepancy.dependency_name}`;
            const innerUl = document.createElement('ul');
            discrepancy.versions.forEach(vInfo => {
                const innerLi = document.createElement('li');
                innerLi.textContent = `Project: ${vInfo.project_id}, Version: ${vInfo.version}`;
                innerUl.appendChild(innerLi);
            });
            li.appendChild(innerUl);
            ul.appendChild(li);
        });
        resultsContainer.appendChild(ul);
    } else {
        const p = document.createElement('p');
        p.textContent = "No dependency version discrepancies found.";
        resultsContainer.appendChild(p);
    }

    if (reportData.errors && reportData.errors.length > 0) {
        const h3Errors = document.createElement('h3');
        h3Errors.style.marginTop = '20px';
        h3Errors.textContent = "Errors Encountered During Analysis:";
        resultsContainer.appendChild(h3Errors);
        const ulErrors = document.createElement('ul');
        reportData.errors.forEach(error => {
            const li = document.createElement('li');
            li.textContent = `Project: ${error.project_id} (Type: ${error.type || 'N/A'}) - Error: ${error.error}`;
            ulErrors.appendChild(li);
        });
        resultsContainer.appendChild(ulErrors);
    }
}


/**
 * Main function to orchestrate the dependency check process.
 * This might be called when the user clicks a button in your extension's UI.
 */
async function handleDependencyCheckRequest() {
    console.log("User requested dependency check. Starting process...");
    
    // Show some loading state in UI if possible
    const resultsContainer = document.getElementById('dependency-results-container');
    if (resultsContainer) resultsContainer.innerHTML = '<p>Loading dependency report...</p>';

    // 1. Get project data (file contents) from the virtual workspace
    const projectsToAnalyze = await getProjectDataFromVirtualWorkspace();

    if (!projectsToAnalyze || projectsToAnalyze.length === 0) {
        console.log("No projects found or file content could not be read after filtering.");
        displayDependencyReport({ 
            discrepancies: [], 
            errors: [{ project_id: 'SETUP', type: 'unknown', error: 'No projects with valid content found to analyze.' }]
        });
        return;
    }

    // 2. Call your backend API
    console.log("Calling backend API with project data...");
    const report = await checkProjectDependencies(projectsToAnalyze);

    // 3. Display the report in your extension's UI
    console.log("Displaying report in UI...");
    displayDependencyReport(report);
}

// --- Setup Example ---
// This demonstrates how you might hook this up. 
// You'll need to adapt this to your extension's specific structure (popup.js, background.js, content_script.js)

// Example: If your extension has a popup.html with a button and a results div:
/*
popup.html might contain:
<button id="checkDependenciesButton">Check Dependencies</button>
<div id="dependency-results-container"></div>
*/

// In your popup.js (or equivalent script for your extension's UI):
document.addEventListener('DOMContentLoaded', () => {
    const checkButton = document.getElementById('checkDependenciesButton');
    if (checkButton) {
        checkButton.addEventListener('click', handleDependencyCheckRequest);
    } else {
        console.warn("'checkDependenciesButton' not found. Cannot attach event listener.");
        // You might want to call handleDependencyCheckRequest automatically if no button
        // or if it's triggered by another event (e.g., workspace load)
        // For testing, you could call it directly:
        // handleDependencyCheckRequest(); 
    }
});

// For quick testing in a browser console where you might not have the button:
// setTimeout(handleDependencyCheckRequest, 1000); // Uncomment to auto-run for testing

console.log("extension_client.js loaded. Waiting for user action or DOMContentLoaded."); 