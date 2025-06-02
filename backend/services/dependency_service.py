import os
import tempfile
import logging
import subprocess
import shutil
from typing import List, Dict, Any, Tuple
import re
from urllib.parse import urlparse, urlunparse
import uuid

logger = logging.getLogger(__name__)

class DependencyService:
    """Service for checking and comparing dependencies across repositories."""

    def __init__(self):
        """Initialize the dependency service."""
        self.temp_dir = os.path.join(tempfile.gettempdir(), "dependency_checks")
        os.makedirs(self.temp_dir, exist_ok=True)
        logger.info(f"Dependency service initialized with temp directory: {self.temp_dir}")
    
    def _run_command(self, cmd: List[str], cwd: str = None) -> Tuple[bool, str]:
        """Run a command and return the result."""
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
            error_msg = f"Command failed: {e.stderr.strip() if e.stderr else e.stdout.strip()}" 
            logger.error(error_msg)
            return False, error_msg
    
    def _clone_repo(self, repo_url: str, repo_name: str, gitlab_token: str = None, branch: str = None) -> Tuple[bool, str]:
        """Clone a repository to a temporary directory.
        
        Args:
            repo_url: URL of the repository to clone
            repo_name: Name of the repository
            gitlab_token: Optional GitLab token for authentication
            branch: Optional branch to checkout after cloning
        
        Returns:
            Tuple of (success, result) where result is the repo directory path or error message
        """
        # Create a unique directory name with timestamp to avoid conflicts
        unique_id = str(uuid.uuid4())[:8]
        repo_dir = os.path.join(self.temp_dir, f"{repo_name}_{unique_id}")
        
        # Add authentication to URL if needed
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
            logger.info(f"Using authenticated URL for {repo_name}")
        
        # Clone with depth=1 for speed
        clone_cmd = ["git", "clone", "--depth", "1"]
        
        # Add branch parameter if specified
        if branch:
            clone_cmd.extend(["--branch", branch])
            logger.info(f"Cloning repository {repo_name} with branch {branch}")
        else:
            logger.info(f"Cloning repository {repo_name} with default branch")
            
        clone_cmd.extend([authenticated_repo_url, repo_dir])
        
        success, output = self._run_command(clone_cmd)
        if not success:
            # Special handling for branch not found error
            if branch and "Remote branch not found" in output:
                return False, f"Branch '{branch}' not found in repository {repo_url}"
            return False, f"Failed to clone repository {repo_url}: {output}"
        
        return True, repo_dir
    
    def _get_python_dependencies(self, repo_dir: str) -> Dict[str, str]:
        """Extract Python dependencies from requirements.txt or setup.py."""
        dependencies = {}
        
        # Check requirements.txt
        req_file = os.path.join(repo_dir, "requirements.txt")
        if os.path.exists(req_file):
            try:
                with open(req_file, 'r') as f:
                    lines = f.readlines()
                
                for line in lines:
                    line = line.strip()
                    # Skip comments and empty lines
                    if not line or line.startswith('#'):
                        continue
                    
                    # Extract package and version. Handles formats like: package==1.0.0, package>=1.0.0, package~=1.0.0
                    match = re.match(r'^([a-zA-Z0-9_.-]+)([~=<>]=?)([a-zA-Z0-9_.-]+)', line)
                    if match:
                        package, operator, version = match.groups()
                        dependencies[package.lower()] = f"{operator}{version}"
                    else:
                        # For packages without version specs
                        package = line.split('#')[0].strip()  # Remove inline comments
                        if package:
                            dependencies[package.lower()] = "unspecified"
                logger.info(f"Found {len(dependencies)} dependencies in requirements.txt")
            except Exception as e:
                logger.error(f"Error parsing requirements.txt in {repo_dir}: {str(e)}")
        
        # Check setup.py (if it exists and requirements.txt doesn't have all info)
        setup_file = os.path.join(repo_dir, "setup.py")
        if os.path.exists(setup_file):
            try:
                with open(setup_file, 'r') as f:
                    content = f.read()
                
                # Look for install_requires section
                match = re.search(r'install_requires\s*=\s*\[(.*?)\]', content, re.DOTALL)
                if match:
                    install_requires = match.group(1)
                    # Extract individual package requirements
                    for req in re.finditer(r'[\'"]([a-zA-Z0-9_.-]+)([~=<>]=?)([a-zA-Z0-9_.-]+)[\'"]', install_requires):
                        package, operator, version = req.groups()
                        dependencies[package.lower()] = f"{operator}{version}"
                    logger.info(f"Found {len(dependencies)} dependencies in setup.py")
            except Exception as e:
                logger.error(f"Error parsing setup.py in {repo_dir}: {str(e)}")
        
        return dependencies
    
    def _get_go_dependencies(self, repo_dir: str) -> Dict[str, str]:
        """Extract Go dependencies from go.mod."""
        dependencies = {}
        
        # Check go.mod
        go_mod_file = os.path.join(repo_dir, "go.mod")
        if os.path.exists(go_mod_file):
            try:
                with open(go_mod_file, 'r') as f:
                    content = f.read()
                
                # Extract require statements
                require_block = re.search(r'require\s*\((.*?)\)', content, re.DOTALL)
                if require_block:
                    requires = require_block.group(1)
                    # Find each module and version
                    for module_match in re.finditer(r'([^\s]+)\s+([^\s]+)', requires):
                        module, version = module_match.groups()
                        dependencies[module.lower()] = version.strip()
                else:
                    # Look for inline requires (not in a block)
                    for req_match in re.finditer(r'require\s+([^\s]+)\s+([^\s]+)', content):
                        module, version = req_match.groups()
                        dependencies[module.lower()] = version.strip()
                
                # Also check for replace directives. TODO: need to check this
                replace_block = re.search(r'replace\s*\((.*?)\)', content, re.DOTALL)
                if replace_block:
                    replaces = replace_block.group(1)
                    for replace_match in re.finditer(r'([^\s]+)\s+=>\s+([^\s]+)\s+([^\s]+)', replaces):
                        original, replacement, version = replace_match.groups()
                        # Mark replacements in a special way
                        dependencies[original.lower()] = f"=> {replacement} {version}"
            except Exception as e:
                logger.error(f"Error parsing go.mod in {repo_dir}: {str(e)}")
                
        # Check go.sum for more exact versions
        go_sum_file = os.path.join(repo_dir, "go.sum")
        if os.path.exists(go_sum_file):
            try:
                with open(go_sum_file, 'r') as f:
                    for line in f:
                        parts = line.strip().split()
                        if len(parts) >= 2:
                            module, version = parts[0], parts[1]
                            if module.lower() in dependencies:
                                # Only update if we don't have information from replace directives
                                if not dependencies[module.lower()].startswith("=>"):
                                    dependencies[module.lower()] = version
            except Exception as e:
                logger.error(f"Error parsing go.sum in {repo_dir}: {str(e)}")
        
        return dependencies
    
    def check_dependencies(self, repo_urls: List[str], gitlab_token: str = None, repo_branches: Dict[str, str] = None) -> Dict[str, Any]:
        """Compare dependencies across multiple repositories and identify mismatches.
        
        Args:
            repo_urls: List of repository URLs to check
            gitlab_token: Optional GitLab token for authentication
            repo_branches: Optional dictionary mapping repo URLs to branch names
            
        Returns:
            Dictionary with status and results of dependency comparison
        """
        if not repo_urls:
            return {"status": "error", "message": "No repositories provided"}
        
        if len(repo_urls) < 2:
            return {
                "status": "success",
                "message": "At least two repositories are required to check for mismatches",
                "python_mismatches": {},
                "go_mismatches": {}
            }
        
        # Default empty dict if None
        repo_branches = repo_branches or {}
        
        temp_dirs = []  # Keep track of temp dirs for cleanup
        repo_dependencies = {}
        clone_errors = []
        
        try:
            # Clone each repository and extract dependencies
            for repo_url in repo_urls:
                repo_name = repo_url.split("/")[-1].replace(".git", "")
                # Get branch for this repo if specified, otherwise use default
                branch = repo_branches.get(repo_url)
                branch_display = f" (branch: {branch})" if branch else ""
                
                try:
                    success, result = self._clone_repo(repo_url, repo_name, gitlab_token, branch)
                    if not success:
                        clone_errors.append(f"{repo_name}{branch_display}: {result}")
                        continue
                    
                    repo_dir = result
                    temp_dirs.append(repo_dir)
                    
                    # Get dependencies from the repo
                    python_deps = self._get_python_dependencies(repo_dir)
                    go_deps = self._get_go_dependencies(repo_dir)
                    
                    # Store all dependencies for this repo
                    repo_dependencies[f"{repo_name}{branch_display}"] = {
                        "python": python_deps,
                        "go": go_deps
                    }
                    
                    logger.info(f"Successfully processed {repo_name}{branch_display} - Found {len(python_deps)} Python deps and {len(go_deps)} Go deps")
                except Exception as e:
                    clone_errors.append(f"{repo_name}{branch_display}: {str(e)}")
                    logger.error(f"Error processing repository {repo_name}{branch_display}: {str(e)}", exc_info=True)
            
            # If cloning repositories failed, return error
            if len(repo_dependencies) == 0:
                return {
                    "status": "error", 
                    "message": f"Failed to process any repositories: {'; '.join(clone_errors)}"
                }
                
            # If only one repository, no mismatches to check
            if len(repo_dependencies) < 2:
                return {
                    "status": "success",
                    "message": f"Successfully processed {len(repo_dependencies)} repository, but at least two are needed to check for mismatches. Errors: {'; '.join(clone_errors) if clone_errors else 'None'}",
                    "python_mismatches": {},
                    "go_mismatches": {}
                }
            
            # Compare dependencies across repos
            python_mismatches = self._find_mismatches([
                (repo, deps["python"]) for repo, deps in repo_dependencies.items()
            ])
            
            go_mismatches = self._find_mismatches([
                (repo, deps["go"]) for repo, deps in repo_dependencies.items()
            ])
            
            result = {
                "status": "success", 
                "python_mismatches": python_mismatches,
                "go_mismatches": go_mismatches
            }
            
            # Add warnings if there were any errors
            if clone_errors:
                result["warnings"] = clone_errors
                
            return result
            
        finally:
            # Clean up temporary directories
            self._cleanup_temp_dirs(temp_dirs)
            
    def _cleanup_temp_dirs(self, temp_dirs: List[str]) -> None:
        """Clean up temporary directories"""
        import time
        for temp_dir in temp_dirs:
            try:
                if os.path.exists(temp_dir):
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            # Force close git index to release locks on Windows
                            if os.name == 'nt':  # Windows check
                                git_dir = os.path.join(temp_dir, '.git')
                                if os.path.exists(git_dir):
                                    try:
                                        # Execute git gc to clean up and release handles
                                        self._run_command(["git", "gc"], cwd=temp_dir)
                                    except Exception:
                                        # Ignore errors from git gc
                                        pass
                                    time.sleep(0.5)  # Small delay to let OS release handles
                            
                            shutil.rmtree(temp_dir, ignore_errors=True)
                            logger.info(f"Cleaned up temporary directory {temp_dir}")
                            break  # Success, exit retry loop
                        except Exception as e:
                            if attempt < max_retries - 1:
                                logger.warning(f"Retry {attempt+1}/{max_retries} cleaning temp directory: {temp_dir}")
                                time.sleep(1)  # Wait before retry
                            else:
                                logger.error(f"Failed to clean up temporary directory {temp_dir}: {str(e)}")
                                # On final attempt, try to at least delete as much as possible
                                self._cleanup_what_we_can(temp_dir)
            except Exception as e:
                logger.error(f"Failed to clean up temporary directory {temp_dir}: {str(e)}")

    def _cleanup_what_we_can(self, directory: str) -> None:
        """Attempt to clean up as many files as possible in a directory."""
        for root, dirs, files in os.walk(directory, topdown=False):
            # Try to remove files
            for name in files:
                try:
                    file_path = os.path.join(root, name)
                    os.chmod(file_path, 0o777)  # Try to ensure we have permissions
                    os.remove(file_path)
                except Exception:
                    pass  # Ignore errors
            
            # Try to remove directories
            for name in dirs:
                try:
                    dir_path = os.path.join(root, name)
                    os.chmod(dir_path, 0o777)  # Try to ensure we have permissions
                    os.rmdir(dir_path)
                except Exception:
                    pass  # Ignore errors
        
        # Finally try to remove the main directory
        try:
            os.rmdir(directory)
        except Exception:
            pass  # Ignore errors

    def _find_mismatches(self, repo_deps: List[Tuple[str, Dict[str, str]]]) -> Dict[str, Dict[str, List[str]]]:
        """Find dependency version mismatches across repositories. 
        Returns a dictionary of dependency mismatches
        """
        # First, collect all unique dependencies across repos
        all_dependencies = set()
        for _, deps in repo_deps:
            all_dependencies.update(deps.keys())
        
        # For each dependency, check versions across repos
        mismatches = {}
        
        for dependency in all_dependencies:
            # Collect versions of this dependency across repos
            versions_by_repo = {}
            
            for repo_name, deps in repo_deps:
                if dependency in deps:
                    version = deps[dependency]
                    if version not in versions_by_repo:
                        versions_by_repo[version] = []
                    versions_by_repo[version].append(repo_name)
            
            # If more than one version exists, it's a mismatch
            if len(versions_by_repo) > 1:
                mismatches[dependency] = {
                    version: repos for version, repos in versions_by_repo.items()
                }
        
        return mismatches 