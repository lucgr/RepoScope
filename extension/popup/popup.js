// Import handler that loads all the needed scripts
console.log("Loading popup scripts at:", new Date().toISOString());

// Load scripts in order
document.addEventListener("DOMContentLoaded", function() {
    loadScript("core.js", function() {
        loadScript("repository.js", function() {
            loadScript("pull-requests.js", function() {
                loadScript("workspace.js", function() {
                    console.log("All scripts loaded successfully");
                    // Explicitly call initializePopup after all scripts are loaded to ensure all elements are available
                    if (typeof initializePopup === "function") {
                        initializePopup();
                    } else {
                        console.error("initializePopup function not found!");
                    }
                });
            });
        });
    });
});

// Helper function to load scripts in sequence
function loadScript(src, callback) {
    const script = document.createElement("script");
    script.src = src;
    script.onload = callback;
    script.onerror = function() {
        console.error("Failed to load script:", src);
    };
    document.head.appendChild(script);
}