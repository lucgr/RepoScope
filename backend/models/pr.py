from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class PRBase(BaseModel):
    title: str
    description: str
    source_branch: str
    target_branch: str
    state: str
    created_at: datetime
    updated_at: datetime
    web_url: str
    repository_name: str
    repository_url: str

class PR(PRBase):
    id: int
    iid: int
    author: dict
    assignees: List[dict]
    labels: List[str]
    task_name: Optional[str] = None
    pipeline_status: Optional[str] = None  # "success", "failed", "running", "pending", or None
    changes_count: int = 0
    comments_count: int = 0
    user_has_approved: Optional[bool] = None
    approvers: Optional[List[dict]] = None

class UnifiedPR(BaseModel):
    task_name: str
    prs: List[PR]
    total_changes: int
    total_comments: int
    status: str  # 'open', 'merged', 'closed'

class VirtualWorkspaceRequest(BaseModel):
    branch_name: str
    task_name: str
    workspace_name: Optional[str] = None
    repo_urls: List[str]

class VirtualWorkspaceResponse(BaseModel):
    status: str
    message: str
    clone_url: Optional[str] = None
    clone_command: Optional[str] = None