import os
import subprocess
import logging
import tempfile
import shutil
from typing import List, Dict, Tuple
from ..models.pr import VirtualWorkspaceResponse

logger = logging.getLogger(__name__)

class WorkspaceService:
    def __init__(self, workspace_root: str = None):
        """Initialize the workspace service.
        
        Args:
            workspace_root: Root directory for storing virtual workspaces
        """
        self.workspace_root = workspace_root or os.path.join(tempfile.gettempdir(), "virtual_workspaces")
        os.makedirs(self.workspace_root, exist_ok=True)
        logger.info(f"Workspace root initialized at: {self.workspace_root}")
    
    def _run_git_command(self, cmd: List[str], cwd: str = None) -> Tuple[bool, str]:
        """Run a git command and return the result."""
        try:
            result = subprocess.run(
                cmd, 
                cwd=cwd,
                capture_output=True,
                text=True,
                check=True
            )
            return True, result.stdout.strip()
        except subprocess.CalledProcessError as e:
            error_msg = f"Git command failed: {e.stderr}"
            logger.error(error_msg)
            return False, error_msg
    
    def create_virtual_workspace(self, branch_name: str, task_name: str, repo_urls: List[str], workspace_name: str = None, script_content: str = None) -> VirtualWorkspaceResponse:
        """Create a virtual workspace by aggregating multiple repositories as submodules.
        
        Args:
            branch_name: The name of the branch to create
            task_name: The task associated with this workspace
            repo_urls: List of repository URLs to add as submodules
            workspace_name: Optional custom name for the workspace
            script_content: Optional content for the commit-submodules.sh script
            
        Returns:
            VirtualWorkspaceResponse with status and clone command
        """
        if not repo_urls:
            return VirtualWorkspaceResponse(
                status="error",
                message="No repositories provided"
            )
        
        # Use workspace_name if provided, otherwise fall back to task_name
        if workspace_name:
            safe_name = workspace_name.replace('/', '_').replace(' ', '_')
        else:
            safe_name = task_name.replace('/', '_').replace(' ', '_')
            
        workspace_dir = os.path.join(self.workspace_root, safe_name)
        
        # Check if workspace directory already exists, remove if it does
        if os.path.exists(workspace_dir):
            try:
                shutil.rmtree(workspace_dir)
                logger.info(f"Removed existing workspace directory: {workspace_dir}")
            except Exception as e:
                logger.error(f"Failed to remove existing workspace: {str(e)}")
                return VirtualWorkspaceResponse(
                    status="error",
                    message=f"Failed to remove existing workspace: {str(e)}"
                )
        
        # Create workspace directory
        try:
            os.makedirs(workspace_dir)
        except Exception as e:
            logger.error(f"Failed to create workspace directory: {str(e)}")
            return VirtualWorkspaceResponse(
                status="error",
                message=f"Failed to create workspace directory: {str(e)}"
            )
        
        # Initialize git repository
        success, output = self._run_git_command(["git", "init"], cwd=workspace_dir)
        if not success:
            return VirtualWorkspaceResponse(
                status="error",
                message=f"Failed to initialize git repository: {output}"
            )
        
        # Create and checkout branch
        success, output = self._run_git_command(["git", "checkout", "-b", branch_name], cwd=workspace_dir)
        if not success:
            return VirtualWorkspaceResponse(
                status="error",
                message=f"Failed to create branch: {output}"
            )
        
        # Add each repo as a submodule
        for repo_url in repo_urls:
            # Extract repo name from URL
            repo_name = repo_url.split("/")[-1].replace(".git", "")
            
            success, output = self._run_git_command(
                ["git", "submodule", "add", repo_url, repo_name], 
                cwd=workspace_dir
            )
            if not success:
                return VirtualWorkspaceResponse(
                    status="error",
                    message=f"Failed to add submodule for {repo_url}: {output}"
                )
            
            logger.info(f"Added submodule {repo_name} from {repo_url}")
        
        # Create a README with information about the workspace
        readme_content = f"# Virtual Workspace for {task_name}\n\n"
        readme_content += f"Branch: {branch_name}\n\n"
        readme_content += "## Included Repositories\n\n"
        for repo_url in repo_urls:
            repo_name = repo_url.split("/")[-1].replace(".git", "")
            readme_content += f"- [{repo_name}]({repo_url})\n"
        
        readme_path = os.path.join(workspace_dir, "README.md")
        with open(readme_path, "w") as f:
            f.write(readme_content)
        
        # Create the commit-submodules.sh script if content is provided
        if script_content:
            script_path = os.path.join(workspace_dir, "commit-submodules.sh")
            with open(script_path, "w") as f:
                f.write(script_content)
            
            # Make the script executable
            os.chmod(script_path, 0o755)
            logger.info(f"Created commit-submodules.sh script in workspace")
        
        # Commit the changes
        success, _ = self._run_git_command(["git", "add", "."], cwd=workspace_dir)
        if not success:
            return VirtualWorkspaceResponse(
                status="error",
                message="Failed to stage files for commit"
            )
        
        success, _ = self._run_git_command(
            ["git", "commit", "-m", f"Create virtual workspace for {task_name}"], 
            cwd=workspace_dir
        )
        if not success:
            return VirtualWorkspaceResponse(
                status="error",
                message="Failed to commit changes"
            )
        
        # Generate clone command
        clone_url = workspace_dir
        clone_command = f"git clone {workspace_dir}"
        
        return VirtualWorkspaceResponse(
            status="success",
            message=f"Virtual workspace created successfully for {task_name}",
            clone_url=clone_url,
            clone_command=clone_command
        ) 