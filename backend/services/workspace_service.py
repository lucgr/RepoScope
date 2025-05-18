import os
import subprocess
import logging
import tempfile
import shutil
from typing import List, Tuple, Dict, Any
from urllib.parse import urlparse, urlunparse
# from ..models.pr import VirtualWorkspaceResponse # This model might not be directly returned by this method anymore for success cases

logger = logging.getLogger(__name__)

class WorkspaceService:
    """Service for creating and managing the virtual monorepo workspaces."""

    def __init__(self, workspace_root: str = None):
        """Initialize the workspace service.
            - workspace_root: Root directory for storing virtual workspaces
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
            error_msg = f"Git command failed: {e.stderr.strip() if e.stderr else e.stdout.strip()}" 
            logger.error(error_msg)
            return False, error_msg
    
    def create_virtual_workspace(self, branch_name: str, task_name: str, repo_urls: List[str], 
                                 workspace_name: str = None, script_content: str = None, 
                                 gitlab_token: str = None) -> Dict[str, Any]:
        """Create a virtual workspace by aggregating multiple repositories as submodules.
        Uses shallow clones (--depth 1) for submodules. Submodule additions are serial.
        Returns a dictionary with operation status and relevant paths/names.
        """
        if not repo_urls:
            return {"status": "error", "message": "No repositories provided"}
        
        if workspace_name:
            safe_name = workspace_name.replace('/', '_').replace(' ', '_')
        else:
            safe_name = task_name.replace('/', '_').replace(' ', '_')
            
        workspace_dir = os.path.join(self.workspace_root, safe_name)
        
        if os.path.exists(workspace_dir):
            try:
                shutil.rmtree(workspace_dir)
                logger.info(f"Removed existing workspace directory: {workspace_dir}")
            except Exception as e:
                logger.error(f"Failed to remove existing workspace: {str(e)}")
                return {"status": "error", "message": f"Failed to remove existing workspace: {str(e)}"}
        
        try:
            os.makedirs(workspace_dir)
        except Exception as e:
            logger.error(f"Failed to create workspace directory: {str(e)}")
            return {"status": "error", "message": f"Failed to create workspace directory: {str(e)}"}
        
        success, output = self._run_git_command(["git", "init"], cwd=workspace_dir)
        if not success:
            return {"status": "error", "message": f"Failed to initialize git repository: {output}"}
        
        success, output = self._run_git_command(["git", "checkout", "-b", branch_name], cwd=workspace_dir)
        if not success:
            return {"status": "error", "message": f"Failed to create branch: {output}"}
        
        for repo_url in repo_urls:
            repo_name_from_url = repo_url.split("/")[-1].replace(".git", "")
            authenticated_repo_url = repo_url
            if gitlab_token and "gitlab.com" in repo_url:
                parsed_url = urlparse(repo_url)
                netloc_with_token = f"oauth2:{gitlab_token}@{parsed_url.hostname}"
                if parsed_url.port:
                    netloc_with_token += f":{parsed_url.port}"
                authenticated_repo_url = urlunparse(
                    (parsed_url.scheme, netloc_with_token, parsed_url.path, 
                     parsed_url.params, parsed_url.query, parsed_url.fragment)
                )
                logger.info(f"Using authenticated URL for submodule {repo_name_from_url}")
            else:
                logger.info(f"Adding submodule {repo_name_from_url} from {repo_url} (shallow clone)... No token used or not a GitLab URL.")

            success, output = self._run_git_command(
                ["git", "submodule", "add", "--depth", "1", authenticated_repo_url, repo_name_from_url], 
                cwd=workspace_dir
            )
            if not success:
                error_message = f"Failed to add submodule {repo_url}: {output}"
                logger.error(error_message)
                return {"status": "error", "message": error_message}
            logger.info(f"Successfully added submodule {repo_name_from_url}")
        
        readme_content = f"# Virtual Workspace for {task_name}\n\nBranch: {branch_name}\n\n## Included Repositories\n\n"
        for repo_url in repo_urls:
            repo_name_from_url = repo_url.split("/")[-1].replace(".git", "")
            readme_content += f"- [{repo_name_from_url}]({repo_url})\n"
        readme_content += "\n## Usage\n\nThis workspace includes helper scripts for working with multiple repositories:\n\n"
        readme_content += "- `./multi-repo.sh init` - Initialize the workspace (submodules are added and branches created)\n"
        readme_content += "- `./multi-repo.sh commit \"Your commit message\"` - Commit changes across all repositories\n"
        readme_content += "- `./multi-repo.sh push` - Push all committed changes\n"
        readme_content += "- `./multi-repo.sh pull` - Pull changes for all repositories\n"
        readme_content += "- `./multi-repo.sh status` - Show status of all repositories\n"
        readme_content += "- `./multi-repo.sh branch <branch-name>` - Create a new branch in all repositories\n"
        readme_content += "- `./multi-repo.sh checkout <branch-name>` - Checkout the specified branch in all repositories\n"
        
        readme_path = os.path.join(workspace_dir, "README.md")
        with open(readme_path, "w") as f:
            f.write(readme_content)
        
        self._create_script_from_template(workspace_dir, "commit-submodules.sh", script_content)
        self._create_script_from_template(workspace_dir, "multi-repo.sh")
            
        success, output = self._run_git_command(["git", "add", "."], cwd=workspace_dir)
        if not success:
            return {"status": "error", "message": f"Failed to stage files for commit: {output}"}
        
        commit_message = f"Create virtual workspace for {task_name}"
        success, output = self._run_git_command(
            ["git", "commit", "-m", commit_message], 
            cwd=workspace_dir
        )
        if not success:
            if "nothing to commit" in output or "no changes added to commit" in output:
                 logger.info(f"Initial commit: {output} - proceeding as this is not an error for workspace creation.")
            else:
                return {"status": "error", "message": f"Failed to commit changes: {output}"}
        
        return {
            "status": "success",
            "message": f"Virtual workspace created successfully for {task_name}",
            "workspace_dir_path": workspace_dir,
            "safe_name": safe_name
        }
        
    def _create_script_from_template(self, workspace_dir: str, script_name: str, script_content: str = None) -> bool:
        """Create a script file from template or provided content and make it executable."""
        script_path = os.path.join(workspace_dir, script_name)
        service_dir = os.path.dirname(os.path.abspath(__file__))
        template_path = os.path.join(service_dir, "..", "templates", script_name)
        
        try:
            if script_content:
                with open(script_path, "w") as f:
                    f.write(script_content)
                logger.info(f"Created {script_name} script from provided content")
            elif os.path.exists(template_path):
                with open(template_path, "r") as src, open(script_path, "w") as dst:
                    dst.write(src.read())
                logger.info(f"Created {script_name} script from template: {template_path}")
            else:
                logger.warning(f"No template or script content available for {script_name}. Template checked at {template_path}")
                return False
            
            os.chmod(script_path, 0o755)
            return True
        except Exception as e:
            logger.error(f"Failed to create {script_name} script: {str(e)}")
            return False 