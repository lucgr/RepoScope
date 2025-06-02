from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.pr_routes import router as pr_router
from .api.workspace_routes import router as workspace_router
from .api.dependency_routes import router as dependency_router
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

app = FastAPI(title="MultiRepoHub API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(pr_router)
app.include_router(workspace_router)
app.include_router(dependency_router)

@app.get("/")
async def root():
    return {"message": "MultiRepoHub API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"} 