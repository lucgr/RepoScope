#!/bin/bash

# multi-repo.sh - A wrapper for managing multiple repositories in a virtual workspace
# This script provides easy command aliases and extensibility for operations across repos

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "multi-repo.sh version: 2025-05-15"

# Display help information
function show_help {
    echo -e "${BLUE}=== Multi-Repo Operations Tool ===${NC}"
    echo -e "A wrapper for managing operations across multiple repositories in a virtual workspace"
    echo ""
    echo -e "Usage: ${YELLOW}multi-repo <command> [arguments]${NC}"
    echo ""
    echo -e "Available commands:"
    echo -e "  ${GREEN}init${NC}                    Initialize all submodules in the workspace"
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
    init)
        echo -e "${BLUE}=== Initializing all submodules ===${NC}"
        git submodule update --recursive --init
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}All submodules initialized successfully${NC}"
            
            # Get current branch of the main repository
            MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
            echo -e "${BLUE}Setting all submodules to branch: ${GREEN}$MAIN_BRANCH${NC}"
            
            # Get current directory
            CURRENT_DIR=$(pwd)
            
            # Get list of submodules
            SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
            
            # Set branch in each submodule
            for SUBMODULE in $SUBMODULES; do
                if [ -d "$SUBMODULE" ]; then
                    echo -e "${BLUE}Checking out branch in ${YELLOW}$SUBMODULE${NC}"
                    cd "$SUBMODULE" || continue
                    
                    # Check if branch exists
                    if git show-ref --verify --quiet refs/heads/$MAIN_BRANCH; then
                        # Branch exists, check it out
                        git checkout $MAIN_BRANCH
                        echo -e "  ${GREEN}Checked out existing branch: $MAIN_BRANCH${NC}"
                    else
                        # Check if remote branch exists
                        if git ls-remote --heads origin $MAIN_BRANCH | grep -q $MAIN_BRANCH; then
                            # Remote branch exists, create tracking branch
                            git checkout -b $MAIN_BRANCH --track origin/$MAIN_BRANCH
                            echo -e "  ${GREEN}Created and checked out tracking branch: $MAIN_BRANCH${NC}"
                        else
                            # Create new branch
                            git checkout -b $MAIN_BRANCH
                            echo -e "  ${GREEN}Created and checked out new branch: $MAIN_BRANCH${NC}"
                        fi
                    fi
                    
                    # Return to main directory
                    cd "$CURRENT_DIR" || exit
                fi
            done
        else
            echo -e "${RED}Failed to initialize submodules${NC}"
            exit 1
        fi
        ;;
        
    commit)
        # Check if commit message is provided
        if [ -z "$1" ]; then
            echo -e "${RED}Error: No commit message provided${NC}"
            echo -e "Usage: multi-repo commit \"Your commit message\""
            exit 1
        fi
        
        # Call the commit-submodules script directly so interactive prompts work
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
        
        # Print header
        printf "${BLUE}%-25s %-15s %-20s %-30s${NC}\n" "Repository" "Branch" "Upstream Status" "Local Status"
        printf "%s\n" "$(printf '=%.0s' {1..90})"

        # First check status of main repository
        echo -e "${YELLOW}Main repository:${NC}"
        
        # Get branch info for main repo
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        
        # Get ahead/behind counts
        UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null)
        
        if [ -n "$UPSTREAM" ]; then
            AHEAD_BEHIND=$(git rev-list --left-right --count "$UPSTREAM"..."$CURRENT_BRANCH" 2>/dev/null)
            if [ $? -eq 0 ]; then
                BEHIND=$(echo "$AHEAD_BEHIND" | awk '{print $1}')
                AHEAD=$(echo "$AHEAD_BEHIND" | awk '{print $2}')
                
                if [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -gt 0 ]; then
                    UPSTREAM_STATUS="${RED}↓$BEHIND ${GREEN}↑$AHEAD${NC}"
                elif [ "$BEHIND" -gt 0 ]; then
                    UPSTREAM_STATUS="${RED}↓$BEHIND${NC}"
                elif [ "$AHEAD" -gt 0 ]; then
                    UPSTREAM_STATUS="${GREEN}↑$AHEAD${NC}"
                else
                    UPSTREAM_STATUS="${GREEN}Up to date${NC}"
                fi
            else
                UPSTREAM_STATUS="${YELLOW}No upstream${NC}"
            fi
        else
            UPSTREAM_STATUS="${YELLOW}No upstream${NC}"
        fi
        
        # Get local status
        STATUS=$(git status -s)
        if [ -z "$STATUS" ]; then
            LOCAL_STATUS="${GREEN}No changes${NC}"
            HAS_CHANGES=false
        else
            MODIFIED=$(echo "$STATUS" | grep -c "^ M\|^MM")
            ADDED=$(echo "$STATUS" | grep -c "^A\|^AM")
            DELETED=$(echo "$STATUS" | grep -c "^ D")
            UNTRACKED=$(echo "$STATUS" | grep -c "^??")
            
            LOCAL_STATUS=""
            [ "$MODIFIED" -gt 0 ] && LOCAL_STATUS+="${YELLOW}M:$MODIFIED ${NC}"
            [ "$ADDED" -gt 0 ] && LOCAL_STATUS+="${GREEN}A:$ADDED ${NC}"
            [ "$DELETED" -gt 0 ] && LOCAL_STATUS+="${RED}D:$DELETED ${NC}"
            [ "$UNTRACKED" -gt 0 ] && LOCAL_STATUS+="${BLUE}?:$UNTRACKED${NC}"
            HAS_CHANGES=true
        fi
        
        printf "%-25s ${GREEN}%-15s${NC} %-20b %-30b\n" "Main" "$CURRENT_BRANCH" "$UPSTREAM_STATUS" "$LOCAL_STATUS"
        
        # Show changed files if any
        if [ "$HAS_CHANGES" = true ]; then
            echo -e "  ${BLUE}Changed files:${NC}"
            echo "$STATUS" | while read -r line; do
                STATUS_CODE=$(echo "$line" | cut -c1-2 | xargs)
                FILE_NAME=$(echo "$line" | cut -c3- | xargs)
                
                case "$STATUS_CODE" in
                    "M"*|" M"|"MM") 
                        STATUS_TEXT="Modified"
                        COLOR=$YELLOW ;;
                    "A"*) 
                        STATUS_TEXT="Added"
                        COLOR=$GREEN ;;
                    "D"*|" D") 
                        STATUS_TEXT="Deleted"
                        COLOR=$RED ;;
                    "R"*) 
                        STATUS_TEXT="Renamed"
                        COLOR=$BLUE ;;
                    "C"*) 
                        STATUS_TEXT="Copied"
                        COLOR=$BLUE ;;
                    "U"*) 
                        STATUS_TEXT="Updated"
                        COLOR=$RED ;;
                    "??") 
                        STATUS_TEXT="Untracked"
                        COLOR=$BLUE ;;
                    *) 
                        STATUS_TEXT="$STATUS_CODE"
                        COLOR=$NC ;;
                esac
                
                echo -e "    ${COLOR}${STATUS_TEXT}:${NC} ${FILE_NAME}"
            done
        fi
        
        echo ""
        
        # Get list of submodules
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Check status of each submodule
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                cd "$SUBMODULE" || continue
                
                # Get current branch
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                
                # Get ahead/behind counts
                UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream} 2>/dev/null)
                
                if [ -n "$UPSTREAM" ]; then
                    AHEAD_BEHIND=$(git rev-list --left-right --count "$UPSTREAM"..."$CURRENT_BRANCH" 2>/dev/null)
                    if [ $? -eq 0 ]; then
                        BEHIND=$(echo "$AHEAD_BEHIND" | awk '{print $1}')
                        AHEAD=$(echo "$AHEAD_BEHIND" | awk '{print $2}')
                        
                        if [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -gt 0 ]; then
                            UPSTREAM_STATUS="${RED}↓$BEHIND ${GREEN}↑$AHEAD${NC}"
                        elif [ "$BEHIND" -gt 0 ]; then
                            UPSTREAM_STATUS="${RED}↓$BEHIND${NC}"
                        elif [ "$AHEAD" -gt 0 ]; then
                            UPSTREAM_STATUS="${GREEN}↑$AHEAD${NC}"
                        else
                            UPSTREAM_STATUS="${GREEN}Up to date${NC}"
                        fi
                    else
                        UPSTREAM_STATUS="${YELLOW}No upstream${NC}"
                    fi
                else
                    UPSTREAM_STATUS="${YELLOW}No upstream${NC}"
                fi
                
                # Get local status
                STATUS=$(git status -s)
                if [ -z "$STATUS" ]; then
                    LOCAL_STATUS="${GREEN}No changes${NC}"
                    HAS_CHANGES=false
                else
                    MODIFIED=$(echo "$STATUS" | grep -c "^ M\|^MM")
                    ADDED=$(echo "$STATUS" | grep -c "^A\|^AM")
                    DELETED=$(echo "$STATUS" | grep -c "^ D")
                    UNTRACKED=$(echo "$STATUS" | grep -c "^??")
                    
                    LOCAL_STATUS=""
                    [ "$MODIFIED" -gt 0 ] && LOCAL_STATUS+="${YELLOW}M:$MODIFIED ${NC}"
                    [ "$ADDED" -gt 0 ] && LOCAL_STATUS+="${GREEN}A:$ADDED ${NC}"
                    [ "$DELETED" -gt 0 ] && LOCAL_STATUS+="${RED}D:$DELETED ${NC}"
                    [ "$UNTRACKED" -gt 0 ] && LOCAL_STATUS+="${BLUE}?:$UNTRACKED${NC}"
                    HAS_CHANGES=true
                fi
                
                printf "%-25s ${GREEN}%-15s${NC} %-20b %-30b\n" "$SUBMODULE" "$CURRENT_BRANCH" "$UPSTREAM_STATUS" "$LOCAL_STATUS"
                
                # Show changed files if any
                if [ "$HAS_CHANGES" = true ]; then
                    echo -e "  ${BLUE}Changed files:${NC}"
                    echo "$STATUS" | while read -r line; do
                        STATUS_CODE=$(echo "$line" | cut -c1-2 | xargs)
                        FILE_NAME=$(echo "$line" | cut -c3- | xargs)
                        
                        case "$STATUS_CODE" in
                            "M"*|" M"|"MM") 
                                STATUS_TEXT="Modified"
                                COLOR=$YELLOW ;;
                            "A"*) 
                                STATUS_TEXT="Added"
                                COLOR=$GREEN ;;
                            "D"*|" D") 
                                STATUS_TEXT="Deleted"
                                COLOR=$RED ;;
                            "R"*) 
                                STATUS_TEXT="Renamed"
                                COLOR=$BLUE ;;
                            "C"*) 
                                STATUS_TEXT="Copied"
                                COLOR=$BLUE ;;
                            "U"*) 
                                STATUS_TEXT="Updated"
                                COLOR=$RED ;;
                            "??") 
                                STATUS_TEXT="Untracked"
                                COLOR=$BLUE ;;
                            *) 
                                STATUS_TEXT="$STATUS_CODE"
                                COLOR=$NC ;;
                        esac
                        
                        echo -e "    ${COLOR}${STATUS_TEXT}:${NC} ${FILE_NAME}"
                    done
                fi
                
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

        # Prompt for PR Description
        echo -e "${YELLOW}Enter PR description:${NC}"
        read -r PR_DESCRIPTION
        if [ -z "$PR_DESCRIPTION" ]; then
            echo -e "${RED}Error: PR description cannot be empty.${NC}"
            exit 1
        fi

        # Prompt for Target Branch
        echo -e "${YELLOW}Enter target branch (default: main):${NC}"
        read -r TARGET_BRANCH
        TARGET_BRANCH=${TARGET_BRANCH:-main}

        # Flag for GitLab vs GitHub detection
        IS_GITLAB=false # Default to GitHub
        echo -e "${YELLOW}Are you using GitLab? (y/n, default: n):${NC}"
        read -r USING_GITLAB
        if [[ "$USING_GITLAB" =~ ^[Yy]$ ]]; then
            IS_GITLAB=true
        fi

        # --- Step 1: Commit and Push Uncommitted Changes ---
        echo -e "${BLUE}=== Step 1: Committing and pushing uncommitted changes ===${NC}"
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')

        for SUBMODULE in $SUBMODULES; do
            echo -e "${BLUE}Processing submodule: ${YELLOW}$SUBMODULE${NC}"
            if [ ! -d "$SUBMODULE" ]; then
                echo -e "  ${RED}Submodule directory does not exist. Skipping.${NC}"
                continue
            fi
            cd "$SUBMODULE" || continue

            # Check for uncommitted changes
            if git status --porcelain | grep -q .; then
                echo -e "  ${GREEN}Uncommitted changes detected.${NC}"
                git add .
                COMMIT_MSG="Automated commit: Pre-PR changes for '$PR_TITLE'"
                git commit -m "$COMMIT_MSG"
                if [ $? -eq 0 ]; then
                    echo -e "  ${GREEN}Changes committed successfully.${NC}"
                else
                    echo -e "  ${RED}Failed to commit changes. Skipping push and PR for this repo.${NC}"
                    cd "$CURRENT_DIR" || exit
                    continue
                fi

                # Push changes
                CURRENT_BRANCH_SUBMODULE=$(git rev-parse --abbrev-ref HEAD)
                echo -e "  ${BLUE}Pushing changes to origin/$CURRENT_BRANCH_SUBMODULE...${NC}"
                git push origin "$CURRENT_BRANCH_SUBMODULE"
                if [ $? -eq 0 ]; then
                    echo -e "  ${GREEN}Changes pushed successfully.${NC}"
                else
                    echo -e "  ${RED}Failed to push changes. Attempting to set upstream and push again...${NC}"
                    git push --set-upstream origin "$CURRENT_BRANCH_SUBMODULE"
                     if [ $? -eq 0 ]; then
                        echo -e "  ${GREEN}Changes pushed successfully after setting upstream.${NC}"
                    else
                        echo -e "  ${RED}Still failed to push changes. Skipping PR for this repo.${NC}"
                        cd "$CURRENT_DIR" || exit
                        continue
                    fi
                fi
            else
                echo -e "  ${YELLOW}No uncommitted changes.${NC}"
            fi
            cd "$CURRENT_DIR" || exit
        done

        # --- Step 2: Create PRs for Repos with Changes ---
        echo -e "${BLUE}=== Step 2: Creating pull requests ===${NC}"
        PR_METADATA=()

        for SUBMODULE in $SUBMODULES; do
            echo -e "${BLUE}Checking for changes to create PR in: ${YELLOW}$SUBMODULE${NC}"
            if [ ! -d "$SUBMODULE" ]; then
                echo -e "  ${RED}Submodule directory does not exist. Skipping.${NC}"
                continue
            fi
            cd "$SUBMODULE" || continue

            SOURCE_BRANCH=$(git rev-parse --abbrev-ref HEAD)

            # Fetch the target branch to ensure we have the latest ref for comparison
            echo -e "  ${BLUE}Fetching origin/$TARGET_BRANCH...${NC}"
            git fetch origin "$TARGET_BRANCH" --quiet
            if [ $? -ne 0 ]; then
                echo -e "  ${RED}Failed to fetch target branch '$TARGET_BRANCH'. It might not exist on the remote. Skipping PR for this repo.${NC}"
                cd "$CURRENT_DIR" || exit
                continue
            fi
            
            # Check for differences between source branch and target branch
            # We need to compare the local SOURCE_BRANCH with the remote TARGET_BRANCH
            if git diff --quiet "origin/$TARGET_BRANCH" "$SOURCE_BRANCH"; then
                echo -e "  ${YELLOW}No differences found between '$SOURCE_BRANCH' and 'origin/$TARGET_BRANCH'. Skipping PR.${NC}"
                cd "$CURRENT_DIR" || exit
                continue
            else
                echo -e "  ${GREEN}Differences found between '$SOURCE_BRANCH' and 'origin/$TARGET_BRANCH'. Proceeding with PR creation.${NC}"
            fi

            REMOTE_URL=$(git remote get-url origin)
            # Determine if GitHub or GitLab based on remote URL more reliably
            if [[ "$REMOTE_URL" =~ github.com ]]; then
                EFFECTIVE_IS_GITLAB=false
            elif [[ "$REMOTE_URL" =~ gitlab ]]; then
                EFFECTIVE_IS_GITLAB=true
            else
                # If neither, use the user's initial choice.
                EFFECTIVE_IS_GITLAB=$IS_GITLAB
            fi
            
            # Ensure the source branch exists on remote, or push it.
            if ! git ls-remote --heads origin "$SOURCE_BRANCH" | grep -q "$SOURCE_BRANCH"; then
                echo -e "  ${YELLOW}Source branch '$SOURCE_BRANCH' does not exist on remote. Pushing now...${NC}"
                git push origin "$SOURCE_BRANCH"
                if [ $? -ne 0 ]; then
                    echo -e "  ${RED}Failed to push source branch '$SOURCE_BRANCH' to remote. Skipping PR for this repo.${NC}"
                    cd "$CURRENT_DIR" || exit
                    continue
                fi
                echo -e "  ${GREEN}Source branch '$SOURCE_BRANCH' pushed to remote successfully.${NC}"
            fi


            FULL_PR_DESCRIPTION="$PR_DESCRIPTION" # Initial description
            RESPONSE=""

            if $EFFECTIVE_IS_GITLAB; then
                if [[ "$REMOTE_URL" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                    PROJECT_PATH=${BASH_REMATCH[1]} # e.g., lucgr/test-repo or group/subgroup/test-repo
                    API_URL="https://gitlab.com/api/v4/projects/$(echo $PROJECT_PATH | sed 's#/#%2F#g')/merge_requests"
                    if [ -z "$GITLAB_TOKEN" ]; then
                        echo -e "${YELLOW}Please enter your GitLab personal access token (scope: api):${NC}"
                        read -rs GITLAB_TOKEN # -s for silent input
                        echo "" # Newline after silent input
                    fi
                    JSON_PAYLOAD=$(cat <<EOF
{
  "source_branch": "$SOURCE_BRANCH",
  "target_branch": "$TARGET_BRANCH",
  "title": "$PR_TITLE",
  "description": "$FULL_PR_DESCRIPTION"
}
EOF
)
                    RESPONSE=$(curl -s -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
                        -H "Content-Type: application/json" \
                        -d "$JSON_PAYLOAD" \
                        "$API_URL")
                    if echo "$RESPONSE" | grep -q "web_url"; then
                        RAW_MR_URL=$(echo "$RESPONSE" | grep -o '"web_url":"[^"]*"' | sed 's/"web_url":"//;s/"$//' | tr -d '\n' | xargs)
                        MR_URL=$RAW_MR_URL # Default to raw URL

                        # Check for duplicated https scheme, e.g. https://gitlab.com/userhttps://gitlab.com/user/repo/...
                        # If found, take the part from the second https:// onwards.
                        # Count occurrences of 'https://'
                        SCHEMA_COUNT=$(echo "$RAW_MR_URL" | grep -o "https://" | wc -l)

                        if [ "$SCHEMA_COUNT" -ge 2 ]; then
                            # Extract the part of the string starting from the second 'https://'
                            # This uses sed to remove everything up to and including the first 'https://'
                            # and then prepends 'https://' back to the remainder.
                            SECOND_PART=$(echo "$RAW_MR_URL" | sed 's#^https://[^/]*/##' ) # Removes first 'https://domain.com/user'
                            # However, the issue seems to be 'https://domain/user' + 'https://domain/user/repo/...' 
                            # So we really want to find the *second* 'https://'

                            # Revised approach: find the position of the second 'https://'
                            # This is tricky in pure bash/sed without more complex tools like awk or perl.
                            # Let's try a simpler string manipulation if the pattern is consistent:
                            # https://<host>/<user_or_group>https://<host>/<user_or_group>/<repo>/-/merge_requests/<id>
                            
                            # Simplified assumption: the duplication is always the host + user/group part
                            # Example: https://gitlab.com/lucgrhttps://gitlab.com/lucgr/test-unified-pr-secondary/-/merge_requests/37
                            # We want to remove the first 'https://gitlab.com/lucgr'
                            
                            # More direct approach: if 'https://' appears twice, take everything from the second one.
                            # This can be done by removing the first part up to the second 'https://'
                            # Example: remove 'https://gitlab.com/lucgr' from 'https://gitlab.com/lucgrhttps://gitlab.com/lucgr/...' 
                            # The remainder would be 'https://gitlab.com/lucgr/...' which is what we want.

                            # Let's use a Bash regex to capture the second https part directly if it exists after a first one.
                            if [[ "$RAW_MR_URL" =~ ^(https://[^/]+/[a-zA-Z0-9_.-]+)(https://.*) ]]; then
                                # BASH_REMATCH[1] is the first https://host/user_or_group
                                # BASH_REMATCH[2] is the second https://... part (the actual clean URL)
                                CORRECTED_URL="${BASH_REMATCH[2]}"
                                if [ "$CORRECTED_URL" != "$RAW_MR_URL" ] && [[ "$CORRECTED_URL" == https://* ]]; then
                                     MR_URL="$CORRECTED_URL"
                                     echo -e "  ${YELLOW}Cleaned malformed GitLab URL. Original: $RAW_MR_URL, Corrected: $MR_URL${NC}"
                                fi
                            fi
                        fi
                        
                        PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$SOURCE_BRANCH|$MR_URL")
                        echo -e "  ${GREEN}GitLab Merge Request created successfully: $MR_URL${NC}"
                    else
                        echo -e "  ${RED}Failed to create GitLab Merge Request. Response: $RESPONSE${NC}"
                    fi
                else
                    echo -e "  ${RED}Could not extract project path from GitLab remote URL: $REMOTE_URL${NC}"
                fi
            else # GitHub
                if [[ "$REMOTE_URL" =~ github.com[/:]([^/]+)/([^/.]+) ]]; then
                    OWNER=${BASH_REMATCH[1]}
                    REPO_NAME=$(echo "${BASH_REMATCH[2]}" | sed 's/\.git$//') # Remove .git if present
                    API_URL="https://api.github.com/repos/$OWNER/$REPO_NAME/pulls"
                    if [ -z "$GITHUB_TOKEN" ]; then
                        echo -e "${YELLOW}Please enter your GitHub personal access token (scope: repo):${NC}"
                        read -rs GITHUB_TOKEN # -s for silent input
                        echo "" # Newline after silent input
                    fi
                    JSON_PAYLOAD=$(cat <<EOF
{
  "head": "$SOURCE_BRANCH",
  "base": "$TARGET_BRANCH",
  "title": "$PR_TITLE",
  "body": "$FULL_PR_DESCRIPTION"
}
EOF
)
                    RESPONSE=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
                        -H "Accept: application/vnd.github.v3+json" \
                        -d "$JSON_PAYLOAD" \
                        "$API_URL")
                    if echo "$RESPONSE" | grep -q "html_url"; then
                        PR_URL=$(echo "$RESPONSE" | grep -o '"html_url":"[^"]*"' | grep "/pull/" | sed 's/"html_url":"//;s/"$//' | tr -d '\n' | xargs)
                        PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$SOURCE_BRANCH|$PR_URL")
                        echo -e "  ${GREEN}GitHub Pull Request created successfully: $PR_URL${NC}"
                    else
                        echo -e "  ${RED}Failed to create GitHub Pull Request. Owner: '$OWNER', Repo: '$REPO_NAME'. Response: $RESPONSE${NC}"
                    fi
                else
                    echo -e "  ${RED}Could not extract owner and repo from GitHub remote URL: $REMOTE_URL${NC}"
                fi
            fi
            cd "$CURRENT_DIR" || exit
        done

        # --- Step 3: Update PR/MR descriptions with links to other PRs/MRs ---
        if [ ${#PR_METADATA[@]} -gt 0 ]; then
            echo -e "${BLUE}=== Step 3: Updating PR/MR descriptions with cross-links ===${NC}"
            # Build the summary of all created PRs/MRs
            CROSSLINK_SUMMARY="This change is part of a multi-repo update. Related PRs/MRs:"
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE_NAME _ _ PR_LINK <<< "$entry"
                CROSSLINK_SUMMARY+="\\n- $SUBMODULE_NAME: $PR_LINK"
            done

            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE_NAME REMOTE_URL_ENTRY SOURCE_BRANCH_ENTRY CURRENT_PR_URL <<< "$entry"
                
                # Combine original PR_DESCRIPTION with the CROSSLINK_SUMMARY
                # Ensure PR_DESCRIPTION is first, then the cross-links
                # UPDATED_DESCRIPTION="$PR_DESCRIPTION\\n\\n$CROSSLINK_SUMMARY" # Old way

                # New way: ensure all newlines are actual newlines before escaping
                # PR_DESCRIPTION already has actual newlines from read -r
                # CROSSLINK_SUMMARY has literal \n, so convert them to actual newlines
                CROSSLINK_SUMMARY_WITH_ACTUAL_NEWLINES=$(echo -e "$CROSSLINK_SUMMARY")
                DESC_TO_ESCAPE=$(printf "%s\n\n%s" "$PR_DESCRIPTION" "$CROSSLINK_SUMMARY_WITH_ACTUAL_NEWLINES")

                # Need to re-determine if it's GitLab or GitHub for the update API call
                IS_GITLAB_FOR_UPDATE=false
                if [[ "$REMOTE_URL_ENTRY" =~ gitlab ]]; then
                    IS_GITLAB_FOR_UPDATE=true
                fi

                if $IS_GITLAB_FOR_UPDATE; then
                    if [[ "$REMOTE_URL_ENTRY" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                        PROJECT_PATH=${BASH_REMATCH[1]}
                        MR_IID=$(echo "$CURRENT_PR_URL" | grep -oE '/merge_requests/[0-9]+' | grep -oE '[0-9]+' | head -1)
                        if [ -n "$MR_IID" ]; then
                            API_URL_UPDATE="https://gitlab.com/api/v4/projects/$(echo $PROJECT_PATH | sed 's#/#%2F#g')/merge_requests/$MR_IID"
                            if [ -z "$GITLAB_TOKEN" ]; then
                                echo -e "${YELLOW}GitLab token not found for updating MR. Please enter your GitLab personal access token (scope: api):${NC}"
                                read -rs GITLAB_TOKEN
                                echo ""
                            fi
                            # Properly escape the description for JSON
                            # 1. Escape backslashes, 2. Escape double quotes, 3. Convert actual newlines to \n
                            ESCAPED_UPDATED_DESCRIPTION=$(printf "%s" "$DESC_TO_ESCAPE" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g')
                            JSON_PAYLOAD_UPDATE="{\"description\": \"$ESCAPED_UPDATED_DESCRIPTION\"}"

                            RESPONSE_UPDATE=$(curl -s -X PUT -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
                                -H "Content-Type: application/json" \
                                -d "$JSON_PAYLOAD_UPDATE" \
                                "$API_URL_UPDATE")
                            if echo "$RESPONSE_UPDATE" | grep -q "web_url"; then
                                echo -e "  ${GREEN}Updated GitLab MR description for $SUBMODULE_NAME: $CURRENT_PR_URL${NC}"
                            else
                                echo -e "  ${RED}Failed to update GitLab MR description for $SUBMODULE_NAME. URL: $API_URL_UPDATE, Payload: $JSON_PAYLOAD_UPDATE, Response: $RESPONSE_UPDATE${NC}"
                            fi
                        else
                             echo -e "  ${RED}Could not extract MR IID for update from URL: $CURRENT_PR_URL${NC}"
                        fi
                    fi
                else # GitHub
                    if [[ "$REMOTE_URL_ENTRY" =~ github.com[/:]([^/]+)/([^/.]+) ]]; then
                        OWNER=${BASH_REMATCH[1]}
                        REPO_NAME_GH=$(echo "${BASH_REMATCH[2]}" | sed 's/\.git$//')
                        PR_NUMBER=$(echo "$CURRENT_PR_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' | head -1)
                        if [ -n "$PR_NUMBER" ]; then
                            API_URL_UPDATE="https://api.github.com/repos/$OWNER/$REPO_NAME_GH/pulls/$PR_NUMBER"
                            if [ -z "$GITHUB_TOKEN" ]; then
                                echo -e "${YELLOW}GitHub token not found for updating PR. Please enter your GitHub personal access token (scope: repo):${NC}"
                                read -rs GITHUB_TOKEN
                                echo ""
                            fi
                            # Properly escape the description for JSON
                            # 1. Escape backslashes, 2. Escape double quotes, 3. Convert actual newlines to \n
                            ESCAPED_UPDATED_DESCRIPTION=$(printf "%s" "$DESC_TO_ESCAPE" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g')
                            JSON_PAYLOAD_UPDATE="{\"body\": \"$ESCAPED_UPDATED_DESCRIPTION\"}"

                            RESPONSE_UPDATE=$(curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
                                -H "Accept: application/vnd.github.v3+json" \
                                -d "$JSON_PAYLOAD_UPDATE" \
                                "$API_URL_UPDATE")
                            if echo "$RESPONSE_UPDATE" | grep -q "html_url"; then
                                echo -e "  ${GREEN}Updated GitHub PR description for $SUBMODULE_NAME: $CURRENT_PR_URL${NC}"
                            else
                                echo -e "  ${RED}Failed to update GitHub PR description for $SUBMODULE_NAME. URL: $API_URL_UPDATE, Payload: $JSON_PAYLOAD_UPDATE, Response: $RESPONSE_UPDATE${NC}"
                            fi
                        else
                            echo -e "  ${RED}Could not extract PR number for update from URL: $CURRENT_PR_URL${NC}"
                        fi
                    fi
                fi
            done
            echo -e "${GREEN}=== PR creation and update process completed ===${NC}"
        elif [ ${#PR_METADATA[@]} -eq 0 ]; then
             echo -e "${YELLOW}No PRs were created as no repositories had relevant changes.${NC}"
        fi
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