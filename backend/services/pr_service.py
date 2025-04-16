from typing import List, Dict
import re
from ..models.pr import PR, UnifiedPR
import gitlab
import logging

logger = logging.getLogger(__name__)

class PRService:
    def __init__(self, gitlab_client: gitlab.Gitlab):
        self.gl = gitlab_client

    def extract_task_name(self, branch_name: str) -> str:
        """Extract task name from branch name using common patterns."""
        patterns = [
            r'^(feature|bug|bugfix|hotfix|fix|chore|task)/([A-Z]+-\d+)', # JIRA-style with more prefixes (e.g., feature/ABC-123)
            r'^(feature|bug|bugfix|hotfix|fix|chore|task)/(\d+)', # Numeric with more prefixes (e.g., feature/123)
            r'^([A-Z]+-\d+)', # Just ticket number (e.g., ABC-123)
        ]
        
        for pattern in patterns:
            match = re.match(pattern, branch_name, re.IGNORECASE)
            if match:
                return match.group(2) if len(match.groups()) > 1 else match.group(1)
        
        logger.debug(f"Could not extract task name from branch '{branch_name}'")
        return None

    def get_project_from_url(self, repo_url: str):
        """Get GitLab project from repository URL."""
        try:
            # Remove trailing slash and .git if present and extract the path from the URL
            repo_url = repo_url.rstrip('/').rstrip('.git')
            path = repo_url.split(self.gl.url)[1].lstrip('/')
            
            return self.gl.projects.get(path)
        except Exception as e:
            logger.error(f"Error getting project from URL {repo_url}: {str(e)}")
            raise ValueError(f"Repository not found: {repo_url}")

    def get_pipeline_status(self, project, mr_iid):
        """Get the latest pipeline status for a merge request."""
        try:
            mr = project.mergerequests.get(mr_iid)
            pipelines = mr.pipelines.list()
            
            if pipelines and len(pipelines) > 0:
                # Get the most recent pipeline
                latest_pipeline = pipelines[0]
                return latest_pipeline.status
            
            return None
        except Exception as e:
            logger.error(f"Error getting pipeline status for MR {mr_iid}: {str(e)}")
            return None

    def fetch_prs(self, repo_urls: List[str]) -> List[PR]:
        """Fetch PRs from multiple GitLab repositories with improved error handling."""
        all_prs = []
        
        for repo_url in repo_urls:
            try:
                logger.debug(f"Fetching PRs for repository: {repo_url}")
                # Get project with timeout
                project = self.get_project_from_url(repo_url)
                merge_requests = project.mergerequests.list(state='opened', get_all=True)
                
                for mr in merge_requests:
                    task_name = self.extract_task_name(mr.source_branch)
                    pipeline_status = self.get_pipeline_status(project, mr.iid)
                    
                    pr = PR(
                        id=mr.id,
                        iid=mr.iid,
                        title=mr.title,
                        description=mr.description,
                        source_branch=mr.source_branch,
                        target_branch=mr.target_branch,
                        state=mr.state,
                        created_at=mr.created_at,
                        updated_at=mr.updated_at,
                        web_url=mr.web_url,
                        repository_name=project.name,
                        repository_url=project.web_url,
                        author=mr.author,
                        assignees=mr.assignees,
                        labels=mr.labels,
                        task_name=task_name,
                        pipeline_status=pipeline_status
                    )
                    all_prs.append(pr)
            except Exception as e:
                logger.error(f"Error fetching PRs for repository {repo_url}: {str(e)}")
                continue
                
        return all_prs

    def unify_prs(self, prs: List[PR]) -> List[UnifiedPR]:
        """Group PRs by task name and create unified views."""
        task_groups: Dict[str, List[PR]] = {}
        
        # Group PRs by task name
        for pr in prs:
            if pr.task_name:
                if pr.task_name not in task_groups:
                    task_groups[pr.task_name] = []
                task_groups[pr.task_name].append(pr)
        
        # Create unified PR views
        unified_prs = []
        for task_name, grouped_prs in task_groups.items():
            if len(grouped_prs) > 1:  # Only create unified views for tasks with multiple PRs
                # Determine overall status
                status = 'open'
                if all(pr.state == 'merged' for pr in grouped_prs):
                    status = 'merged'
                elif all(pr.state == 'closed' for pr in grouped_prs):
                    status = 'closed'
                
                # Calculate total changes and comments
                total_changes = sum(getattr(pr, 'changes_count', 0) for pr in grouped_prs)
                total_comments = sum(getattr(pr, 'comments_count', 0) for pr in grouped_prs)
                
                unified_pr = UnifiedPR(
                    task_name=task_name,
                    prs=grouped_prs,
                    total_changes=total_changes,
                    total_comments=total_comments,
                    status=status
                )
                unified_prs.append(unified_pr)
        
        logger.info(f"Created {len(unified_prs)} unified PR views")
        return unified_prs