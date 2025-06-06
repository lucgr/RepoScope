from fastapi import APIRouter, HTTPException, Body, Header
from fastapi.responses import FileResponse, JSONResponse, Response
import logging
import os

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.post("/prepare")
async def prepare_workspace_command(
    request: dict = Body(...),
    x_gitlab_token: str = Header(None)
):
    """Prepare workspace configuration and return a command for local creation."""
    try:
        branch_name = request.get('branch_name')
        task_name = request.get('task_name')
        repo_urls = request.get('repo_urls', [])
        workspace_name = request.get('workspace_name')
        # script_content = request.get('script_content')
        
        if not x_gitlab_token:
            logger.warning("Missing GitLab token")
            raise HTTPException(status_code=401, detail="X-Gitlab-Token header is required.")

        if not branch_name or not task_name or not repo_urls:
            logger.warning(f"Missing required fields: branch={branch_name}, task={task_name}, repos={repo_urls}")
            raise HTTPException(status_code=400, detail="Missing required fields")
            
        logger.info(f"Preparing workspace configuration for branch {branch_name} with {len(repo_urls)} repositories")
        
        # Generate the command for the user to run
        safe_name = workspace_name or task_name
        safe_name = "".join(c for c in safe_name if c.isalnum() or c in ('-', '_')).rstrip()
        
        # Create a curl command that calls the backend to get a shell script and pipes it to bash
        import json
        
        payload = {
            "workspace_name": safe_name,
            "branch_name": branch_name,
            "task_name": task_name,
            "repo_urls": repo_urls,
            "use_custom_name": True,
            "use_workspace_name": True,
            "force_name_override": True
        }
        
        payload_json = json.dumps(payload)
        
        # Create a curl command that calls the backend and pipes the returned script to bash
        command = f'curl -X POST "http://localhost:8000/api/workspace/create-script" -H "Content-Type: application/json" -H "x-gitlab-token: {x_gitlab_token}" -d \'{payload_json}\' | bash'
        
        return JSONResponse({
            "status": "success",
            "workspace_name": safe_name,
            "command": command,
            "message": f"Workspace configuration prepared. Run the command below to create '{safe_name}' locally."
        })

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unhandled error in prepare_workspace_command endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected server error occurred: {str(e)}")

@router.post("/create-script")
async def create_workspace_script(
    request: dict = Body(...),
    x_gitlab_token: str = Header(None)
):
    """Return a shell script that creates the workspace directly where executed."""
    try:
        branch_name = request.get('branch_name')
        task_name = request.get('task_name')
        repo_urls = request.get('repo_urls', [])
        workspace_name = request.get('workspace_name')
        
        if not x_gitlab_token:
            raise HTTPException(status_code=401, detail="X-Gitlab-Token header is required.")

        if not branch_name or not task_name or not repo_urls:
            raise HTTPException(status_code=400, detail="Missing required fields")
            
        safe_name = workspace_name or task_name
        safe_name = "".join(c for c in safe_name if c.isalnum() or c in ('-', '_')).rstrip()
        
        # Generate gitmodules content
        gitmodules_content = ""
        for repo_url in repo_urls:
            repo_name = repo_url.split("/")[-1].replace(".git", "")
            gitmodules_content += f'[submodule "{repo_name}"]\\n\\tpath = {repo_name}\\n\\turl = {repo_url}\\n'
        
        # Create the shell script
        script = f"""#!/bin/bash
set -e

echo "Creating workspace: {safe_name}"

# Check if directory already exists
if [ -d "{safe_name}" ]; then
    echo "Error: Directory {safe_name} already exists"
    exit 1
fi

# Create workspace directory and navigate into it
mkdir {safe_name}
cd {safe_name}

# Initialize git repository
git init
git config user.name "MultiRepoHub Virtual Workspace"
git config user.email "noreply@multirepohub.local"

# Create and checkout branch
git checkout -b {branch_name}

# Create .gitmodules file
printf '{gitmodules_content}' > .gitmodules

# Create README.md file
cat > README.md << 'EOF'
# {safe_name}

This is a virtual workspace containing multiple repositories for branch `{branch_name}`.

## Included Repositories

{chr(10).join([f"- **{repo_url.split('/')[-1].replace('.git', '')}**: {repo_url}" for repo_url in repo_urls])}

## Getting Started

This workspace uses the multi-repo.sh script to manage multiple repositories.

### Available Commands

```bash
# Initialize all repositories (clone and checkout branch). 
# This is automatically done when loading the workspace from the backend.
./multi-repo.sh init

# Pull latest changes from all repositories
./multi-repo.sh pull

# Show status of all repositories
./multi-repo.sh status

# Create a new branch in all repositories
./multi-repo.sh branch <branch-name>

# Switch to a branch in all repositories
./multi-repo.sh checkout <branch-name>

# Add and commit changes in all repositories
./multi-repo.sh commit "<commit-message>"

# Push changes in all repositories
./multi-repo.sh push

# Create a PR in all repositories
./multi-repo.sh pr "PR title"
```

### Notes

- All repositories will be on the `{branch_name}` branch
- The multi-repo.sh script helps coordinate operations across all repositories
- Each repository maintains its own git history and can be worked with independently if needed

EOF

# Create empty directories for each repository
{chr(10).join([f'mkdir {repo_url.split("/")[-1].replace(".git", "")}' for repo_url in repo_urls])}

# Download multi-repo.sh script
curl -o multi-repo.sh http://localhost:8000/api/workspace/multi-repo-script
chmod +x multi-repo.sh

# Add files to git
git add .gitmodules README.md {" ".join([repo_url.split("/")[-1].replace(".git", "") for repo_url in repo_urls])} multi-repo.sh

# Initial commit
git commit -m "Initial workspace setup for {safe_name}"

echo ""
echo "Workspace '{safe_name}' created successfully!"
echo "Initializing repositories..."
echo ""

# Initialize the multi-repo setup
./multi-repo.sh init

echo ""
echo "Workspace '{safe_name}' is ready!"
echo ""
echo "Next steps:"
echo "1. cd {safe_name}"
echo "2. Start coding!"
"""
        
        return Response(content=script, media_type="text/plain")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unhandled error in create_workspace_script endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected server error occurred: {str(e)}")

@router.get("/multi-repo-script")
async def get_multi_repo_script():
    """Serve the multi-repo.sh script for download."""
    script_path = os.path.join(os.path.dirname(__file__), "../templates/multi-repo.sh")
    if os.path.exists(script_path):
        return FileResponse(script_path, media_type='text/plain', filename='multi-repo.sh')
    else:
        raise HTTPException(status_code=404, detail="multi-repo.sh script not found")