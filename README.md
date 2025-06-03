# MultiRepoHub: Unified PR Viewer Extension

A Chrome extension for viewing and managing related Pull Requests across multiple GitLab repositories, streamlining development workflows for multi-repository architecture systems.

## Overview

MultiRepoHub solves the challenge of managing code changes across multiple repositories by providing a unified interface for tracking, approving, and monitoring related Pull Requests. It integrates directly into GitLab's UI and provides powerful virtual workspace capabilities for multi-repository development.

## Key Features

- **Unified PR Management**: View all related PRs across repositories in a single interface
- **Bulk Approval**: Approve multiple related PRs with a single click
- **Pipeline Monitoring**: Track CI/CD pipeline status for all related PRs
- **Virtual Workspaces**: Create unified working environments that combine multiple repositories
- **Cross-repo Dependency Checker**: Identify mismatched dependency versions across repositories
- **GitLab Integration**: Seamless integration with GitLab's merge request pages
- **Cross-Repository Commit & PR Creation**: Streamlined creation of consistent changes across multiple repositories
- **Support for Both GitLab and GitHub**: Flexible integration with major Git platforms

## Problem Solving

MultiRepoHub addresses several key challenges in modern software development:

1. **Microservices Complexity**: Simplifies the management of changes across microservice architectures
2. **Fragmented Reviews**: Consolidates the review process for related changes across repositories
3. **Inconsistent Branch Management**: Ensures consistent branch naming and management across repositories
4. **Multi-Repository Changes**: Streamlines the process of making coordinated changes across multiple repositories
5. **CI/CD Visibility**: Provides a unified view of pipeline status across related PRs
6. **Dependency Inconsistencies**: Detects version mismatches between common dependencies across repositories

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

### Viewing Unified PRs

1. **Through the Extension Popup**:
   - Click the extension icon to open the popup
   - Navigate to the "Unified PRs" tab
   - See all PRs grouped by task name, with approval and pipeline status
   - Click on any PR to open it in GitLab

2. **From GitLab's Interface**:
   - Open any merge request in GitLab
   - The extension automatically detects the task name from the branch
   - A unified view is injected into the page, showing all related PRs
   - Approval status and pipeline status are displayed for each PR
   - You can approve all related PRs directly from this view

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
   - After extracting the ZIP, navigate to the workspace directory
   - Use the provided multi-repo scripts to manage operations across all repositories:

```bash
# Initialize all submodules in the workspace
./multi-repo init

# Commit changes across all repositories
./multi-repo commit "Your commit message"

# Push changes to all repositories
./multi-repo push

# Pull latest changes for all repositories
./multi-repo pull

# Check status of all repositories
./multi-repo status

# Create or checkout branches across all repositories
./multi-repo branch <branch-name>
./multi-repo checkout <branch-name>

# Create pull requests for all repositories with changes
./multi-repo pr "Your PR title"
```

3. **Creating PRs Across Repositories**:
   - The `multi-repo pr` command streamlines the process of creating consistent PRs:
     - Prompts for a commit message (also used as PR description)
     - Asks for a target branch (defaults to main)
     - Offers to use a global branch name or keep individual branch names
     - Detects repository type (GitLab/GitHub) and formats PRs accordingly
     - Commits and pushes changes in all submodules
     - Creates pull requests for each repository with changes

4. **Workspace History**:
   - Previously created workspaces are listed in the Workspace History section.
   - You can re-download the ZIP for a previously defined workspace configuration by clicking its entry (note: this re-creates and re-zips the workspace on the backend).

### Using the Cross-repo Dependency Checker

1. **Accessing the Dependency Checker**:
   - Click the extension icon to open the popup
   - Navigate to the "Cross-repo Dependencies" tab
   - Select the repositories you want to compare

2. **Checking Dependencies**:
   - By default, the checker will compare dependency files from the main branches
   - Enable the "Show branch selection" option to specify different branches for each repository
   - Click "Check Dependencies" to analyze and compare dependency versions

3. **Understanding the Results**:
   - The tool displays only the dependencies with version mismatches
   - For Python projects, it checks requirements.txt and setup.py files
   - For Go projects, it analyzes go.mod and go.sum files
   - Results are organized by language (Python and Go)
   - Each mismatch shows which repositories use which versions

4. **Branch-Specific Comparisons**:
   - Specify different branches to compare feature branches against main
   - Compare dependencies across different feature branches
   - Check dependencies between repositories at specific versions or tags

5. **Use Cases**:
   - Detect inconsistent dependency versions before merging PRs
   - Verify that critical updates have been applied across all repositories
   - Identify outdated dependencies that need synchronization
   - Check compatibility between services during integration

### UI Elements and What They Display

#### Settings Tab
- **Backend URL Field**: Connection point to the backend server
- **GitLab Token Field**: Your personal access token for GitLab API access
- **Repository URLs Area**: List of repositories to track (one URL per line)
- **Status Messages**: Feedback on saved settings and validation results

#### Unified PRs Tab
- **Task Groups**: PRs grouped by task name extracted from branch names
- **PR Cards**: Individual PR information including:
  - PR title and repository name
  - Approval status (green if approved)
  - Pipeline status (success, failed, running, or pending)
  - Change count and comment count
- **Empty States**: Messages when no PRs are found or settings are incomplete

#### Virtual Workspace Tab
- **Workspace Form**: Fields to configure a new virtual workspace
- **Repository Selection**: Checkboxes for selecting repositories to include
- **Creation Result**: Status messages about the workspace creation and ZIP download.
- **Workspace History**: List of previously created workspace configurations, allowing re-download.

#### Injected GitLab View
- **Related PRs Section**: Appears on merge request pages showing related PRs
- **Approval Badges**: Visual indicators of approval status for each PR
- **Pipeline Status**: Current CI/CD status for each related PR
- **Bulk Actions**: Button to approve all related PRs simultaneously

#### Cross-repo Dependencies Tab
- **Repository Selection**: Checkboxes for selecting repositories to compare
- **Branch Selection**: Optional text fields to specify which branch to check for each repository
- **Results Display**: 
  - Python Dependencies: Mismatches in requirements.txt and setup.py files
  - Go Dependencies: Mismatches in go.mod and go.sum files
  - Version Information: Which versions are used by which repositories
  - Warning Messages: Any issues encountered when analyzing repositories

## Backend Setup

The extension requires a backend server to fetch and unify PR data and create virtual workspaces.

**Option 1: Local Setup**

```bash
# Navigate to the backend directory
cd backend

# Install dependencies (ideally in a virtual environment)
pip install -r requirements.txt

# Run the server (Uvicorn will typically run on http://localhost:8000)
uvicorn backend.main:app --reload
```
Make sure your extension's Backend URL setting points to `http://localhost:8000`.

**Option 2: Run through the deployed Cloud Run instance**

The backend is designed to be containerized and can be deployed to services like Google Cloud Run. A `Dockerfile` is provided in the root of the project.
A publicly accessible instance of the backend is available for demonstration or use (ensure you trust its operator if using with private repositories):
**Public Cloud Run URL:** [`https://multirepohub-backend-elmr3u3lwa-ez.a.run.app`](https://multirepohub-backend-elmr3u3lwa-ez.a.run.app)

If using a deployed backend, update the Backend URL in the extension settings accordingly.


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
   - Groups PRs by task name across repositories
   - Calculates consolidated status and statistics for each task
   - Uses the PAT from the extension for all GitLab API interactions.

2. **Virtual Workspace Creation**:
   - Creates a parent Git repository structure locally on the backend server.
   - Adds each selected repository as a Git submodule, using the PAT from the extension for private GitLab repositories.
   - Generates helper scripts for multi-repository operations.
   - Packages the resulting workspace into a ZIP file for download.
   - Cleans the PAT from `.gitmodules` before zipping to avoid exposing it in the downloaded archive.

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