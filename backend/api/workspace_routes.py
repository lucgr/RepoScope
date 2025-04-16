from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List
from pydantic import BaseModel
from ..models.pr import VirtualWorkspaceRequest, VirtualWorkspaceResponse
from ..services.workspace_service import WorkspaceService
import logging

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

def get_workspace_service():
    return WorkspaceService()

@router.post("/create", response_model=VirtualWorkspaceResponse)
async def create_virtual_workspace(
    request: VirtualWorkspaceRequest = Body(...),
    workspace_service: WorkspaceService = Depends(get_workspace_service)
):
    """Create a virtual workspace with repositories as submodules."""
    try:
        logger.info(f"Creating virtual workspace for branch {request.branch_name} with {len(request.repo_urls)} repositories")
        
        response = workspace_service.create_virtual_workspace(
            branch_name=request.branch_name,
            task_name=request.task_name,
            repo_urls=request.repo_urls
        )
        
        if response.status == "error":
            raise HTTPException(status_code=500, detail=response.message)
            
        return response
    except Exception as e:
        logger.error(f"Error in create_virtual_workspace: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) 