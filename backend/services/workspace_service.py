import os
import subprocess
import logging
import tempfile
import shutil
import random
import threading
from typing import List, Tuple, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

logger = logging.getLogger(__name__)

class WorkspaceService:
    """Service for creating and managing the virtual monorepo workspaces."""

    def __init__(self, workspace_root: str = None):
        """Initialize the workspace service.
        
        workspace_root: Root directory for storing virtual workspaces
        """
        self.workspace_root = workspace_root or os.path.join(tempfile.gettempdir(), "virtual_workspaces")
        os.makedirs(self.workspace_root, exist_ok=True)
        self.git_lock = threading.Lock()
    
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
        """Manually add a submodule entry to .gitmodules and create an empty directory, without cloning.
           Git operations on .gitmodules and index are locked."""
        repo_name_from_url = repo_url.split("/")[-1].replace(".git", "")
        
        url_for_gitmodules_file = repo_url
        
        logger.info(f"Manually registering submodule {repo_name_from_url} from {url_for_gitmodules_file} (without cloning). Will create empty directory.")

        submodule_path_in_workspace = repo_name_from_url
        full_submodule_dir_path = os.path.join(workspace_dir, submodule_path_in_workspace)

        with self.git_lock: # Lock for file I/O on .gitmodules and git add operations
            # Append to .gitmodules
            gitmodules_path = os.path.join(workspace_dir, ".gitmodules")
            try:
                with open(gitmodules_path, "a", encoding='utf-8') as f:
                    f.write(f'[submodule "{repo_name_from_url}"]\n')
                    f.write(f'\tpath = {submodule_path_in_workspace}\n')
                    f.write(f'\turl = {url_for_gitmodules_file}\n') # Use the original, clean URL
                
                # Stage .gitmodules
                success_add_modules, output_add_modules = self._run_git_command(["git", "add", ".gitmodules"], cwd=workspace_dir)
                if not success_add_modules:
                    logger.error(f"Failed to stage .gitmodules for {repo_name_from_url}: {output_add_modules}")
                    return False, f"Failed to stage .gitmodules: {output_add_modules}", repo_name_from_url

            except IOError as e:
                logger.error(f"Failed to write to .gitmodules for {repo_name_from_url}: {e}")
                return False, f"Failed to write to .gitmodules: {e}", repo_name_from_url

            # Create an empty directory for the submodule
            try:
                os.makedirs(full_submodule_dir_path, exist_ok=True)
            except OSError as e:
                logger.error(f"Failed to create directory for submodule {repo_name_from_url} at {full_submodule_dir_path}: {e}")
                # If makedirs fails even with exist_ok=True, it's a more serious FS issue or permissions problem.
                return False, f"Failed to create directory {full_submodule_dir_path}: {e}", repo_name_from_url

            # Stage the empty directory as a submodule gitlink
            success_add_path, output_add_path = self._run_git_command(["git", "add", submodule_path_in_workspace], cwd=workspace_dir)
            if not success_add_path:
                logger.error(f"Failed to stage submodule path {submodule_path_in_workspace} for {repo_name_from_url}: {output_add_path}")
                return False, f"Failed to stage submodule path: {output_add_path}", repo_name_from_url

        logger.info(f"Successfully registered submodule {repo_name_from_url} via manual .gitmodules update and empty directory.")
        return True, f"Successfully registered submodule {repo_name_from_url}", repo_name_from_url
    
    def create_virtual_workspace(self, branch_name: str, task_name: str, repo_urls: List[str], 
                                 workspace_name: str = None, script_content: str = None, 
                                 gitlab_token: str = None) -> Dict[str, Any]:
        """Create a virtual workspace by aggregating multiple repositories as submodules.
        Uses shallow clones (--depth 1) for submodules, added in parallel.
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
        unique_suffix = str(int(time.time()))
        unique_safe_name = f"{safe_name}_{unique_suffix}"
            
        workspace_dir = os.path.join(self.workspace_root, unique_safe_name)

        if os.path.exists(workspace_dir):
            try:
                # Just in case the exact same timestamp exists
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
        try:
            # Look for directories that match the base name pattern
            base_dirs = [d for d in os.listdir(self.workspace_root) 
                        if os.path.isdir(os.path.join(self.workspace_root, d)) 
                        and d.startswith(f"{safe_name}_") 
                        and d != unique_safe_name]
            
            # Sort by creation time, oldest first
            base_dirs.sort(key=lambda d: os.path.getctime(os.path.join(self.workspace_root, d)))
            
            # Keep only the 3 most recent directories (plus the new one being created)
            dirs_to_remove = base_dirs[:-2] if len(base_dirs) > 2 else []
            
            for old_dir in dirs_to_remove:
                old_path = os.path.join(self.workspace_root, old_dir)
                try:
                    shutil.rmtree(old_path, ignore_errors=True)
                except Exception as e:
                    logger.warning(f"Could not remove old workspace directory {old_path}: {str(e)}")
        except Exception as e:
            logger.warning(f"Error during old workspace cleanup: {str(e)}")
        
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
        max_workers = min(len(repo_urls), 6)  # TODO: maybe test out different values here
        
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
            readme_content += "\nTo add them manually, use:\n```bash\ngit submodule add <repository-url> <directory-name>\n```\n\n"
        
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
                 logger.info(f"Initial commit: {output} - proceeding as this expected for workspace creation.")
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
        """Create a script file from template and make it executable."""
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