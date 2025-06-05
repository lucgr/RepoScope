from typing import List, Dict
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
        patterns_config = [
            # Renovate branches: group by "renovate/module"
            # e.g. renovate/requests -> RENOVATE/REQUESTS
            # e.g. renovate/github.com/user/repo -> RENOVATE/GITHUB.COM
            # This captures "renovate/" followed by characters until the next slash or end of string.
            {'regex': r'^(renovate\/[^\/]+)', 'task_group_index': 1},
            # General pattern: any_string/any_string_with_dots_numbers_and_hyphens
            {'regex': r'^([a-zA-Z_\\-]+)/([a-zA-Z0-9_\\.\\-]+)', 'task_group_index': 2},
            # JIRA-style with more prefixes (e.g., feature/ABC-123)
            {'regex': r'^(feature|bug|bugfix|hotfix|fix|chore|task)/([A-Z]+-\\d+)', 'task_group_index': 2},
             # Numeric with more prefixes (e.g., feature/123)
            {'regex': r'^(feature|bug|bugfix|hotfix|fix|chore|task)/(\\d+)', 'task_group_index': 2},
            # Just ticket number (e.g., ABC-123)
            {'regex': r'^([A-Z]+-\\d+)', 'task_group_index': 1},
        ]
        
        for config in patterns_config:
            pattern = config['regex']
            task_group_index = config['task_group_index']
            match = re.match(pattern, branch_name, re.IGNORECASE)
            if match:
                # Ensure the desired group exists
                if len(match.groups()) >= task_group_index:
                    extracted_name = match.group(task_group_index)
                    return extracted_name.upper() # Standardize to uppercase
                # Fallback for patterns where group 1 is the main capture if group 'task_group_index' not found (should not happen with correct config)
                elif match.group(1):
                     return match.group(1).upper()

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

    def get_pr_approval_details(self, mr_object) -> dict:
        """Get approval details for a given merge request object."""
        user_has_approved = False
        approvers_list = []
        try:
            # Get the approval data - this returns the full detailed approval information
            logger.debug(f"Getting approvals for MR {mr_object.iid}")
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
        """Helper function to fetch PRs for a single repository with smarter limits."""
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
            
            # Limit to exactly what is needed
            merge_requests = merge_requests[:limit]
            
            logger.info(f"Fetched {len(merge_requests)} MRs from {repo_url}")
            
            # Process MRs into PRs
            for mr in merge_requests:
                task_name = self.extract_task_name(mr.source_branch)
                
                pipeline_status_str = None
                if include_pipeline_status:
                    try:
                        # Attempt to get status from head_pipeline attribute
                        if hasattr(mr, 'head_pipeline') and mr.head_pipeline and 'status' in mr.head_pipeline:
                            pipeline_status_str = mr.head_pipeline['status']
                            # logger.info(f"For MR {mr.iid} in {project.name}, head_pipeline status: {pipeline_status_str}")
                        else:
                            # Fallback: get the latest pipeline for the MR's source branch if head_pipeline is not available
                            # This might involve an extra API call per MR if head_pipeline is not populated in list view
                            # To be cautious, ensure the mr object is not lazy-loaded for pipelines()
                            mr_for_pipeline = project.mergerequests.get(mr.iid) # Get a full MR object
                            pipelines = mr_for_pipeline.pipelines.list(get_all=False, page=1, per_page=1)
                            if pipelines:
                                pipeline_status_str = pipelines[0].status
                                logger.info(f"For MR {mr.iid} in {project.name}, fallback pipeline status: {pipeline_status_str}")
                            else:
                                logger.info(f"For MR {mr.iid} in {project.name}, no pipelines found for source branch.")
                    except Exception as e:
                        logger.warning(f"Could not fetch pipeline status for MR {mr.iid} in {project.name}: {e}")
                
                # Only get approval details if we have a task name to reduce unnecessary API calls
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
                    pipeline_status=pipeline_status_str,
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
        # Limit concurrent requests
        max_workers = min(len(repo_urls), 10) # TODO: maybe test out different values here
        
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

    def unify_prs(self, prs: List[PR]) -> List[UnifiedPR]:
        """Unify PRs by task name and then by identical branch names for unmatched PRs."""
        unified_prs_map: Dict[str, List[PR]] = {}
        prs_without_task_name: List[PR] = []

        for pr in prs:
            if pr.task_name:
                if pr.task_name not in unified_prs_map:
                    unified_prs_map[pr.task_name] = []
                unified_prs_map[pr.task_name].append(pr)
            else:
                prs_without_task_name.append(pr)

        unified_prs_list = []
        for task_name, task_prs in unified_prs_map.items():
            if len(task_prs) > 1:
                total_changes = sum(getattr(pr_item, 'changes_count', 0) for pr_item in task_prs)
                total_comments = sum(getattr(pr_item, 'comments_count', 0) for pr_item in task_prs)
                
                current_status = 'open' # Default status
                if all(pr_item.state == 'merged' for pr_item in task_prs):
                    current_status = 'merged'
                elif all(pr_item.state == 'closed' for pr_item in task_prs): # Check if all are closed (and not all merged)
                    current_status = 'closed'
                
                unified_prs_list.append(UnifiedPR(
                    task_name=task_name, 
                    prs=task_prs,
                    total_changes=total_changes,
                    total_comments=total_comments,
                    status=current_status
                ))
        
        unified_prs_list.sort(key=lambda x: x.task_name)

        branch_matched_prs_map: Dict[str, List[PR]] = {}
        for pr in prs_without_task_name:
            if self.extract_task_name(pr.source_branch) is None:
                branch_key = pr.source_branch 
                if branch_key not in branch_matched_prs_map:
                    branch_matched_prs_map[branch_key] = []
                branch_matched_prs_map[branch_key].append(pr)

        branch_unified_prs_list = []
        for branch_name_key, branch_prs_group in branch_matched_prs_map.items():
            if len(branch_prs_group) > 1: 
                display_task_name = f"Branch: {branch_name_key}"
                total_changes = sum(getattr(pr_item, 'changes_count', 0) for pr_item in branch_prs_group)
                total_comments = sum(getattr(pr_item, 'comments_count', 0) for pr_item in branch_prs_group)

                current_status = 'open' # Default status
                if all(pr_item.state == 'merged' for pr_item in branch_prs_group):
                    current_status = 'merged'
                elif all(pr_item.state == 'closed' for pr_item in branch_prs_group):
                    current_status = 'closed'

                branch_unified_prs_list.append(UnifiedPR(
                    task_name=display_task_name, 
                    prs=branch_prs_group,
                    total_changes=total_changes,
                    total_comments=total_comments,
                    status=current_status
                ))
        
        branch_unified_prs_list.sort(key=lambda x: x.task_name)
        
        final_unified_prs = unified_prs_list + branch_unified_prs_list
        
        logger.info(f"Unified {len(prs)} PRs into {len(final_unified_prs)} tasks/groups. Task-based: {len(unified_prs_list)}, Branch-based: {len(branch_unified_prs_list)}")
        return final_unified_prs