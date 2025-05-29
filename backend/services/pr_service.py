from typing import List, Dict, Optional, Set
import re
from ..models.pr import PR, UnifiedPR
import gitlab
import logging
import concurrent.futures
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class PRService:
    def __init__(self, gitlab_client: gitlab.Gitlab):
        self.gl = gitlab_client
        # Attempt to get the current user for approval checks. Assumes the gitlab_client is authenticated.
        try:
            self.current_username = self.gl.user.username
        except Exception as e:
            logger.warning(f"Could not determine current GitLab user: {e}. Approval checks might not work as expected for 'current user'.")
            self.current_username = None

    def extract_task_name(self, branch_name: str) -> str:
        """Extract task name from branch name using common patterns."""
        # TODO: Make this more robust and configurable.
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

    def get_pipeline_status_batch(self, project, mr_list):
        """Get pipeline status for multiple MRs in batch to reduce API calls."""
        pipeline_statuses = {}
        try:
            # Get recent pipelines for the project (more efficient than per-MR calls)
            recent_pipelines = project.pipelines.list(
                per_page=100, 
                page=1, 
                order_by='id', 
                sort='desc',
                updated_after=(datetime.now() - timedelta(days=7)).isoformat()
            )
            
            # Create a mapping of MR to its latest pipeline
            for pipeline in recent_pipelines:
                if hasattr(pipeline, 'ref'):
                    # Find MRs that match this pipeline's branch
                    for mr in mr_list:
                        if mr.source_branch == pipeline.ref:
                            if mr.iid not in pipeline_statuses:
                                pipeline_statuses[mr.iid] = pipeline.status
                            
        except Exception as e:
            logger.error(f"Error getting batch pipeline status: {str(e)}")
            
        return pipeline_statuses

    def get_pr_approval_details(self, mr_object) -> dict:
        """Get approval details for a given merge request object."""
        user_has_approved = False
        approvers_list = []
        try:
            # Get the approval data - this returns the full detailed approval information
            logger.debug(f"Getting approvals for MR {mr_object.iid}")
            
            # Directly access the approvals endpoint for more reliable data
            project_id = mr_object.project_id
            mr_iid = mr_object.iid
            
            # Get the raw approvals data
            approvals_data = self.gl.http_get(f'/projects/{project_id}/merge_requests/{mr_iid}/approvals')
            
            if 'approved_by' in approvals_data:
                # Process the raw approved_by data
                for approver_data in approvals_data['approved_by']:
                    if 'user' in approver_data and isinstance(approver_data['user'], dict):
                        # Add to approvers list
                        approvers_list.append(approver_data['user'])
                        
                        # Check if current user has approved
                        if self.current_username and approver_data['user'].get('username') == self.current_username:
                            user_has_approved = True
                            logger.debug(f"Current user {self.current_username} has approved MR {mr_object.iid}")
            
            # Log the results for debugging
            logger.debug(f"MR {mr_object.iid} - Approvers: {[a.get('username') for a in approvers_list]}, Current user approved: {user_has_approved}")
            
        except Exception as e:
            logger.error(f"Error fetching approval details for MR {mr_object.iid}: {e}")
        
        return {"user_has_approved": user_has_approved, "approvers": approvers_list}

    def _fetch_prs_for_repo(self, repo_url: str, 
                           limit: int = 30, 
                           include_pipeline_status: bool = True,
                           recent_only: bool = True) -> List[PR]:
        """Helper function to fetch PRs for a single repository with smart limits."""
        repo_prs = []
        try:
            logger.debug(f"Fetching PRs for repository: {repo_url} (limit: {limit})")
            project = self.get_project_from_url(repo_url)
            
            # Build query parameters for recent, limited PRs
            query_params = {
                'state': 'opened',
                'per_page': min(limit, 50),  # GitLab API limit
                'page': 1,
                'order_by': 'updated_at',
                'sort': 'desc'
            }
            
            # Only fetch recent PRs if specified
            if recent_only:
                updated_after = datetime.now() - timedelta(days=30)
                query_params['updated_after'] = updated_after.isoformat()
            
            # Fetch limited set of MRs
            merge_requests = project.mergerequests.list(**query_params)
            
            # Limit to exactly what we need
            merge_requests = merge_requests[:limit]
            
            logger.info(f"Fetched {len(merge_requests)} MRs from {repo_url}")
            
            # Get pipeline statuses in batch if requested
            pipeline_statuses = {}
            if include_pipeline_status and merge_requests:
                pipeline_statuses = self.get_pipeline_status_batch(project, merge_requests)
            
            # Process MRs into PRs
            for mr in merge_requests:
                task_name = self.extract_task_name(mr.source_branch)
                
                # Get pipeline status from batch or set to None
                pipeline_status = pipeline_statuses.get(mr.iid) if include_pipeline_status else None
                
                # Only get approval details if we have a task name (to reduce unnecessary API calls)
                approval_details = {"user_has_approved": False, "approvers": []}
                if task_name:  # Only fetch approval details for PRs that belong to tasks
                    approval_details = self.get_pr_approval_details(mr)
                
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
                    pipeline_status=pipeline_status,
                    user_has_approved=approval_details["user_has_approved"],
                    approvers=approval_details["approvers"]
                )
                repo_prs.append(pr)
                
        except Exception as e:
            logger.error(f"Error fetching PRs for repository {repo_url}: {str(e)}")
        return repo_prs

    def fetch_prs(self, repo_urls: List[str], 
                  limit_per_repo: int = 30,
                  include_pipeline_status: bool = True,
                  recent_only: bool = True) -> List[PR]:
        """Fetch PRs from multiple GitLab repositories concurrently with smart limits."""
        all_prs = []
        # Limit concurrent requests to avoid overwhelming GitLab API
        max_workers = min(len(repo_urls), 8)
        
        logger.info(f"Fetching PRs from {len(repo_urls)} repositories with {max_workers} workers")
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_url = {
                executor.submit(
                    self._fetch_prs_for_repo, 
                    repo_url, 
                    limit_per_repo,
                    include_pipeline_status,
                    recent_only
                ): repo_url 
                for repo_url in repo_urls
            }
            
            for future in concurrent.futures.as_completed(future_to_url):
                repo_url = future_to_url[future]
                try:
                    repo_prs = future.result()
                    all_prs.extend(repo_prs)
                    logger.debug(f"Got {len(repo_prs)} PRs from {repo_url}")
                except Exception as exc:
                    logger.error(f"Repository {repo_url} generated an exception during PR fetching: {exc}")
        
        logger.info(f"Total PRs fetched: {len(all_prs)}")
        return all_prs

    def unify_prs(self, prs: List[PR], include_single_pr_tasks: bool = False) -> List[UnifiedPR]:
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
            # For full loads, include all tasks; for fast loads, only multi-PR tasks
            if include_single_pr_tasks or len(grouped_prs) > 1:
                # Determine overall status
                status = 'open'
                if all(pr.state == 'merged' for pr in grouped_prs):
                    status = 'merged'
                elif all(pr.state == 'closed' for pr in grouped_prs):
                    status = 'closed'
                
                # Calculates total changes and comments
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
        
        logger.info(f"Created {len(unified_prs)} unified PR views (include_single: {include_single_pr_tasks})")
        return unified_prs