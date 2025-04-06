from typing import List, Dict
import re
from ..models.pr import PR, UnifiedPR
import gitlab

class PRService:
    def __init__(self, gitlab_client: gitlab.Gitlab):
        self.gl = gitlab_client

    def extract_task_name(self, branch_name: str) -> str:
        """Extract task name from branch name using common patterns."""
        patterns = [
            r'^(feature|bugfix|hotfix)/([A-Z]+-\d+)',  # JIRA-style
            r'^(feature|bugfix|hotfix)/(\d+)',         # Numeric
            r'^([A-Z]+-\d+)',                          # Just ticket number
        ]
        
        for pattern in patterns:
            match = re.match(pattern, branch_name)
            if match:
                return match.group(2) if len(match.groups()) > 1 else match.group(1)
        return None

    def fetch_prs(self, project_ids: List[int]) -> List[PR]:
        """Fetch PRs from multiple GitLab projects."""
        all_prs = []
        
        for project_id in project_ids:
            try:
                project = self.gl.projects.get(project_id)
                merge_requests = project.mergerequests.list(state='opened', get_all=True)
                
                for mr in merge_requests:
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
                        task_name=self.extract_task_name(mr.source_branch)
                    )
                    all_prs.append(pr)
            except gitlab.exceptions.GitlabError as e:
                print(f"Error fetching PRs for project {project_id}: {e}")
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
                total_changes = sum(len(pr.changes) for pr in grouped_prs)
                total_comments = sum(len(pr.notes.list()) for pr in grouped_prs)
                
                # Determine overall status
                status = 'open'
                if all(pr.state == 'merged' for pr in grouped_prs):
                    status = 'merged'
                elif all(pr.state == 'closed' for pr in grouped_prs):
                    status = 'closed'
                
                unified_pr = UnifiedPR(
                    task_name=task_name,
                    prs=grouped_prs,
                    total_changes=total_changes,
                    total_comments=total_comments,
                    status=status
                )
                unified_prs.append(unified_pr)
        
        return unified_prs 