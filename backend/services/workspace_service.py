import os
import subprocess
import logging
import tempfile
import shutil
import random
from typing import List, Tuple, Dict, Any
from urllib.parse import urlparse, urlunparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import time
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
            # Add git optimizations for better performance
            env = os.environ.copy()
            
            # Use platform-appropriate null device
            null_device = 'nul' if os.name == 'nt' else '/dev/null'
            env.update({
                'GIT_CONFIG_GLOBAL': null_device,  # Skip global git config for speed
                'GIT_CONFIG_SYSTEM': null_device,  # Skip system git config for speed
            })
            
            result = subprocess.run(
                cmd, 
                cwd=cwd,
                capture_output=True,
                text=True,
                check=True,
                env=env
            )
            return True, result.stdout.strip()
        except subprocess.CalledProcessError as e:
            error_msg = f"Git command failed: {e.stderr.strip() if e.stderr else e.stdout.strip()}" 
            logger.error(error_msg)
            return False, error_msg
    
    def _add_submodule_parallel(self, repo_url: str, workspace_dir: str, gitlab_token: str = None) -> Tuple[bool, str, str]:
        """Add a single submodule in a thread-safe manner with optimizations."""
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
            logger.info(f"Adding submodule {repo_name_from_url} from {repo_url} (fast shallow clone)...")

        # Fast approach: Direct shallow clone then register as submodule
        submodule_path = os.path.join(workspace_dir, repo_name_from_url)
        
        # Step 1: Fast shallow clone directly
        success, output = self._run_git_command(
            ["git", "clone", 
             "--depth", "1",           # Shallow clone
             "--single-branch",        # Only clone the default branch  
             "--no-tags",             # Skip tags for faster clone
             authenticated_repo_url, repo_name_from_url], 
            cwd=workspace_dir
        )
        
        if not success:
            logger.warning(f"Fast clone failed for {repo_name_from_url}, trying fallback submodule method")
            # Fallback to traditional submodule add
            if os.path.exists(submodule_path):
                try:
                    shutil.rmtree(submodule_path)
                except:
                    pass
                    
            success, output = self._run_git_command(
                ["git", "submodule", "add", authenticated_repo_url, repo_name_from_url], 
                cwd=workspace_dir
            )
            return success, output, repo_name_from_url
        
        # Step 2: Register as submodule in .gitmodules
        gitmodules_path = os.path.join(workspace_dir, ".gitmodules")
        try:
            with open(gitmodules_path, "a", encoding='utf-8') as f:
                f.write(f'''[submodule "{repo_name_from_url}"]
\tpath = {repo_name_from_url}
\turl = {repo_url}
''')
            
            # Step 3: Stage the submodule
            self._run_git_command(["git", "add", repo_name_from_url], cwd=workspace_dir)
            self._run_git_command(["git", "add", ".gitmodules"], cwd=workspace_dir)
            
            logger.info(f"Successfully added fast submodule {repo_name_from_url}")
            return True, "Fast submodule addition successful", repo_name_from_url
            
        except Exception as e:
            logger.error(f"Failed to register submodule {repo_name_from_url}: {e}")
            return False, f"Failed to register submodule: {e}", repo_name_from_url
    
    def create_virtual_workspace(self, branch_name: str, task_name: str, repo_urls: List[str], 
                                 workspace_name: str = None, script_content: str = None, 
                                 gitlab_token: str = None) -> Dict[str, Any]:
        """Create a virtual workspace by aggregating multiple repositories as submodules.
        Uses shallow clones (--depth 1) for submodules. Submodule additions are parallel.
        Returns a dictionary with operation status and relevant paths/names.
        """
        start_time = time.time()
        
        if not repo_urls:
            return {"status": "error", "message": "No repositories provided"}
        
        if workspace_name:
            safe_name = workspace_name.replace('/', '_').replace(' ', '_')
        else:
            safe_name = task_name.replace('/', '_').replace(' ', '_')
        
        # Add a timestamp to create a unique directory for each attempt
        # This helps avoid conflicts with locked files from previous attempts
        unique_suffix = str(int(time.time()))
        unique_safe_name = f"{safe_name}_{unique_suffix}"
            
        workspace_dir = os.path.join(self.workspace_root, unique_safe_name)
        
        # Instead of removing the existing workspace, we'll use a new unique directory
        # This avoids file lock issues with previously created workspaces
        if os.path.exists(workspace_dir):
            try:
                # Just in case the exact same timestamp exists (very unlikely)
                shutil.rmtree(workspace_dir)
                logger.info(f"Removed existing workspace directory: {workspace_dir}")
            except Exception as e:
                logger.warning(f"Could not remove existing workspace with same timestamp, trying a different name: {str(e)}")
                # Add another random component to make it unique
                unique_safe_name = f"{safe_name}_{unique_suffix}_{random.randint(1000, 9999)}"
                workspace_dir = os.path.join(self.workspace_root, unique_safe_name)
        
        try:
            os.makedirs(workspace_dir)
            logger.info(f"Created new workspace directory: {workspace_dir}")
        except Exception as e:
            logger.error(f"Failed to create workspace directory: {str(e)}")
            return {"status": "error", "message": f"Failed to create workspace directory: {str(e)}"}
        
        # Clean up old workspaces with same base name to avoid filling disk space
        # Do this in a try/except block and don't fail if cleanup fails
        try:
            # Look for directories that match the base name pattern
            base_dirs = [d for d in os.listdir(self.workspace_root) 
                        if os.path.isdir(os.path.join(self.workspace_root, d)) 
                        and d.startswith(f"{safe_name}_") 
                        and d != unique_safe_name]
            
            # Sort by creation time, oldest first
            base_dirs.sort(key=lambda d: os.path.getctime(os.path.join(self.workspace_root, d)))
            
            # Keep only the 3 most recent directories (plus the new one we're creating)
            dirs_to_remove = base_dirs[:-2] if len(base_dirs) > 2 else []
            
            for old_dir in dirs_to_remove:
                old_path = os.path.join(self.workspace_root, old_dir)
                try:
                    logger.info(f"Attempting to clean up old workspace: {old_path}")
                    shutil.rmtree(old_path, ignore_errors=True)
                except Exception as e:
                    # Just log but don't fail if we can't remove old directories
                    logger.warning(f"Could not remove old workspace directory {old_path}: {str(e)}")
        except Exception as e:
            logger.warning(f"Error during old workspace cleanup: {str(e)}")
        
        # Optimized git init with performance settings
        success, output = self._run_git_command(["git", "init", "--initial-branch=main"], cwd=workspace_dir)
        if not success:
            return {"status": "error", "message": f"Failed to initialize git repository: {output}"}
        
        # Configure git for better performance and set user identity
        self._run_git_command(["git", "config", "submodule.recurse", "false"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "advice.detachedHead", "false"], cwd=workspace_dir)
        
        # Advanced git performance optimizations
        self._run_git_command(["git", "config", "fetch.parallel", "6"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "submodule.fetchJobs", "6"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "protocol.version", "2"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "core.preloadindex", "true"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "core.fscache", "true"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "gc.auto", "0"], cwd=workspace_dir)
        
        # Set git user identity for commits (required for git commit)
        self._run_git_command(["git", "config", "user.name", "RepoScope Virtual Workspace"], cwd=workspace_dir)
        self._run_git_command(["git", "config", "user.email", "noreply@reposcope.local"], cwd=workspace_dir)
        
        success, output = self._run_git_command(["git", "checkout", "-b", branch_name], cwd=workspace_dir)
        if not success:
            return {"status": "error", "message": f"Failed to create branch: {output}"}
        
        # Add submodules in parallel for better performance  
        logger.info(f"Adding {len(repo_urls)} submodules in parallel...")
        submodule_start = time.time()
        failed_repos = []
        
        # Use parallel processing with optimal worker count
        max_workers = min(len(repo_urls), 6)  # Increase to 6 concurrent operations for better performance
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all submodule addition tasks
            future_to_repo = {
                executor.submit(self._add_submodule_parallel, repo_url, workspace_dir, gitlab_token): repo_url 
                for repo_url in repo_urls
            }
            
            # Collect results as they complete
            for future in as_completed(future_to_repo):
                repo_url = future_to_repo[future]
                try:
                    success, output, repo_name = future.result()
                    if not success:
                        error_message = f"Failed to add submodule {repo_url}: {output}"
                        logger.error(error_message)
                        failed_repos.append(repo_url)
                    else:
                        logger.info(f"Successfully added submodule {repo_name}")
                except Exception as e:
                    logger.error(f"Exception while adding submodule {repo_url}: {str(e)}")
                    failed_repos.append(repo_url)
        
        submodule_duration = round(time.time() - submodule_start, 2)
        logger.info(f"Parallel submodule addition completed in {submodule_duration} seconds")
        
        # Instead of failing completely, handle partial failures gracefully
        successful_repos = len(repo_urls) - len(failed_repos)
        if failed_repos:
            logger.warning(f"Failed to add {len(failed_repos)} submodules: {', '.join(failed_repos)}")
            logger.info(f"Successfully added {successful_repos} out of {len(repo_urls)} repositories")
            
            # If ALL repositories failed, then fail the workspace creation
            if successful_repos == 0:
                return {"status": "error", "message": f"Failed to add any submodules. All repositories failed: {', '.join(failed_repos)}"}
            
            # If some repositories failed, create a .gitmodules file for the failed ones so user can retry later
            gitmodules_additions = []
            for failed_repo in failed_repos:
                repo_name = failed_repo.split("/")[-1].replace(".git", "")
                gitmodules_additions.append(f'''
# Failed to clone automatically - you can retry with: git submodule add {failed_repo} {repo_name}
# [submodule "{repo_name}"]
#   path = {repo_name}
#   url = {failed_repo}
''')
            
            if gitmodules_additions:
                gitmodules_path = os.path.join(workspace_dir, ".gitmodules")
                try:
                    with open(gitmodules_path, "a", encoding='utf-8') as f:
                        f.write("".join(gitmodules_additions))
                    logger.info("Added failed repositories as comments in .gitmodules for manual retry")
                except Exception as e:
                    logger.warning(f"Could not add failed repositories to .gitmodules: {e}")
        else:
            logger.info("All submodules added successfully")
        
        readme_content = f"# Virtual Workspace for {task_name}\n\nBranch: {branch_name}\n\n## Included Repositories\n\n"
        
        # Add successfully cloned repositories
        successful_repo_urls = [url for url in repo_urls if url not in failed_repos]
        for repo_url in successful_repo_urls:
            repo_name_from_url = repo_url.split("/")[-1].replace(".git", "")
            readme_content += f"- [{repo_name_from_url}]({repo_url}) ✅\n"
        
        # Add failed repositories if any
        if failed_repos:
            readme_content += f"\n## Failed Repositories ({len(failed_repos)})\n\n"
            readme_content += "The following repositories failed to clone automatically (possibly private or authentication required):\n\n"
            for repo_url in failed_repos:
                repo_name_from_url = repo_url.split("/")[-1].replace(".git", "")
                readme_content += f"- [{repo_name_from_url}]({repo_url}) ⚠️\n"
            readme_content += f"\nTo add them manually, use:\n```bash\ngit submodule add <repository-url> <directory-name>\n```\n\n"
        
        readme_content += "\n## Usage\n\nThis workspace includes helper scripts for working with multiple repositories:\n\n"
        readme_content += "- `./multi-repo.sh init` - Initialize the workspace (submodules are added and branches created)\n"
        readme_content += "- `./multi-repo.sh commit \"Your commit message\"` - Commit changes across all repositories\n"
        readme_content += "- `./multi-repo.sh push` - Push all committed changes\n"
        readme_content += "- `./multi-repo.sh pull` - Pull changes for all repositories\n"
        readme_content += "- `./multi-repo.sh status` - Show status of all repositories\n"
        readme_content += "- `./multi-repo.sh branch <branch-name>` - Create a new branch in all repositories\n"
        readme_content += "- `./multi-repo.sh checkout <branch-name>` - Checkout the specified branch in all repositories\n"
        readme_content += "- `./multi-repo.sh pr \"Your PR title\"` - Create pull requests for all repositories with changes\n"
        
        readme_path = os.path.join(workspace_dir, "README.md")
        with open(readme_path, "w", encoding='utf-8') as f:
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
        
        end_time = time.time()
        total_duration = round(end_time - start_time, 2)
        logger.info(f"Virtual workspace creation completed in {total_duration} seconds")
        
        return {
            "status": "success",
            "message": f"Virtual workspace created successfully for {task_name}. Successfully processed {successful_repos} out of {len(repo_urls)} repositories.",
            "workspace_dir_path": workspace_dir,
            "safe_name": safe_name,
            "performance": {
                "total_duration": total_duration,
                "submodule_duration": submodule_duration,
                "optimization_duration": 0,
                "repo_count": len(repo_urls),
                "successful_repos": successful_repos,
                "failed_repos": len(failed_repos)
            }
        }
        
    def _create_script_from_template(self, workspace_dir: str, script_name: str, script_content: str = None) -> bool:
        """Create a script file from template or provided content and make it executable."""
        script_path = os.path.join(workspace_dir, script_name)
        service_dir = os.path.dirname(os.path.abspath(__file__))
        template_path = os.path.join(service_dir, "..", "templates", script_name)
        
        try:
            if script_content:
                with open(script_path, "w", encoding='utf-8') as f:
                    f.write(script_content)
                logger.info(f"Created {script_name} script from provided content")
            elif os.path.exists(template_path):
                with open(template_path, "r", encoding='utf-8') as src, open(script_path, "w", encoding='utf-8') as dst:
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