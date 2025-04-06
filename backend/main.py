from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import gitlab
from .api.pr_routes import router as pr_router

# Load environment variables
load_dotenv()

app = FastAPI(title="Unified PR Viewer API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize GitLab client
gitlab_token = os.getenv("GITLAB_TOKEN")
if not gitlab_token:
    raise ValueError("GITLAB_TOKEN environment variable is not set")

gl = gitlab.Gitlab(
    url=os.getenv("GITLAB_URL", "https://gitlab.com"),
    private_token=gitlab_token
)

# Include routers
app.include_router(pr_router)

@app.get("/")
async def root():
    return {"message": "Unified PR Viewer API"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"} 