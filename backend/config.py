from dotenv import load_dotenv
import os
import gitlab
import logging
import requests
from fastapi import HTTPException

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# GitLab URL (can still be set via .env or default)
gitlab_url = os.getenv("GITLAB_URL", "https://gitlab.com")

def get_gitlab_client(token: str) -> gitlab.Gitlab:
    if not token:
        logger.error("No GitLab token provided for client initialization.")
        raise HTTPException(status_code=401, detail="GitLab token not provided.")

    logger.info(f"Initializing GitLab client with URL: {gitlab_url}")
    logger.info(f"Token present: {bool(token)}")
    logger.info(f"Token length: {len(token)}")
    logger.info(f"Token format: {'Valid format' if len(token) > 15 else 'Invalid format - too short'}")

    try:
        # Checking token with direct API call
        logger.info("Verifying token with direct API call...")
        response = requests.get(
            f"{gitlab_url}/api/v4/user",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10
        )

        if response.status_code == 200:
            user_info = response.json()
            username = user_info.get('username')
            logger.info(f"Direct API check successful. Username: {username}")

            # Initialize the gitlab client
            client = gitlab.Gitlab(
                url=gitlab_url,
                private_token=token,
                timeout=30
            )

            try:
                user = client.auth()
                if user is not None:
                    logger.info(f"PyGitlab auth successful. Username: {user.username}")
                
                logger.info("GitLab client successfully initialized and authenticated!")
                return client
            except Exception as auth_e:
                logger.warning(f"PyGitlab auth() failed, but direct API check was successful: {str(auth_e)}")
                logger.info("GitLab client successfully initialized and authenticated (based on direct API call)!")
                return client # Still return client if direct API call worked

        else:
            logger.error(f"Direct API verification failed with status {response.status_code}: {response.text}")
            error_detail = response.json() if response.headers.get('content-type') == 'application/json' else response.text
            raise HTTPException(status_code=401, detail=f"GitLab API rejected token: {error_detail}")

    except requests.RequestException as e:
        logger.error(f"Network error verifying GitLab token: {str(e)}")
        raise HTTPException(status_code=503, detail=f"Network error connecting to GitLab: {str(e)}")
    except HTTPException as e: # Re-raise HTTPExceptions
        raise e
    except Exception as e:
        logger.error(f"Unexpected error during GitLab client initialization: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to initialize GitLab client: {str(e)}")