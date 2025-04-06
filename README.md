# Unified PR Viewer

A browser extension that unifies Pull Request views across multiple repositories based on task names.

## Features
- View related PRs across different repositories in a unified interface
- Support for GitLab repositories
- Task-based PR grouping
- Cross-repository PR review

## Project Structure
```
.
├── backend/           # Python FastAPI backend
│   ├── api/          # API endpoints
│   ├── services/     # Business logic
│   └── models/       # Data models
├── extension/        # Browser extension
│   ├── manifest.json # Extension configuration
│   ├── popup/        # Extension popup UI
│   └── content/      # Content scripts
└── requirements.txt  # Python dependencies
```

## Setup Instructions

### Backend
1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file with your GitLab token:
   ```
   GITLAB_TOKEN=your_token_here
   ```

4. Run the backend server:
   ```bash
   uvicorn backend.main:app --reload
   ```

### Extension
1. Load the extension in your browser:
   - Chrome: Go to `chrome://extensions/`
   - Enable Developer mode
   - Click "Load unpacked" and select the `extension` directory

## Configuration
- Set your GitLab instance URL in the extension settings
- Configure which repositories to monitor
- Set up task name patterns for PR grouping