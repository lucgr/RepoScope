from fastapi import APIRouter, Depends, HTTPException, Body, Header, BackgroundTasks
from fastapi.responses import FileResponse
# from ..models.pr import VirtualWorkspaceResponse
from ..services.workspace_service import WorkspaceService
import logging
import shutil
import os
import tempfile
import time

# Configure logger
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

# Helper function for cleanup, to be run in the background
def cleanup_files(workspace_path: str, zip_path: str):
    if workspace_path and os.path.exists(workspace_path):
        try:
            shutil.rmtree(workspace_path)
            logger.info(f"Successfully cleaned up workspace directory in background: {workspace_path}")
        except Exception as e:
            # Log error, but don't let it affect the main response flow
            logger.error(f"Background error cleaning up workspace directory {workspace_path}: {e}")
    
    if zip_path and os.path.exists(zip_path):
        try:
            os.remove(zip_path)
            logger.info(f"Successfully cleaned up zip file in background: {zip_path}")
        except Exception as e:
            logger.error(f"Background error cleaning up zip file {zip_path}: {e}")

def get_workspace_service():
    return WorkspaceService()

@router.post("/create")
async def create_virtual_workspace(
    background_tasks: BackgroundTasks,
    request: dict = Body(...),
    workspace_service: WorkspaceService = Depends(get_workspace_service),
    x_gitlab_token: str = Header(None)
):
    """Create a virtual workspace, zips it, and returns it for download."""
    workspace_dir_path_for_cleanup = None
    zip_file_path_for_cleanup = None
    try:
        logger.info("🚀 Starting workspace creation request")
        logger.info(f"📦 Request payload: {request}")
        
        branch_name = request.get('branch_name')
        task_name = request.get('task_name')
        repo_urls = request.get('repo_urls', [])
        workspace_name = request.get('workspace_name')
        script_content = request.get('script_content')
        
        logger.info(f"📋 Parsed parameters: branch={branch_name}, task={task_name}, repos={len(repo_urls)}, workspace={workspace_name}")
        
        if not x_gitlab_token:
            logger.warning("❌ Missing GitLab token")
            # Still return JSON for errors
            raise HTTPException(status_code=401, detail="X-Gitlab-Token header is required.")

        if not branch_name or not task_name or not repo_urls:
            logger.warning(f"❌ Missing required fields: branch={branch_name}, task={task_name}, repos={repo_urls}")
            raise HTTPException(status_code=400, detail="Missing required fields")
            
        logger.info(f"✅ Creating virtual workspace for branch {branch_name} with {len(repo_urls)} repositories")
        
        service_response = workspace_service.create_virtual_workspace(
            branch_name=branch_name,
            task_name=task_name,
            repo_urls=repo_urls,
            workspace_name=workspace_name,
            script_content=script_content,
            gitlab_token=x_gitlab_token
        )
        
        logger.info(f"📝 Workspace service response: {service_response.get('status')}")
        
        if service_response["status"] == "error":
            logger.error(f"❌ Workspace service error: {service_response.get('message')}")
            raise HTTPException(status_code=500, detail=service_response.get("message", "Unknown error creating workspace."))
        
        workspace_dir_path = service_response["workspace_dir_path"]
        safe_name = service_response["safe_name"]
        workspace_dir_path_for_cleanup = workspace_dir_path # Keep track for potential background cleanup

        logger.info(f"✅ Workspace created at: {workspace_dir_path}")
        
        # Zip the created workspace directory
        # base_name for shutil.make_archive should be /path/to/output_zip_filename (without .zip)
        # root_dir is the directory *containing* the directory to be zipped (service_response["workspace_root_for_zipping"])
        # base_dir is the actual directory to zip (safe_name)
        # Example: zip /tmp/virtual_workspaces/my_safe_workspace
        #   base_name = /tmp/my_safe_workspace_zip_output (will create my_safe_workspace_zip_output.zip)
        #   root_dir  = /tmp/virtual_workspaces
        #   base_dir  = my_safe_workspace (this is safe_name)

        # Determine the parent directory of workspace_dir_path for root_dir argument
        archive_root_dir = os.path.dirname(workspace_dir_path)
        # The directory to be archived is the last component of workspace_dir_path (safe_name)
        archive_base_dir = os.path.basename(workspace_dir_path)

        # Define where the zip file will be created temporarily
        # Needs to be in a place the app can write, /tmp is good in Cloud Run
        temp_zip_base_path = os.path.join(tempfile.gettempdir(), f"{safe_name}_archive_{int(time.time())}")

        logger.info(f"📦 Starting ZIP creation: {workspace_dir_path} -> {temp_zip_base_path}.zip")
        try:
            zip_file_path = shutil.make_archive(
                base_name=temp_zip_base_path, 
                format='zip',              
                root_dir=archive_root_dir,  
                base_dir=archive_base_dir  
            )
            zip_file_path_for_cleanup = zip_file_path # Keep track for potential background cleanup

            logger.info(f"✅ Successfully created zip file: {zip_file_path} ({os.path.getsize(zip_file_path)} bytes)")

            # Log performance metrics if available
            if "performance" in service_response:
                perf = service_response["performance"]
                logger.info(f"📊 Workspace performance: {perf['total_duration']}s total, {perf['submodule_duration']}s submodules, {perf['repo_count']} repos, {perf['successful_repos']} successful")

            # Add cleanup tasks to run after the response is sent
            background_tasks.add_task(cleanup_files, workspace_dir_path_for_cleanup, zip_file_path_for_cleanup)

            logger.info(f"📤 Sending ZIP file response: {safe_name}.zip")
            return FileResponse(
                path=zip_file_path, 
                media_type='application/zip', 
                filename=f"{safe_name}.zip",  # Use the clean name (without timestamp) for the downloaded file
                # FileResponse will delete the file if it's in a temp directory on some OS, 
                # but explicit cleanup is better for clarity / cross-platform.
            )
        except Exception as e:
            logger.error(f"Failed to create or send zip file: {str(e)}")
            if workspace_dir_path_for_cleanup:
                # Don't try to clean up immediately, might cause more issues
                # Just log the error and let the cleanup happen in the next run
                logger.warning(f"Leaving workspace directory for delayed cleanup: {workspace_dir_path_for_cleanup}")
            raise HTTPException(status_code=500, detail=f"Failed to create workspace archive: {str(e)}")

    except HTTPException: # Re-raise HTTPExceptions directly to preserve status code and detail
        raise
    except Exception as e:
        logger.error(f"Unhandled error in create_virtual_workspace endpoint: {str(e)}", exc_info=True)
        # If an error occurs before FileResponse, still attempt cleanup if paths were set
        if workspace_dir_path_for_cleanup or zip_file_path_for_cleanup:
             cleanup_files(workspace_dir_path_for_cleanup, zip_file_path_for_cleanup)
        # Return a JSON error response for unexpected errors
        raise HTTPException(status_code=500, detail=f"An unexpected server error occurred: {str(e)}")
    # The finally block is removed; cleanup is handled by BackgroundTasks or in the main exception handler for pre-response errors 