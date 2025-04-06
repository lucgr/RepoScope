from fastapi import APIRouter, Depends, HTTPException
from typing import List
from ..models.pr import PR, UnifiedPR
from ..services.pr_service import PRService
from ..main import gl

router = APIRouter(prefix="/api/prs", tags=["pull-requests"])

def get_pr_service():
    return PRService(gl)

@router.get("/unified", response_model=List[UnifiedPR])
async def get_unified_prs(
    project_ids: List[int],
    pr_service: PRService = Depends(get_pr_service)
):
    """Get unified PR views for multiple projects."""
    try:
        prs = pr_service.fetch_prs(project_ids)
        unified_prs = pr_service.unify_prs(prs)
        return unified_prs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{project_id}", response_model=List[PR])
async def get_project_prs(
    project_id: int,
    pr_service: PRService = Depends(get_pr_service)
):
    """Get all PRs for a specific project."""
    try:
        return pr_service.fetch_prs([project_id])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/approve")
async def approve_unified_prs(
    task_name: str,
    project_ids: List[int],
    pr_service: PRService = Depends(get_pr_service)
):
    """Approve all PRs associated with a task name."""
    try:
        prs = pr_service.fetch_prs(project_ids)
        task_prs = [pr for pr in prs if pr.task_name == task_name]
        
        for pr in task_prs:
            try:
                project = gl.projects.get(pr.id)
                mr = project.mergerequests.get(pr.iid)
                mr.approve()
            except Exception as e:
                print(f"Error approving PR {pr.iid}: {e}")
                continue
                
        return {"message": f"Approved PRs for task {task_name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) 