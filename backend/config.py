from dotenv import load_dotenv
import os
import gitlab
import logging
import sys
import requests

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize GitLab client with improved error handling
gitlab_token = os.getenv("GITLAB_TOKEN")
if not gitlab_token:
    raise ValueError("GITLAB_TOKEN environment variable is not set. Please set it in your .env file.")

gitlab_url = os.getenv("GITLAB_URL", "https://gitlab.com")

# Add logging to help diagnose issues
logger.info(f"Initializing GitLab client with URL: {gitlab_url}")
logger.info(f"Token present: {bool(gitlab_token)}")
logger.info(f"Token length: {len(gitlab_token) if gitlab_token else 0}")
logger.info(f"Token format: {'Valid format' if gitlab_token and len(gitlab_token) > 15 else 'Invalid format - too short'}")

gl = None  # Initialize to None

try:
    # First, try a simpler check with direct API call
    logger.info("Verifying token with direct API call...")
    response = requests.get(
        f"{gitlab_url}/api/v4/user",
        headers={"Authorization": f"Bearer {gitlab_token}"},
        timeout=10
    )
    
    if response.status_code == 200:
        user_info = response.json()
        logger.info(f"Direct API check successful. Username: {user_info.get('username')}")
        
        # Now initialize the gitlab client
        gl = gitlab.Gitlab(
            url=gitlab_url,
            private_token=gitlab_token,
            timeout=30
        )
        
        # Store the username from the API response in case gl.auth() returns None
        username = user_info.get('username')
        
        # Try the client's auth method, but don't fail if it returns None
        try:
            logger.info("Running gl.auth() as secondary verification...")
            user = gl.auth()
            if user is not None:
                logger.info(f"PyGitlab auth successful. Username: {user.username}")
            else:
                logger.warning("PyGitlab auth() returned None, but direct API check was successful.")
                logger.info(f"Using username from direct API call: {username}")
                # Continue anyway since the direct API call worked
        except Exception as auth_e:
            logger.warning(f"PyGitlab auth() failed, but direct API check was successful: {str(auth_e)}")
            # Continue anyway since the direct API call worked
    else:
        # The token is definitely invalid
        logger.error(f"Direct API verification failed with status {response.status_code}: {response.text}")
        error_detail = response.json() if response.headers.get('content-type') == 'application/json' else response.text
        raise ValueError(f"GitLab API rejected token with status {response.status_code}: {error_detail}")
        
except requests.RequestException as e:
    logger.error(f"Network error verifying GitLab token: {str(e)}")
    raise RuntimeError(f"Failed to connect to GitLab at {gitlab_url}: {str(e)}")
    
except ValueError as e:
    logger.error(f"GitLab authentication failed: {str(e)}")
    print("\n" + "="*80)
    print("GITLAB TOKEN ERROR: Your token appears to be invalid or expired.")
    print("Please check your .env file and update the GITLAB_TOKEN value.")
    print("You can generate a new token at: " + f"{gitlab_url}/-/profile/personal_access_tokens")
    print("Make sure the token has 'api' and 'read_api' scopes enabled.")
    print("="*80 + "\n")
    raise RuntimeError(f"Failed to authenticate with GitLab: {str(e)}")
    
except Exception as e:
    logger.error(f"Unexpected error during GitLab client initialization: {str(e)}")
    raise RuntimeError(f"Failed to initialize GitLab client: {str(e)}")

# Final check to ensure we have a valid GitLab client
if gl is None:
    raise RuntimeError("GitLab client initialization failed for unknown reasons")

logger.info("GitLab client successfully initialized and authenticated!")