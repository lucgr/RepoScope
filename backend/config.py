from dotenv import load_dotenv
import os
import gitlab

# Load environment variables
load_dotenv()

# Initialize GitLab client
gitlab_token = os.getenv("GITLAB_TOKEN")
if not gitlab_token:
    raise ValueError("GITLAB_TOKEN environment variable is not set")

gl = gitlab.Gitlab(
    url=os.getenv("GITLAB_URL", "https://gitlab.com"),
    private_token=gitlab_token
) 