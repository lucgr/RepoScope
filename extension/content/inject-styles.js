// Inject Material Icons CSS
function injectMaterialIcons() {
    if (!document.querySelector("link[href*=\"fonts.googleapis.com/icon\"]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
        document.head.appendChild(link);
    }
}

// Execute script
injectMaterialIcons(); 