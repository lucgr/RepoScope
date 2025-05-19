from fastapi import APIRouter, Depends, HTTPException, Body, Header
from ..services.dependency_service import DependencyService
import logging

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dependencies", tags=["dependencies"])

def get_dependency_service():
    return DependencyService()

@router.post("/check")
async def check_dependencies(
    request: dict = Body(...),
    dependency_service: DependencyService = Depends(get_dependency_service),
    x_gitlab_token: str = Header(None)
):
    """Check dependencies across selected repositories and identify mismatches."""
    try:
        repo_urls = request.get('repo_urls', [])
        # Accept repo_branches - a dict mapping repo_urls to branches
        repo_branches = request.get('repo_branches', {})
        
        if not x_gitlab_token:
            raise HTTPException(status_code=401, detail="X-Gitlab-Token header is required.")

        if not repo_urls:
            raise HTTPException(status_code=400, detail="No repositories provided")
            
        logger.info(f"Checking dependencies across {len(repo_urls)} repositories with specific branches")
        
        result = dependency_service.check_dependencies(
            repo_urls=repo_urls,
            gitlab_token=x_gitlab_token,
            repo_branches=repo_branches
        )
        
        if result.get("status") == "error":
            raise HTTPException(status_code=500, detail=result.get("message", "Unknown error checking dependencies."))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unhandled error in check_dependencies endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected server error occurred: {str(e)}") 