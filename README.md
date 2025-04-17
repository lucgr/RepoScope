# MultiRepoHub: Unified PR Viewer Extension

A Chrome extension for viewing and managing related Pull Requests across multiple GitLab repositories, streamlining development workflows for multi-repository architecture systems.

## Overview

MultiRepoHub solves the challenge of managing code changes across multiple repositories by providing a unified interface for tracking, approving, and monitoring related Pull Requests. It integrates directly into GitLab's UI and provides powerful virtual workspace capabilities for multi-repository development.

## Key Features

- **Unified PR Management**: View all related PRs across repositories in a single interface
- **Bulk Approval**: Approve multiple related PRs with a single click
- **Pipeline Monitoring**: Track CI/CD pipeline status for all related PRs
- **Virtual Workspaces**: Create unified working environments that combine multiple repositories
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

## Detailed Usage Guide

### Initial Setup

1. **Install the Extension**:
   - Install from the Chrome Web Store or load unpacked for development
   - Click the extension icon to open the popup interface

2. **Configure Settings**:
   - Navigate to the Settings tab in the extension popup
   - Enter your GitLab API token (requires API access)
   - Specify the backend URL (default: http://localhost:8000)
   - Add repositories to track (one URL per line)
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
   - Enter a workspace name (used for the local repository)
   - Specify a branch name (will be created in all repositories)
   - The task name is automatically extracted from the branch name
   - Select the repositories to include in the workspace
   - Click "Create Virtual Workspace"
   - Once created, use the provided clone command to get a local copy

2. **Using the Workspace**:
   - After cloning, navigate to the workspace directory
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
   - Previously created workspaces are stored in the Workspace History section
   - Easily clone previously created workspaces without recreating them

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
- **Creation Result**: Clone command and success/error messages
- **Workspace History**: List of previously created workspaces with clone commands

#### Injected GitLab View
- **Related PRs Section**: Appears on merge request pages showing related PRs
- **Approval Badges**: Visual indicators of approval status for each PR
- **Pipeline Status**: Current CI/CD status for each related PR
- **Bulk Actions**: Button to approve all related PRs simultaneously

## Backend Setup

The extension requires a backend server to fetch and unify PR data:

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn backend.main:app --reload
```

## Use Cases

### Development Team Use Cases

1. **Feature Development Across Services**:
   - Create a unified workspace containing all affected repositories
   - Make coordinated changes across multiple services
   - Submit and track all related PRs from a single interface

2. **Code Review Streamlining**:
   - Reviewers see all related changes in one place
   - Approve multiple PRs with a single action
   - Ensure consistent review standards across repositories

3. **Release Coordination**:
   - Track the status of all PRs related to a release
   - Ensure all changes are merged before deployment
   - Monitor pipeline status across all affected repositories

### DevOps Team Use Cases

1. **CI/CD Pipeline Monitoring**:
   - View build and test status across multiple repositories
   - Quickly identify failing pipelines related to a task
   - Coordinate fixes across multiple repositories

2. **Deployment Readiness Checks**:
   - Verify all related PRs are approved and merged
   - Ensure all pipelines are passing before deployment
   - Coordinate synchronized releases of interdependent components

### Product Team Use Cases

1. **Feature Completion Tracking**:
   - Monitor the progress of features spanning multiple repositories
   - Verify all components of a feature are ready for release
   - Coordinate stakeholder reviews of related changes

## Technical Details

This extension uses:
- Vanilla JavaScript for the extension frontend
- FastAPI and Python for the backend
- GitLab API for fetching and managing PRs
- Git submodules for virtual workspace management

## Behind the Scenes

1. **PR Unification Logic**:
   - Extracts task identifiers from branch names using regex patterns
   - Groups PRs by task name across repositories
   - Calculates consolidated status and statistics for each task

2. **Virtual Workspace Creation**:
   - Creates a parent Git repository
   - Adds each selected repository as a Git submodule
   - Generates helper scripts for multi-repository operations
   - Handles branch creation and checkout across all submodules

3. **Content Script Injection**:
   - Detects GitLab merge request pages
   - Identifies the current PR's task name
   - Fetches related PRs from the backend
   - Injects the unified view into the GitLab UI
   - Periodically refreshes approval and pipeline status

## License

MIT