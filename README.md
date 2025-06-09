# MultiRepoHub: Unified PR Viewer Extension

A Chrome extension for viewing and managing related Pull Requests across multiple GitLab repositories, streamlining development workflows for multi-repository architecture systems.

## Overview

MultiRepoHub solves the challenge of managing code changes across multiple repositories by providing a unified interface for tracking, approving, and monitoring related Pull Requests. It integrates directly into GitLab's UI and provides powerful virtual workspace capabilities for multi-repository development.

## Detailed Usage Guide

### Initial Setup

1. **Install the Extension**:
   - Install from the Chrome Web Store or load unpacked for development
   - Click the extension icon to open the popup interface

2. **Configure Settings**:
   - Navigate to the Settings tab in the extension popup
   - Enter your GitLab API token (requires API access). This token is stored securely in your browser and sent to the backend with each request to authorize GitLab operations.
   - Specify the backend URL (default: http://localhost:8000, or the deployed instance like the public Cloud Run option below).
   - Add repositories to track
   - All settings are saved automatically and securely in your browser

### Working with Virtual Workspaces

1. **Creating a Workspace**:
   - Navigate to the "Virtual Workspace" tab in the extension popup
   - Enter a workspace name (used for the local repository structure)
   - Specify a branch name (will be created in all repositories if they are cloned as part of a feature development flow later)
   - The task name is automatically extracted from the branch name
   - Select the repositories to include in the workspace
   - Click "Create Virtual Workspace"
   - Once processing is complete, a ZIP file containing the virtual workspace will be automatically downloaded by your browser. Extract this ZIP to get your workspace.

2. **Using the Workspace**:
   - After extracting the ZIP, navigate to the workspace directory in your IDE of choice
   - Create a `.env` file in this directory with the content `GITLAB_TOKEN=<your_personal_access_token>`. The scripts will use this token for GitLab API operations.
   - Use the provided multi-repo scripts to manage operations across all repositories:

```bash
# Initialize all submodules in the workspace
./multi-repo.sh init

# Commit changes across all repositories
./multi-repo.sh commit "Your commit message"

# Push changes to all repositories
./multi-repo.sh push

# Pull latest changes for all repositories
./multi-repo.sh pull

# Check status of all repositories
./multi-repo.sh status

# Create or checkout branches across all repositories
./multi-repo.sh branch <branch-name>
./multi-repo.sh checkout <branch-name>

# Create GitLab Merge Requests for all repositories with changes
./multi-repo.sh pr "title" -d "description" -b "target-branch"
```

3. **Workspace History**:
   - Previously created workspaces are listed in the Workspace History section.
   - You can re-download the ZIP for a previously defined workspace configuration by clicking its entry (note: this re-creates and re-zips the workspace on the backend).


## Backend Setup

The extension requires a backend server to fetch and unify PR data and create virtual workspaces.

**Option 1: Local Development Setup**

```bash
# Install dependencies (ideally in a virtual environment)
pip install -r backend/requirements.txt

# Run the server (Uvicorn will typically run on http://localhost:8000)
uvicorn backend.main:app --reload
```

**Option 2: Docker Setup (Recommended)**

```bash
# Build and run with port mapping (one command)
docker run -it -p 8000:8000 $(docker build -q .)

# Or alternatively, build and run separately
docker build -t multirepo-backend .
docker run -it -p 8000:8000 multirepo-backend
```

Make sure your extension's Backend URL setting points to `http://localhost:8000`.


## Technical Details

This extension uses:
- Vanilla JavaScript for the extension frontend
- FastAPI and Python for the backend
- GitLab API for fetching and managing PRs
- Git submodules for virtual workspace management
- Regex parsing for dependency file analysis

## Behind the Scenes

1. **PR Unification Logic**:
   - Extracts task identifiers from branch names using regex patterns
   - Groups PRs by task name across repositories (branch names also supported)
   - Calculates consolidated status and basic statistics for each task
   - Uses the PAT from the extension for all GitLab API interactions.

2. **Virtual Workspace Creation**:
   - Creates a parent Git repository structure locally on the backend server.
   - Adds each selected repository as a Git submodule, using the PAT from the extension for private GitLab repositories.
   - Generates helper scripts for multi-repository operations.
   - Generates a curl command to download the workspace from your terminal (similarily to git clone) through the backend.

3. **Content Script Injection**:
   - Detects GitLab merge request pages
   - Identifies the current PR's task name
   - Fetches related PRs from the backend
   - Injects the unified view into the GitLab UI
   - Periodically refreshes approval and pipeline status

4. **Dependency Checking Logic**:
   - Clones selected repositories (with specific branches if requested)
   - Extracts dependency information from common dependency files
   - Compares versions across repositories to identify mismatches
   - Handles both Python (requirements.txt, setup.py) and Go (go.mod, go.sum) dependencies
   - Presents only the mismatched dependencies to avoid information overload

## License

MIT
