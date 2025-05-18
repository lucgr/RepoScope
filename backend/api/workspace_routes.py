from fastapi import APIRouter, Depends, HTTPException, Body, Header
from ..models.pr import VirtualWorkspaceResponse
from ..services.workspace_service import WorkspaceService
import logging

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

def get_workspace_service():
    return WorkspaceService()

@router.post("/create", response_model=VirtualWorkspaceResponse)
async def create_virtual_workspace(
    request: dict = Body(...),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
    x_gitlab_token: str = Header(None)
):
    """Create a virtual workspace with repositories as submodules."""
    try:
        # Extract required fields from the request
        branch_name = request.get('branch_name')
        task_name = request.get('task_name')
        repo_urls = request.get('repo_urls', [])
        workspace_name = request.get('workspace_name')
        script_content = request.get('script_content')
        
        if not x_gitlab_token:
            raise HTTPException(status_code=401, detail="X-Gitlab-Token header is required for creating workspaces with private repositories.")

        if not branch_name or not task_name or not repo_urls:
            raise HTTPException(status_code=400, detail="Missing required fields")
            
        logger.info(f"Creating virtual workspace for branch {branch_name} with {len(repo_urls)} repositories")
        
        response = workspace_service.create_virtual_workspace(
            branch_name=branch_name,
            task_name=task_name,
            repo_urls=repo_urls,
            workspace_name=workspace_name,
            script_content=script_content,
            gitlab_token=x_gitlab_token
        )
        
        if response.status == "error":
            raise HTTPException(status_code=500, detail=response.message)
            
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in create_virtual_workspace: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e)) 