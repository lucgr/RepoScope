#!/bin/bash

# multi-repo.sh - A wrapper for managing multiple repositories in a virtual workspace
# This script provides easy command aliases and extensibility for operations across repos

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Display help information
function show_help {
    echo -e "${BLUE}=== Multi-Repo Operations Tool ===${NC}"
    echo -e "A wrapper for managing operations across multiple repositories in a virtual workspace"
    echo ""
    echo -e "Usage: ${YELLOW}multi-repo <command> [arguments]${NC}"
    echo ""
    echo -e "Available commands:"
    echo -e "  ${GREEN}commit${NC}    \"message\"      Commit changes across all repositories"
    echo -e "  ${GREEN}push${NC}                    Push all committed changes to remote repositories"
    echo -e "  ${GREEN}pull${NC}                    Pull changes for all repositories"
    echo -e "  ${GREEN}status${NC}                  Show status of all repositories"
    echo -e "  ${GREEN}checkout${NC}  branch-name   Checkout the specified branch in all repositories"
    echo -e "  ${GREEN}branch${NC}    branch-name   Create a new branch in all repositories"
    echo -e "  ${GREEN}pr${NC}        \"title\"       Create pull requests for all repositories with changes"
    echo -e "  ${GREEN}help${NC}                    Show this help message"
    echo ""
    echo -e "Example: ${YELLOW}multi-repo commit \"Add new feature\"${NC}"
}

# Check if we're in a virtual workspace
if [ ! -d ".git" ] || [ ! -f ".gitmodules" ]; then
    echo -e "${RED}Error: This does not appear to be a virtual workspace with submodules${NC}"
    echo -e "Please run this script from the root of your virtual workspace."
    exit 1
fi

# Check for command argument
if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

COMMAND=$1
shift  # Remove the command from the arguments

# Process commands
case "$COMMAND" in
    commit)
        # Check if commit message is provided
        if [ -z "$1" ]; then
            echo -e "${RED}Error: No commit message provided${NC}"
            echo -e "Usage: multi-repo commit \"Your commit message\""
            exit 1
        fi
        
        # Call the commit-submodules script
        ./commit-submodules.sh "$1"
        ;;
        
    push)
        echo -e "${BLUE}=== Pushing changes for all repositories ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Push changes in each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                echo -e "${BLUE}Pushing changes in ${YELLOW}$SUBMODULE${NC}"
                cd "$SUBMODULE" || continue
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                
                # Push changes
                git push origin "$CURRENT_BRANCH"
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        # Push changes in main repository
        echo -e "${BLUE}Pushing changes in main repository${NC}"
        MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        git push origin "$MAIN_BRANCH"
        
        echo -e "${GREEN}=== Push operation completed ===${NC}"
        ;;
        
    pull)
        echo -e "${BLUE}=== Pulling changes for all repositories ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Pull changes in each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                echo -e "${BLUE}Pulling changes in ${YELLOW}$SUBMODULE${NC}"
                cd "$SUBMODULE" || continue
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                
                # Pull changes
                git pull origin "$CURRENT_BRANCH"
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        # Pull changes in main repository
        echo -e "${BLUE}Pulling changes in main repository${NC}"
        MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        git pull origin "$MAIN_BRANCH"
        
        # Update submodules to ensure they're at the correct commit
        git submodule update
        
        echo -e "${GREEN}=== Pull operation completed ===${NC}"
        ;;
        
    status)
        echo -e "${BLUE}=== Checking status of all repositories ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # First check status of main repository
        echo -e "${BLUE}Main repository status:${NC}"
        git status -s
        echo ""
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Check status of each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                echo -e "${BLUE}Status of ${YELLOW}$SUBMODULE${NC}:"
                cd "$SUBMODULE" || continue
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                echo -e "${GREEN}On branch $CURRENT_BRANCH${NC}"
                
                # Show status
                git status -s
                echo ""
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        echo -e "${GREEN}=== Status check completed ===${NC}"
        ;;
        
    checkout)
        # Check if branch name is provided
        if [ -z "$1" ]; then
            echo -e "${RED}Error: No branch name provided${NC}"
            echo -e "Usage: multi-repo checkout <branch-name>"
            exit 1
        fi
        
        BRANCH_NAME=$1
        echo -e "${BLUE}=== Checking out branch '$BRANCH_NAME' in all repositories ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Checkout branch in each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                echo -e "${BLUE}Checking out branch in ${YELLOW}$SUBMODULE${NC}"
                cd "$SUBMODULE" || continue
                
                # Check if branch exists
                if git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
                    # Branch exists, check it out
                    git checkout $BRANCH_NAME
                    echo -e "  ${GREEN}Checked out existing branch: $BRANCH_NAME${NC}"
                else
                    # Ask if user wants to create the branch
                    echo -e "  ${YELLOW}Branch '$BRANCH_NAME' doesn't exist in $SUBMODULE. Create it? (y/n)${NC}"
                    read -r CREATE_BRANCH
                    
                    if [[ "$CREATE_BRANCH" =~ ^[Yy]$ ]]; then
                        git checkout -b $BRANCH_NAME
                        echo -e "  ${GREEN}Created and checked out new branch: $BRANCH_NAME${NC}"
                    else
                        echo -e "  ${YELLOW}Skipping branch checkout for $SUBMODULE${NC}"
                    fi
                fi
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        echo -e "${GREEN}=== Branch checkout operation completed ===${NC}"
        ;;
        
    branch)
        # Check if branch name is provided
        if [ -z "$1" ]; then
            echo -e "${RED}Error: No branch name provided${NC}"
            echo -e "Usage: multi-repo branch <branch-name>"
            exit 1
        fi
        
        BRANCH_NAME=$1
        echo -e "${BLUE}=== Creating branch '$BRANCH_NAME' in all repositories ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Create branch in each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                echo -e "${BLUE}Creating branch in ${YELLOW}$SUBMODULE${NC}"
                cd "$SUBMODULE" || continue
                
                # Check if branch already exists
                if git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
                    echo -e "  ${YELLOW}Branch '$BRANCH_NAME' already exists in $SUBMODULE${NC}"
                    echo -e "  ${YELLOW}Do you want to switch to it? (y/n)${NC}"
                    read -r SWITCH_BRANCH
                    
                    if [[ "$SWITCH_BRANCH" =~ ^[Yy]$ ]]; then
                        git checkout $BRANCH_NAME
                        echo -e "  ${GREEN}Switched to existing branch: $BRANCH_NAME${NC}"
                    else
                        echo -e "  ${YELLOW}Keeping current branch in $SUBMODULE${NC}"
                    fi
                else
                    # Create new branch
                    git checkout -b $BRANCH_NAME
                    echo -e "  ${GREEN}Created and checked out new branch: $BRANCH_NAME${NC}"
                fi
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        echo -e "${GREEN}=== Branch creation operation completed ===${NC}"
        ;;
        
    pr)
        # Check if PR title is provided
        if [ -z "$1" ]; then
            echo -e "${RED}Error: No PR title provided${NC}"
            echo -e "Usage: multi-repo pr \"Your PR title\""
            exit 1
        fi
        
        PR_TITLE=$1
        echo -e "${BLUE}=== Creating pull requests for repositories with changes ===${NC}"
        
        # Get current directory
        CURRENT_DIR=$(pwd)
        
        # First, ask for commit message (will use this for both commit and PR description)
        echo -e "${YELLOW}Enter commit message (will also be used as PR description):${NC}"
        read -r COMMIT_MESSAGE
        
        if [ -z "$COMMIT_MESSAGE" ]; then
            COMMIT_MESSAGE=$PR_TITLE
            echo -e "${YELLOW}Using PR title as commit message: ${COMMIT_MESSAGE}${NC}"
        fi
        
        # Use the commit message as PR description, but allow customization
        PR_DESCRIPTION=$COMMIT_MESSAGE
        echo -e "${YELLOW}Enter additional PR description (press Enter to use commit message):${NC}"
        read -r ADDITIONAL_DESCRIPTION
        
        if [ -n "$ADDITIONAL_DESCRIPTION" ]; then
            PR_DESCRIPTION="${PR_DESCRIPTION}\n\n${ADDITIONAL_DESCRIPTION}"
        fi
        
        echo -e "${YELLOW}Enter target branch (default: main):${NC}"
        read -r TARGET_BRANCH
        TARGET_BRANCH=${TARGET_BRANCH:-main}
        
        # Flag for GitLab vs GitHub detection
        IS_GITLAB=true
        echo -e "${YELLOW}Are you using GitLab? (y/n, default: y):${NC}"
        read -r USING_GITLAB
        if [[ "$USING_GITLAB" =~ ^[Nn]$ ]]; then
            IS_GITLAB=false
        fi
        
        # 1. First commit all changes in all submodules
        echo -e "${BLUE}=== Step 1: Committing changes in all repositories ===${NC}"
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        CHANGES_MADE=false
        
        for SUBMODULE in $SUBMODULES; do
            echo -e "${BLUE}Checking ${YELLOW}$SUBMODULE${NC}"
            
            # Check if submodule directory exists
            if [ ! -d "$SUBMODULE" ]; then
                echo -e "  ${RED}Submodule directory does not exist. Skipping.${NC}"
                continue
            fi
            
            # Navigate to submodule
            cd "$SUBMODULE" || continue
            
            # Check for changes
            if git status --porcelain | grep -q .; then
                echo -e "  ${GREEN}Changes detected in $SUBMODULE${NC}"
                
                # Show changes 
                git status --short
                
                # Check if we're in detached HEAD state
                if git symbolic-ref -q HEAD >/dev/null; then
                    # Not in detached HEAD state, get current branch
                    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                    echo -e "  ${GREEN}On branch $CURRENT_BRANCH${NC}"
                else
                    # We're in detached HEAD state
                    echo -e "  ${YELLOW}Detached HEAD state detected${NC}"
                    
                    # Extract task name from the PR title if possible
                    TASK_NAME=$(echo "$PR_TITLE" | grep -o '[A-Z]\+-[0-9]\+' | head -1)
                    if [ -n "$TASK_NAME" ]; then
                        SUGGESTED_BRANCH="feature/$TASK_NAME"
                    else
                        SUGGESTED_BRANCH="feature/$(date +%Y%m%d-%H%M%S)"
                    fi
                    
                    echo -e "  ${YELLOW}Enter branch name to commit changes to (will be created if it doesn't exist) [default: $SUGGESTED_BRANCH]:${NC}"
                    read -r BRANCH_NAME
                    
                    if [ -z "$BRANCH_NAME" ]; then
                        BRANCH_NAME=$SUGGESTED_BRANCH
                        echo -e "  ${YELLOW}Using suggested branch name: $BRANCH_NAME${NC}"
                    fi
                    
                    # Check if branch already exists
                    if git show-ref --verify --quiet refs/heads/$BRANCH_NAME; then
                        # Branch exists, check it out
                        git checkout $BRANCH_NAME
                        echo -e "  ${GREEN}Checked out existing branch: $BRANCH_NAME${NC}"
                    else
                        # Create new branch
                        git checkout -b $BRANCH_NAME
                        echo -e "  ${GREEN}Created and checked out new branch: $BRANCH_NAME${NC}"
                    fi
                    
                    CURRENT_BRANCH=$BRANCH_NAME
                fi
                
                # Add all changes
                git add .
                
                # Commit changes
                git commit -m "$COMMIT_MESSAGE"
                echo -e "  ${GREEN}Changes committed in $SUBMODULE${NC}"
                
                # Push changes
                echo -e "  ${BLUE}Pushing changes to origin/$CURRENT_BRANCH${NC}"
                git push origin "$CURRENT_BRANCH"
                
                if [ $? -eq 0 ]; then
                    echo -e "  ${GREEN}Changes pushed to remote for $SUBMODULE${NC}"
                else
                    echo -e "  ${RED}Failed to push changes to remote for $SUBMODULE${NC}"
                    echo -e "  ${YELLOW}You may need to manually push with: git push -u origin $CURRENT_BRANCH${NC}"
                    echo -e "  ${YELLOW}Skipping PR creation for this repository${NC}"
                    cd "$CURRENT_DIR" || exit
                    continue
                fi
                
                CHANGES_MADE=true
            else
                echo -e "  ${YELLOW}No uncommitted changes in $SUBMODULE, checking for unpushed commits${NC}"
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                
                # Check for unpushed commits
                if git log origin/${CURRENT_BRANCH}..${CURRENT_BRANCH} 2>/dev/null | grep -q .; then
                    echo -e "  ${YELLOW}Found unpushed commits in ${SUBMODULE}. Pushing now...${NC}"
                    git push origin "$CURRENT_BRANCH"
                    
                    if [ $? -eq 0 ]; then
                        echo -e "  ${GREEN}Changes pushed to remote for $SUBMODULE${NC}"
                        CHANGES_MADE=true
                    else
                        echo -e "  ${RED}Failed to push changes to remote for $SUBMODULE${NC}"
                        echo -e "  ${YELLOW}Skipping PR creation for this repository${NC}"
                        cd "$CURRENT_DIR" || exit
                        continue
                    fi
                else
                    echo -e "  ${YELLOW}No changes in $SUBMODULE${NC}"
                fi
            fi
            
            # Return to main directory
            cd "$CURRENT_DIR" || exit
        done
        
        if $CHANGES_MADE; then
            echo -e "${BLUE}=== Updating main repository ===${NC}"
            
            # Add all changes in submodules to the main repository
            git add .
            
            # Commit the submodule updates
            git commit -m "Updated submodules: $COMMIT_MESSAGE"
            
            # Push changes
            git push origin "$(git rev-parse --abbrev-ref HEAD)"
            echo -e "${GREEN}Changes pushed to remote for the main repository${NC}"
        else
            echo -e "${YELLOW}No changes detected in any submodules${NC}"
        fi
        
        # 2. Now create PRs for repositories
        echo -e "${BLUE}=== Step 2: Creating pull requests for each repository ===${NC}"
        
        # Get list of submodules again
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                cd "$SUBMODULE" || continue
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                echo -e "${BLUE}Creating PR for ${YELLOW}$SUBMODULE${NC} (branch: $CURRENT_BRANCH)"
                
                # Get remote URL (to determine if it's GitHub or GitLab)
                REMOTE_URL=$(git remote get-url origin)
                REPO_URL=""
                
                if [[ "$REMOTE_URL" =~ github.com ]]; then
                    IS_GITLAB=false
                elif [[ "$REMOTE_URL" =~ gitlab ]]; then
                    IS_GITLAB=true
                fi
                
                # Create PR/MR depending on the platform
                if $IS_GITLAB; then
                    # Extract the project path from remote URL
                    if [[ "$REMOTE_URL" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                        PROJECT_PATH=${BASH_REMATCH[1]}
                        
                        echo -e "  ${BLUE}Creating GitLab merge request for ${YELLOW}$SUBMODULE${NC}"
                        
                        # Build the GitLab API command
                        API_URL="https://gitlab.com/api/v4/projects/$(echo $PROJECT_PATH | sed 's/\//%2F/g')/merge_requests"
                        
                        # Create the merge request using curl
                        echo -e "  ${BLUE}Executing: curl command to create MR${NC}"
                        
                        # Ask for token if not already set
                        if [ -z "$GITLAB_TOKEN" ]; then
                            echo -e "${YELLOW}Please enter your GitLab personal access token:${NC}"
                            read -r GITLAB_TOKEN
                        fi
                        
                        # Prepare description
                        FULL_DESCRIPTION="$PR_DESCRIPTION\n\nCreated from multi-repo tool."
                        
                        RESPONSE=$(curl -s -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
                            -H "Content-Type: application/json" \
                            -d "{\"source_branch\":\"$CURRENT_BRANCH\",\"target_branch\":\"$TARGET_BRANCH\",\"title\":\"$PR_TITLE\",\"description\":\"$FULL_DESCRIPTION\"}" \
                            "$API_URL")
                        
                        # Check if successful
                        if echo "$RESPONSE" | grep -q "web_url"; then
                            MR_URL=$(echo "$RESPONSE" | grep -o '"web_url":"[^"]*"' | sed 's/"web_url":"//;s/"$//')
                            echo -e "  ${GREEN}GitLab Merge Request created successfully: $MR_URL${NC}"
                        else
                            echo -e "  ${RED}Failed to create GitLab Merge Request. Response: $RESPONSE${NC}"
                        fi
                    else
                        echo -e "  ${RED}Could not extract project path from remote URL: $REMOTE_URL${NC}"
                    fi
                else
                    # Extract owner and repo from GitHub URL
                    if [[ "$REMOTE_URL" =~ github.com[/:]([^/]+)/([^/.]+) ]]; then
                        OWNER=${BASH_REMATCH[1]}
                        REPO=${BASH_REMATCH[2]}
                        
                        echo -e "  ${BLUE}Creating GitHub pull request for ${YELLOW}$SUBMODULE${NC}"
                        
                        # Build the GitHub API command
                        API_URL="https://api.github.com/repos/$OWNER/$REPO/pulls"
                        
                        # Ask for token if not already set
                        if [ -z "$GITHUB_TOKEN" ]; then
                            echo -e "${YELLOW}Please enter your GitHub personal access token:${NC}"
                            read -r GITHUB_TOKEN
                        fi
                        
                        # Prepare description
                        FULL_DESCRIPTION="$PR_DESCRIPTION\n\nCreated from multi-repo tool."
                        
                        RESPONSE=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
                            -H "Accept: application/vnd.github.v3+json" \
                            -d "{\"head\":\"$CURRENT_BRANCH\",\"base\":\"$TARGET_BRANCH\",\"title\":\"$PR_TITLE\",\"body\":\"$FULL_DESCRIPTION\"}" \
                            "$API_URL")
                        
                        # Check if successful
                        if echo "$RESPONSE" | grep -q "html_url"; then
                            PR_URL=$(echo "$RESPONSE" | grep -o '"html_url":"[^"]*"' | grep "/pull/" | sed 's/"html_url":"//;s/"$//')
                            echo -e "  ${GREEN}GitHub Pull Request created successfully: $PR_URL${NC}"
                        else
                            echo -e "  ${RED}Failed to create GitHub Pull Request. Response: $RESPONSE${NC}"
                        fi
                    else
                        echo -e "  ${RED}Could not extract owner and repo from remote URL: $REMOTE_URL${NC}"
                    fi
                fi
                
                # Return to main directory
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        echo -e "${GREEN}=== Pull request creation completed ===${NC}"
        ;;
        
    help)
        show_help
        ;;
        
    *)
        echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
        show_help
        exit 1
        ;;
esac 