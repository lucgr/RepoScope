# Unified PR Viewer

A browser extension that unifies Pull Request views across multiple GitLab repositories based on task names. This tool helps you manage related PRs across different repositories in a single view.

## Features

- **Unified PR View**: See all related PRs across different repositories in one place
- **Task-Based Grouping**: PRs are automatically grouped by their task name (extracted from branch names)
- **Cross-Repository Management**: 
  - View all PRs for a specific task across repositories
  - Approve all related PRs with a single click
- **Real-Time Updates**: View updates in both the extension popup and on individual PR pages
- **GitLab Token Validation**: Instant feedback on token validity with clear error messages
- **GitLab-Themed UI**: Seamless integration with GitLab's interface using matching colors and styles
- **Task Name Patterns**: Supports multiple branch naming patterns:
  - JIRA-style: `feature/ABC-123`, `bugfix/ABC-123`, `hotfix/ABC-123`
  - Numeric: `feature/123`, `bugfix/123`, `hotfix/123`
  - Ticket-only: `ABC-123`

## Project Structure

```
.
├── backend/           # Python FastAPI backend
│   ├── api/          # API endpoints
│   ├── services/     # Business logic
│   ├── models/       # Data models
│   └── config.py     # Configuration
├── extension/        # Browser extension
│   ├── manifest.json # Extension configuration
│   ├── popup/        # Extension popup UI
│   ├── content/      # Content scripts
│   └── background/   # Background scripts
└── requirements.txt  # Python dependencies
```

## Setup Instructions

### Backend Setup

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file with your GitLab configuration:
   ```
   GITLAB_TOKEN=your_personal_access_token
   GITLAB_URL=https://gitlab.com  # Change if using self-hosted GitLab
   ```

4. Run the backend server:
   ```bash
   uvicorn backend.main:app --reload
   ```

### Extension Setup

1. Load the extension in your browser:
   - Chrome: Go to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked" and select the `extension` directory

2. Configure the extension:
   - Click the extension icon to open the popup
   - Enter your backend URL (e.g., `http://localhost:8000`)
   - Enter your GitLab personal access token (will be validated automatically)
   - Add repository URLs (one per line) that you want to monitor

## Usage

### Viewing Unified PRs

1. **In the Extension Popup**:
   - Click the extension icon to see all related PRs across your configured repositories
   - PRs are grouped by task name
   - Each group shows:
     - Task name
     - Overall status
     - Links to individual PRs
     - PR approval status
     - Approve All button

2. **On Individual PR Pages**:
   - When viewing a PR, the extension automatically shows related PRs from other repositories
   - Related PRs appear below the PR description with GitLab-themed styling
   - You can see approval status and approve all related PRs directly from this view

### GitLab Token Validation

- The extension automatically validates your GitLab token when:
  - Loading the extension popup
  - Saving new settings
- If the token is invalid, clear error messages are shown with:
  - The specific error returned from GitLab
  - Warning indicators to prevent using invalid tokens
- Valid tokens display confirmation with your GitLab username for verification

### Approving PRs

1. Click the "Approve All" button in either:
   - The extension popup
   - The unified view on a PR page

2. The extension will:
   - Find all PRs with the same task name
   - Approve them across all repositories
   - Show a success message when complete

## Requirements

- Python 3.8+
- GitLab account with API access
- GitLab personal access token with `api` and `read_repository` scopes
- Chrome or compatible browser

## Troubleshooting

- **Invalid GitLab Token**: Check the error message in the extension popup and generate a new token with correct permissions
- **500 Internal Server Error**: Check your GitLab token permissions and repository access
- **No PRs Found**: Ensure your branch names follow the supported patterns
- **Approval Failed**: Verify you have permission to approve PRs in the repositories
- **Inconsistent Approval Status**: If approval status differs between popup and in-browser view, refresh the page or reopen the popup

## License

MIT License - See LICENSE file for details