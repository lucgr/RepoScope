from fastapi import APIRouter, Depends, HTTPException, Body, Header, BackgroundTasks
from fastapi.responses import FileResponse
# from ..models.pr import VirtualWorkspaceResponse
from ..services.workspace_service import WorkspaceService
import logging
import shutil
import os
import tempfile
import time
import zipfile

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

def create_zip_excluding_git_folders(zip_file_path: str, root_dir: str, base_dir: str, logger_instance):
    """
    Creates a zip file from base_dir, excluding .git folders from submodules.
    zip_file_path: Full path for the output zip file.
    root_dir: The directory that base_dir is relative to. Files in zip will be relative to this.
    base_dir: The specific directory to archive.
    logger_instance: Logger for logging messages.
    """
    workspace_to_archive = os.path.join(root_dir, base_dir)
    logger_instance.info(f"Starting custom zip creation for {workspace_to_archive}, excluding submodule .git folders.")
    
    with zipfile.ZipFile(zip_file_path, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for dirpath, dirnames, filenames in os.walk(workspace_to_archive, topdown=True):
            # Exclude .git directories from submodules
            # dirpath is the current directory being walked.
            # workspace_to_archive is the root of the workspace (e.g., /tmp/virtual_workspaces/task_xyz_123)
            # We want to include the main .git directory of the workspace itself,
            # but exclude .git directories from any sub-directories (if they were to exist).
            if '.git' in dirnames and dirpath != workspace_to_archive:
                logger_instance.info(f"Excluding .git folder found in {os.path.join(dirpath, '.git')}")
                dirnames.remove('.git') # Don't descend into this .git directory
                
            for filename in filenames:
                file_path_absolute = os.path.join(dirpath, filename)
                # arcname should be relative to root_dir, ensuring paths in zip start with base_dir
                arcname = os.path.relpath(file_path_absolute, root_dir)
                try:
                    zf.write(file_path_absolute, arcname)
                except FileNotFoundError:
                    logger_instance.warning(f"File not found during zipping, possibly a broken symlink or temp file: {file_path_absolute}")


            # Add empty directories that might have become empty after .git exclusion
            # or were empty to begin with (like our uninitialized submodules).
            if not filenames and not dirnames: 
                arc_dir_path = os.path.relpath(dirpath, root_dir)
                # Create a ZipInfo object for the directory to ensure it's explicitly created in the zip
                dir_info = zipfile.ZipInfo(arc_dir_path + '/') 
                # Basic directory permissions (drwxr-xr-x). os.walk doesn't give perms for empty dirs easily.
                dir_info.external_attr = 0o40755 << 16 
                # Ensure we are not trying to add the root of the archive itself as an empty dir entry
                # if base_dir is not empty. If base_dir itself is an empty folder, it should be added.
                # An empty base_dir (workspace) is unlikely but technically possible.
                # The check os.path.join(root_dir, arc_dir_path) != workspace_to_archive or not os.listdir(workspace_to_archive)
                # ensures that if the current dirpath IS the workspace_to_archive, it's only added if it's truly empty.
                # More simply, just add any empty dir found.
                zf.writestr(dir_info, '')

    logger_instance.info(f"Custom zip creation completed for {zip_file_path}")
    return zip_file_path

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
        branch_name = request.get('branch_name')
        task_name = request.get('task_name')
        repo_urls = request.get('repo_urls', [])
        workspace_name = request.get('workspace_name')
        script_content = request.get('script_content')
        
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
        
        if service_response["status"] == "error":
            logger.error(f"❌ Workspace service error: {service_response.get('message')}")
            raise HTTPException(status_code=500, detail=service_response.get("message", "Unknown error creating workspace."))
        
        workspace_dir_path = service_response["workspace_dir_path"]
        safe_name = service_response["safe_name"]
        workspace_dir_path_for_cleanup = workspace_dir_path # Keep track for potential background cleanup
        
        # Determine the parent directory of workspace_dir_path for root_dir argument
        archive_root_dir = os.path.dirname(workspace_dir_path)
        # The directory to be archived is the last component of workspace_dir_path
        archive_base_dir = os.path.basename(workspace_dir_path)

        # Define where the zip file will be created temporarily
        # Needs to be in a place the app can write, /tmp is good in Cloud Run
        temp_zip_base_path = os.path.join(tempfile.gettempdir(), f"{safe_name}_archive_{int(time.time())}")
        zip_file_target_path = f"{temp_zip_base_path}.zip" # Path for the final zip file

        logger.info(f"📦 Starting ZIP creation: {workspace_dir_path} -> {zip_file_target_path}") # TODO: do actual time measurements here
        try:
            # zip_file_path = shutil.make_archive(
            #     base_name=temp_zip_base_path, 
            #     format='zip',              
            #     root_dir=archive_root_dir,  
            #     base_dir=archive_base_dir  
            # )
            zip_file_path = create_zip_excluding_git_folders(
                zip_file_path=zip_file_target_path, # Pass the full target path
                root_dir=archive_root_dir,
                base_dir=archive_base_dir,
                logger_instance=logger
            )
            zip_file_path_for_cleanup = zip_file_path # Keep track for potential background cleanup

            # Log performance metrics if available
            if "performance" in service_response:
                perf = service_response["performance"]
                logger.info(f"Workspace performance: {perf['total_duration']}s total, {perf['submodule_duration']}s submodules, {perf['repo_count']} repos, {perf['successful_repos']} successful")

            # Add cleanup tasks to run after the response is sent
            background_tasks.add_task(cleanup_files, workspace_dir_path_for_cleanup, zip_file_path_for_cleanup)

            return FileResponse(
                path=zip_file_path, 
                media_type='application/zip', 
                filename=f"{safe_name}.zip",  # Use the clean name (without timestamp) for the downloaded file
            )
        except Exception as e:
            logger.error(f"Failed to create or send zip file: {str(e)}")
            if workspace_dir_path_for_cleanup:
                # Don't try to clean up immediately, might cause more issues
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