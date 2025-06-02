from fastapi import APIRouter, Depends, HTTPException, Query, Body, Header
from typing import List, Optional
from pydantic import BaseModel
from ..models.pr import PR, UnifiedPR
from ..services.pr_service import PRService
from ..config import get_gitlab_client
import logging

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/prs", tags=["pull-requests"])

class ApproveRequest(BaseModel):
    repo_urls: List[str]

def get_pr_service(x_gitlab_token: str = Header(...)) -> PRService:
    try:
        gitlab_client = get_gitlab_client(token=x_gitlab_token)
        return PRService(gitlab_client)
    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Failed to initialize PRService: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initialize GitLab service.")

@router.get("/unified", response_model=List[UnifiedPR])
async def get_unified_prs(
    repo_urls: List[str] = Query(..., description="List of repository URLs to fetch PRs from"),
    limit_per_repo: Optional[int] = Query(30, description="Maximum PRs to fetch per repository (default: 30)"),
    include_pipeline_status: bool = Query(True, description="Whether to include pipeline status"),
    recent_only: bool = Query(True, description="Only fetch PRs updated in last 30 days"),
    full_load: bool = Query(False, description="Full load - get all data without restrictions"),
    pr_service: PRService = Depends(get_pr_service)
):
    """Get unified PR views for multiple repositories with performance optimizations."""
    try:
        # For full loads, override limits and restrictions
        if full_load:
            limit_per_repo = 100  # Much higher limit
            recent_only = False   # Get all PRs, not just recent
            logger.info(f"Full load requested for {len(repo_urls)} repositories")
        else:
            logger.info(f"Fetching unified PRs for {len(repo_urls)} repositories (limit: {limit_per_repo}, recent_only: {recent_only})")
        
        for i, url in enumerate(repo_urls):
            logger.info(f"Repository {i+1}: {url}")
        
        prs = pr_service.fetch_prs(
            repo_urls, 
            limit_per_repo=limit_per_repo,
            include_pipeline_status=include_pipeline_status,
            recent_only=recent_only
        )
        logger.info(f"Successfully fetched {len(prs)} PRs from repositories")
        
        # For full loads, include all tasks (even single-PR tasks), TODO: remove single PR functionality
        unified_prs = pr_service.unify_prs(prs, include_single_pr_tasks=full_load)
        logger.info(f"Created {len(unified_prs)} unified PR views")
        
        return unified_prs
    except Exception as e:
        logger.error(f"Error in get_unified_prs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/unified/fast", response_model=List[UnifiedPR])
async def get_unified_prs_fast(
    repo_urls: List[str] = Query(..., description="List of repository URLs to fetch PRs from"),
    pr_service: PRService = Depends(get_pr_service)
):
    """Faster endpoint for initial load - minimal data, recent PRs only."""
    try:
        logger.info(f"Fast fetching unified PRs for {len(repo_urls)} repositories")
        
        # Use aggressive limits for fastest initial load
        prs = pr_service.fetch_prs(
            repo_urls, 
            limit_per_repo=15,  # Very limited
            include_pipeline_status=False,  # Skip pipeline status for speed
            recent_only=True  # Only recent PRs
        )
        logger.info(f"Fast fetch: got {len(prs)} PRs")
        
        # For fast mode, only show multi-PR tasks
        unified_prs = pr_service.unify_prs(prs, include_single_pr_tasks=False)
        logger.info(f"Fast fetch: created {len(unified_prs)} unified PR views")
        
        return unified_prs
    except Exception as e:
        logger.error(f"Error in get_unified_prs_fast: {str(e)}")
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
        
        # Filter PRs for the specific task
        task_prs = [pr for pr in prs if pr.task_name == task_name]
        logger.info(f"Found {len(prs)} total PRs, {len(task_prs)} for task {task_name}")
        
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