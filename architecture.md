# MultiRepoHub Architecture Diagram

```mermaid
flowchart TD
    %% STYLING
    classDef userBrowser fill:#ffe6cc,stroke:#d79b00,stroke-width:2px
    classDef frontendCore fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px
    classDef frontendUI fill:#d4e1f5,stroke:#6c8ebf,stroke-width:1px
    classDef backendCore fill:#d5e8d4,stroke:#82b366,stroke-width:2px
    classDef backendServices fill:#e1f5e1,stroke:#82b366,stroke-width:1px
    classDef external fill:#f8cecc,stroke:#b85450,stroke-width:2px
    
    %% USER & BROWSER
    User[User / Developer]:::userBrowser
    Browser[Chrome Browser]:::userBrowser
    
    %% FRONTEND SECTION
    subgraph Frontend["Frontend (JavaScript/Chrome Extension)"]
        direction TB
        Extension["Chrome Extension<br>(manifest.json)"]:::frontendCore
        
        subgraph FrontendUI["User Interface"]
            direction LR
            Popup["Popup UI<br>(popup.html, popup.css, popup.js, core.js)"]:::frontendUI
            ContentScripts["GitLab Page Integration<br>(content/*.js)"]:::frontendUI
        end
        
        Background["Background Service<br>(background/*.js)"]:::frontendCore
    end
    
    %% FRONTEND MODULES
    PRModule["PR Module<br>(popup/pull-requests.js)"]:::frontendUI
    WSModule["Workspace Module<br>(popup/workspace.js)"]:::frontendUI
    RepoModule["Repository Module<br>(popup/repository.js)"]:::frontendUI
    
    %% BACKEND SECTION
    subgraph Backend["Backend (Python/FastAPI)"]
        direction TB
        FastAPI["FastAPI Server<br>(main.py, config.py)"]:::backendCore
        
        subgraph BackendAPI["API Endpoints"]
            direction LR
            PRRoutes["PR API Routes<br>(api/pr_routes.py)"]:::backendCore
            WorkspaceRoutes["Workspace API Routes<br>(api/workspace_routes.py)"]:::backendCore
        end
        
        subgraph BackendServices["Business Services"]
            PRService["PR Service<br>(services/pr_service.py)"]:::backendServices
            WorkspaceService["Workspace Service<br>(services/workspace_service.py)"]:::backendServices
        end
    end
    
    %% BACKEND MODELS
    Models["Data Models<br>(models/*.py)"]:::backendCore
    
    %% EXTERNAL SYSTEMS
    GitLabAPI[GitLab API]:::external
    Git[Git]:::external
    
    %% CONNECTIONS - USER TO FRONTEND
    User -->|Interacts with| Browser
    Browser -->|Hosts| Extension
    Extension -->|Displays| FrontendUI
    Extension -->|Runs| Background
    
    %% CONNECTIONS - FRONTEND MODULES
    Popup -->|Uses| PRModule & WSModule & RepoModule
    
    %% CONNECTIONS - FRONTEND TO BACKEND
    Background -->|API Requests| FastAPI
    ContentScripts -->|API Requests| FastAPI
    
    %% CONNECTIONS - BACKEND INTERNAL
    FastAPI -->|Routes to| BackendAPI
    PRRoutes -->|Uses| PRService
    WorkspaceRoutes -->|Uses| WorkspaceService
    PRService & WorkspaceService -->|Use| Models
    
    %% CONNECTIONS - BACKEND TO EXTERNAL
    WorkspaceService -->|Repository Operations| Git
    PRService -->|Fetches PR data from| GitLabAPI
```

## Architecture Components

### User Layer
- **User/Developer**: Person interacting with the system
- **Chrome Browser**: Environment where the extension runs

### Frontend (Chrome Extension - JavaScript)
- **Extension Core**: 
  - **manifest.json**: Extension manifest defining permissions and structure
- **User Interface**:
  - **Popup UI**: 
    - **popup.html**: HTML structure of the popup
    - **popup.css**: Styling for the popup UI
    - **popup.js**: Main popup controller
    - **core.js**: Core functionality shared across popup components
  - **GitLab Page Integration**: 
    - **content/*.js**: Scripts injected into GitLab pages
- **Background Service**:
  - **background/*.js**: Background scripts for persistent operations and API communication
- **Frontend Modules**:
  - **pull-requests.js**: Handles PR visualization and management
  - **workspace.js**: Manages virtual workspace creation and configuration
  - **repository.js**: Handles repository operations and metadata

### Backend (Python FastAPI)
- **FastAPI Server**: 
  - **main.py**: Main FastAPI application entry point
  - **config.py**: Configuration settings for the backend
- **API Endpoints**:
  - **api/pr_routes.py**: Endpoints for PR operations
  - **api/workspace_routes.py**: Endpoints for workspace management
- **Business Services**:
  - **services/pr_service.py**: Business logic for PR management
  - **services/workspace_service.py**: Business logic for workspace management and Git repository operations
- **Data Models**:
  - **models/*.py**: Data models representing PRs, workspaces, repositories, etc.

### External Integration
- **GitLab API**: External system for PR data, approvals, and pipelines
- **Git**: Version control system for repository operations

### Key Interactions
1. Users interact with the extension through the browser
2. Frontend modules provide specialized functionality to the popup UI
3. Frontend components communicate with the backend via API requests
4. Backend services process requests using data models
5. PR Service interacts with GitLab API for PR data
6. Workspace Service performs Git repository operations
7. Data flows back to the frontend for presentation to the user 
