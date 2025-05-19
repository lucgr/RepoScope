from fastapi import APIRouter, HTTPException, Body
from pydantic import BaseModel, Field
from typing import List, Literal, Dict, Any

# Assuming dependency_checker.py will be placed in a 'services' directory
# relative to the 'backend' directory, or that PYTHONPATH is set up accordingly.
# If dependency_checker.py is at the root of 'backend', it might be:
# from ..dependency_checker import analyze_dependencies
# For now, let's assume a services layer:
from ..services.dependency_checker import analyze_dependencies 
# If services doesn't exist, and dependency_checker.py is alongside api, pr_routes etc.
# then it might be: from ..dependency_checker import analyze_dependencies
# This needs to be adjusted based on actual location of dependency_checker.py

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dependencies", tags=["dependencies"])

class ProjectDependencyInfo(BaseModel):
    id: str = Field(..., description="Unique identifier for the project (e.g., repository name).")
    type: Literal['go', 'python'] = Field(..., description="Type of the project.")
    content: str = Field(..., description="Full content of the dependency file (go.mod or requirements.txt).")
    # 'path' is omitted as it's not expected to be used by the content-based parser in a generic API context

class DependencyCheckRequest(BaseModel):
    projects: List[ProjectDependencyInfo] = Field(..., description="List of projects to analyze.")

class DependencyVersionInfo(BaseModel):
    project_id: str
    version: str

class DiscrepancyReportItem(BaseModel):
    dependency_name: str
    versions: List[DependencyVersionInfo]

class ErrorReportItem(BaseModel):
    project_id: str
    type: Literal['go', 'python', 'unknown'] = 'unknown'
    error: str

class DependencyCheckResponse(BaseModel):
    discrepancies: List[DiscrepancyReportItem]
    errors: List[ErrorReportItem]


@router.post("/check", response_model=DependencyCheckResponse)
async def check_project_dependencies(
    request_data: DependencyCheckRequest = Body(...)
):
    """
    Analyzes dependencies for a list of projects (Go or Python) and reports discrepancies.
    Expects a JSON payload with a "projects" key, where each project has an "id", 
    "type" ('go' or 'python'), and "content" (the dependency file content).
    """
    try:
        # The projects_data format for analyze_dependencies expects a list of dicts.
        # Pydantic models can be converted to dicts.
        projects_data_for_analysis = [project.model_dump() for project in request_data.projects]
        
        logger.info(f"Received request to check dependencies for {len(projects_data_for_analysis)} projects.")

        # In a FastAPI context, 'use_go_cli_if_available' should typically be False,
        # as the Go CLI toolchain is unlikely to be reliably available in the server environment
        # unless specifically provisioned. The 'path' attribute for Go projects is also
        # not used by the content parser.
        results = analyze_dependencies(projects_data_for_analysis, use_go_cli_if_available=False)
        
        logger.info(f"Dependency analysis complete. Found {len(results.get('discrepancies',[]))} discrepancies and {len(results.get('errors',[]))} errors.")
        
        # Ensure the response matches the Pydantic model
        # The analyze_dependencies function returns a dict that should match this structure.
        return DependencyCheckResponse(**results)

    except Exception as e:
        logger.error(f"Unhandled error in /check_dependencies endpoint: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected server error occurred: {str(e)}")

# To make this router usable, it needs to be included in your main FastAPI application.
# For example, in your main app.py or similar:
# from .api import dependency_routes  # Adjust import path as needed
# app.include_router(dependency_routes.router) 