from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import List
from pydantic import BaseModel
from ..models.pr import PR, UnifiedPR
from ..services.pr_service import PRService
from ..config import gl
import logging

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prs", tags=["pull-requests"])

class ApproveRequest(BaseModel):
    repo_urls: List[str]

def get_pr_service():
    return PRService(gl)

@router.get("/unified", response_model=List[UnifiedPR])
async def get_unified_prs(
    repo_urls: List[str] = Query(..., description="List of repository URLs to fetch PRs from"),
    pr_service: PRService = Depends(get_pr_service)
):
    """Get unified PR views for multiple repositories."""
    try:
        prs = pr_service.fetch_prs(repo_urls)
        unified_prs = pr_service.unify_prs(prs)
        return unified_prs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{repo_url:path}", response_model=List[PR])
async def get_repo_prs(
    repo_url: str,
    pr_service: PRService = Depends(get_pr_service)
):
    """Get all PRs for a specific repository."""
    try:
        return pr_service.fetch_prs([repo_url])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/approve")
async def approve_unified_prs(
    task_name: str = Query(..., description="Task name to approve PRs for"),
    request: ApproveRequest = Body(...),
    pr_service: PRService = Depends(get_pr_service)
):
    """Approve all PRs associated with a task name."""
    try:
        logger.info(f"Approving PRs for task {task_name} in repositories: {request.repo_urls}")
        
        # Fetch all PRs from the repositories
        prs = pr_service.fetch_prs(request.repo_urls)
        logger.info(f"Found {len(prs)} total PRs")
        
        # Filter PRs for the specific task
        task_prs = [pr for pr in prs if pr.task_name == task_name]
        logger.info(f"Found {len(task_prs)} PRs for task {task_name}")
        
        if not task_prs:
            raise HTTPException(status_code=404, detail=f"No PRs found for task {task_name}")
        
        # Approve each PR
        for pr in task_prs:
            try:
                logger.info(f"Approving PR {pr.iid} in repository {pr.repository_name}")
                project = pr_service.get_project_from_url(pr.repository_url)
                mr = project.mergerequests.get(pr.iid)
                mr.approve()
                logger.info(f"Successfully approved PR {pr.iid}")
            except Exception as e:
                logger.error(f"Error approving PR {pr.iid}: {str(e)}")
                continue
                
        return {"message": f"Approved PRs for task {task_name}"}
    except Exception as e:
        logger.error(f"Error in approve_unified_prs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) 