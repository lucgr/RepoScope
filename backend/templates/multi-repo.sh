#!/bin/bash

# multi-repo.sh - A wrapper for managing multiple repositories in a virtual workspace
# This script provides easy command aliases and extensibility for operations across repos

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "mrh (multi-repo helper) version: 2025-05-15"

# Display help information
function show_help {
    echo -e "${BLUE}=== Multi-Repo Operations Tool ===${NC}"
    echo -e "A wrapper for managing operations across multiple repositories in a virtual workspace"
    echo ""
    echo -e "Usage: ${YELLOW}mrh <command> [arguments]${NC}"
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
    echo -e "Example: ${YELLOW}mrh commit \"Add new feature\"${NC}"
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
            echo -e "Usage: mrh commit \"Your commit message\""
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
            echo -e "Usage: mrh checkout <branch-name>"
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
            echo -e "Usage: mrh branch <branch-name>"
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
            echo -e "Usage: mrh pr \"Your PR title\""
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
        
        # Ask for branch name to use for all repositories if needed
        echo -e "${YELLOW}Enter branch name to use for all repositories (leave empty to use current branch for each repo):${NC}"
        read -r GLOBAL_BRANCH_NAME
        
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
                    
                    # Use global branch name if provided, otherwise extract from PR title
                    if [ -n "$GLOBAL_BRANCH_NAME" ]; then
                        BRANCH_NAME=$GLOBAL_BRANCH_NAME
                    else
                        # Extract task name from the PR title if possible
                        TASK_NAME=$(echo "$PR_TITLE" | grep -o '[A-Z]\+-[0-9]\+' | head -1)
                        if [ -n "$TASK_NAME" ]; then
                            SUGGESTED_BRANCH="feature/$TASK_NAME"
                        else
                            SUGGESTED_BRANCH="feature/$(date +%Y%m%d-%H%M%S)"
                        fi
                        
                        echo -e "  ${YELLOW}No branch name provided. Using branch: $SUGGESTED_BRANCH${NC}"
                        BRANCH_NAME=$SUGGESTED_BRANCH
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
                
                # If global branch name is provided and different from current branch, switch to it
                if [ -n "$GLOBAL_BRANCH_NAME" ] && [ "$CURRENT_BRANCH" != "$GLOBAL_BRANCH_NAME" ]; then
                    # Check if branch exists
                    if git show-ref --verify --quiet refs/heads/$GLOBAL_BRANCH_NAME; then
                        # Branch exists, check it out
                        git checkout $GLOBAL_BRANCH_NAME
                        echo -e "  ${GREEN}Switched to existing branch: $GLOBAL_BRANCH_NAME${NC}"
                    else
                        # Create branch
                        git checkout -b $GLOBAL_BRANCH_NAME
                        echo -e "  ${GREEN}Created and checked out new branch: $GLOBAL_BRANCH_NAME${NC}"
                    fi
                    CURRENT_BRANCH=$GLOBAL_BRANCH_NAME
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
                
                # If global branch name is provided and different from current branch, switch to it
                if [ -n "$GLOBAL_BRANCH_NAME" ] && [ "$CURRENT_BRANCH" != "$GLOBAL_BRANCH_NAME" ]; then
                    # Check if branch exists
                    if git show-ref --verify --quiet refs/heads/$GLOBAL_BRANCH_NAME; then
                        # Branch exists, check it out
                        git checkout $GLOBAL_BRANCH_NAME
                        echo -e "  ${GREEN}Switched to existing branch: $GLOBAL_BRANCH_NAME${NC}"
                    else
                        # Create branch
                        git checkout -b $GLOBAL_BRANCH_NAME
                        echo -e "  ${GREEN}Created and checked out new branch: $GLOBAL_BRANCH_NAME${NC}"
                    fi
                    CURRENT_BRANCH=$GLOBAL_BRANCH_NAME
                    
                    # After switching branch, check again for uncommitted changes
                    if git status --porcelain | grep -q .; then
                        echo -e "  ${GREEN}Changes detected after switching branch${NC}"
                        
                        # Add all changes
                        git add .
                        
                        # Commit changes
                        git commit -m "$COMMIT_MESSAGE"
                        echo -e "  ${GREEN}Changes committed in $SUBMODULE${NC}"
                        
                        CHANGES_MADE=true
                    fi
                fi
                
                # Check for unpushed commits in current branch
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
        
        # We're skipping updates to the virtual monorepo as requested
        if $CHANGES_MADE; then
            echo -e "${BLUE}=== Changes made in submodules ===${NC}"
        else
            echo -e "${YELLOW}No changes detected in any submodules${NC}"
        fi
        
        # 2. Now create PRs for repositories
        echo -e "${BLUE}=== Step 2: Creating pull requests for each repository ===${NC}"
        
        # Build metadata summary for all repos involved (for initial PR description, will be updated later)
        IFS=' ' read -r -a SUBMODULES_ARRAY <<< "$SUBMODULES"
        REPO_COUNT=${#SUBMODULES_ARRAY[@]}
        REPO_SUMMARY="This PR is part of a multi-repo change involving $REPO_COUNT repositories:"
        for SUBMODULE in "${SUBMODULES_ARRAY[@]}"; do
            if [ -d "$SUBMODULE" ]; then
                cd "$SUBMODULE" || continue
                REMOTE_URL=$(git config --get remote.origin.url)
                CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
                REPO_SUMMARY+="\n- $SUBMODULE ($REMOTE_URL) branch: $CURRENT_BRANCH"
                cd "$CURRENT_DIR" || exit
            fi
        done
        
        # --- First loop: create all PRs/MRs and collect metadata (from main dir only) ---
        PR_METADATA=()
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                # Get current branch or use global branch name if specified
                if [ -n "$GLOBAL_BRANCH_NAME" ]; then
                    CURRENT_BRANCH=$GLOBAL_BRANCH_NAME
                    # Make sure we're on the correct branch
                    (cd "$SUBMODULE" && if [ "$(git rev-parse --abbrev-ref HEAD)" != "$GLOBAL_BRANCH_NAME" ]; then
                        if git -C "$SUBMODULE" show-ref --verify --quiet refs/heads/$GLOBAL_BRANCH_NAME; then
                            git -C "$SUBMODULE" checkout $GLOBAL_BRANCH_NAME;
                        else
                            echo -e "  ${RED}Branch $GLOBAL_BRANCH_NAME does not exist, skipping PR creation for $SUBMODULE${NC}"
                            continue
                        fi
                    fi)
                else
                    CURRENT_BRANCH=$(cd "$SUBMODULE" && git rev-parse --abbrev-ref HEAD)
                fi
                REMOTE_URL=$(cd "$SUBMODULE" && git remote get-url origin)
                REPO_URL=""
                IS_GITLAB=false
                if [[ "$REMOTE_URL" =~ github.com ]]; then
                    IS_GITLAB=false
                elif [[ "$REMOTE_URL" =~ gitlab ]]; then
                    IS_GITLAB=true
                fi
                FULL_PR_DESCRIPTION="$PR_DESCRIPTION\n\n---\n(Will be updated with all related PRs after creation)"
                RESPONSE=""
                if $IS_GITLAB; then
                    if [[ "$REMOTE_URL" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                        PROJECT_PATH=${BASH_REMATCH[1]}
                        API_URL="https://gitlab.com/api/v4/projects/$(echo $PROJECT_PATH | sed 's/\//%2F/g')/merge_requests"
                        if [ -z "$GITLAB_TOKEN" ]; then
                            echo -e "${YELLOW}Please enter your GitLab personal access token:${NC}"
                            read -r GITLAB_TOKEN
                        fi
                        FULL_DESCRIPTION="$FULL_PR_DESCRIPTION\n\nCreated from multi-repo tool."
                        RESPONSE=$(curl -s -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
                            -H "Content-Type: application/json" \
                            -d "{\"source_branch\":\"$CURRENT_BRANCH\",\"target_branch\":\"$TARGET_BRANCH\",\"title\":\"$PR_TITLE\",\"description\":\"$FULL_DESCRIPTION\"}" \
                            "$API_URL")
                        if echo "$RESPONSE" | grep -q "web_url"; then
                            MR_URL=$(echo "$RESPONSE" | grep -o '"web_url":"[^"]*"' | sed 's/"web_url":"//;s/"$//' | tr -d '\n' | xargs)
                            # Ensure the URL is clean and complete (no duplications)
                            if [[ "$MR_URL" == *"https://"*"https://"* ]]; then
                                # If URL contains duplication, extract only the proper URL part
                                CLEAN_URL=$(echo "$MR_URL" | grep -o 'https://[^[:space:]]*merge_requests/[0-9]\+')
                                PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$CURRENT_BRANCH|$CLEAN_URL")
                                echo -e "  ${GREEN}GitLab Merge Request created successfully: $CLEAN_URL${NC}"
                            else
                                PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$CURRENT_BRANCH|$MR_URL")
                                echo -e "  ${GREEN}GitLab Merge Request created successfully: $MR_URL${NC}"
                            fi
                        else
                            echo -e "  ${RED}Failed to create GitLab Merge Request. Response: $RESPONSE${NC}"
                        fi
                    else
                        echo -e "  ${RED}Could not extract project path from remote URL: $REMOTE_URL${NC}"
                    fi
                else
                    if [[ "$REMOTE_URL" =~ github.com[/:]([^/]+)/([^/.]+) ]]; then
                        OWNER=${BASH_REMATCH[1]}
                        REPO=${BASH_REMATCH[2]}
                        API_URL="https://api.github.com/repos/$OWNER/$REPO/pulls"
                        if [ -z "$GITHUB_TOKEN" ]; then
                            echo -e "${YELLOW}Please enter your GitHub personal access token:${NC}"
                            read -r GITHUB_TOKEN
                        fi
                        FULL_DESCRIPTION="$FULL_PR_DESCRIPTION\n\nCreated from multi-repo tool."
                        RESPONSE=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" \
                            -H "Accept: application/vnd.github.v3+json" \
                            -d "{\"head\":\"$CURRENT_BRANCH\",\"base\":\"$TARGET_BRANCH\",\"title\":\"$PR_TITLE\",\"body\":\"$FULL_DESCRIPTION\"}" \
                            "$API_URL")
                        if echo "$RESPONSE" | grep -q "html_url"; then
                            PR_URL=$(echo "$RESPONSE" | grep -o '"html_url":"[^"]*"' | grep "/pull/" | sed 's/"html_url":"//;s/"$//' | tr -d '\n' | xargs)
                            # Ensure the URL is clean and complete (no duplications)
                            if [[ "$PR_URL" == *"https://"*"https://"* ]]; then
                                # If URL contains duplication, extract only the proper URL part
                                CLEAN_URL=$(echo "$PR_URL" | grep -o 'https://[^[:space:]]*pull/[0-9]\+')
                                PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$CURRENT_BRANCH|$CLEAN_URL")
                                echo -e "  ${GREEN}GitHub Pull Request created successfully: $CLEAN_URL${NC}"
                            else
                                PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$CURRENT_BRANCH|$PR_URL")
                                echo -e "  ${GREEN}GitHub Pull Request created successfully: $PR_URL${NC}"
                            fi
                        else
                            echo -e "  ${RED}Failed to create GitHub Pull Request. Response: $RESPONSE${NC}"
                        fi
                    else
                        echo -e "  ${RED}Could not extract owner and repo from remote URL: $REMOTE_URL${NC}"
                    fi
                fi
            fi
        done
        # --- Second loop: create and push tag, then update all PR/MR descriptions with tag metadata ---
        if [ ${#PR_METADATA[@]} -gt 0 ]; then
            REPO_COUNT=${#PR_METADATA[@]}
            # Clean up any malformed URLs in PR_METADATA before building tag metadata
            CLEAN_PR_METADATA=()
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE REMOTE_URL BRANCH PR_URL <<< "$entry"
                # Fix malformed URLs with duplicated domains
                if [[ "$PR_URL" == *"https://"*"https://"* ]]; then
                    # Extract everything from the last occurrence of 'https://' onward
                    CLEAN_URL=$(echo "$PR_URL" | sed 's/.*\(https:\/\/.*\)/\1/')
                    CLEAN_PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$BRANCH|$CLEAN_URL")
                    echo -e "${YELLOW}Cleaned malformed URL: $PR_URL -> $CLEAN_URL${NC}"
                else
                    CLEAN_PR_METADATA+=("$SUBMODULE|$REMOTE_URL|$BRANCH|$PR_URL")
                fi
            done
            # Replace original array with cleaned version
            PR_METADATA=("${CLEAN_PR_METADATA[@]}")
            
            TAG_NAME="multi-pr-${REPO_COUNT}repos-$(date +%Y%m%d-%H%M%S)"
            AUTHOR=$(git config user.name)
            TAG_METADATA="Multi-repo PR by $AUTHOR\nAffected repositories: $REPO_COUNT\n\nRelated PRs:"
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE REMOTE_URL BRANCH PR_URL <<< "$entry"
                if [ -n "$PR_URL" ]; then
                    TAG_METADATA+="\n- $SUBMODULE: $PR_URL"
                else
                    TAG_METADATA+="\n- $SUBMODULE"
                fi
            done
            TAG_METADATA+="\n\nCreated from multi-repo tool."
            # Push the tag to all related repos (from main dir, do not cd)
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE REMOTE_URL BRANCH PR_URL <<< "$entry"
                if [ -d "$SUBMODULE" ]; then
                    (cd "$SUBMODULE" && git tag -a "$TAG_NAME" -m "$TAG_METADATA" && git push origin "$TAG_NAME")
                    echo -e "${GREEN}Created and pushed tag $TAG_NAME in $SUBMODULE${NC}"
                fi
            done
            
            # Properly encode the tag metadata for JSON
            # First check if jq is available (preferred method)
            echo -e "${YELLOW}Preparing to update PR/MR descriptions...${NC}"
            TEMP_FILE=$(mktemp)
            echo "$TAG_METADATA" > "$TEMP_FILE"
            
            if command -v jq &> /dev/null; then
                echo -e "${GREEN}Using jq for JSON encoding${NC}"
                TAG_METADATA_JSON=$(jq -Rs . < "$TEMP_FILE")
            else
                echo -e "${YELLOW}jq not found, using fallback encoding method${NC}"
                # Fallback method if jq is not available
                # Replace newlines with \n, escape quotes, and wrap in quotes
                TAG_METADATA_JSON=$(printf '%s' "$(cat "$TEMP_FILE" | sed ':a;N;$!ba;s/\n/\\n/g' | sed 's/\"/\\"/g')")
                TAG_METADATA_JSON="\"$TAG_METADATA_JSON\""
            fi
            
            # Clean up temp file
            rm -f "$TEMP_FILE"
            
            echo -e "${YELLOW}Encoded JSON payload (first 100 chars): ${TAG_METADATA_JSON:0:100}...${NC}"
            
            # Debug: Print PR_METADATA array and count before updating PR/MR descriptions
            echo -e "${YELLOW}DEBUG: PR_METADATA has ${#PR_METADATA[@]} entries:${NC}"
            for entry in "${PR_METADATA[@]}"; do
                echo -e "${YELLOW}DEBUG: $entry${NC}"
            done
            
            # Now update every PR/MR with the tag metadata, with debug output
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE REMOTE_URL BRANCH PR_URL <<< "$entry"
                if [[ "$REMOTE_URL" =~ github.com ]]; then
                    # GitHub: PATCH the PR body
                    if [ -n "$GITHUB_TOKEN" ]; then
                        OWNER=$(echo "$REMOTE_URL" | sed -E 's#.*/([^/]+)/([^/]+)\.git$#\1#')
                        REPO=$(echo "$REMOTE_URL" | sed -E 's#.*/([^/]+)/([^/]+)\.git$#\2#')
                        PR_NUMBER=$(echo "$PR_URL" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' | head -1)
                        if [ -n "$PR_NUMBER" ]; then
                            PATCH_URL="https://api.github.com/repos/$OWNER/$REPO/pulls/$PR_NUMBER"
                            echo -e "${YELLOW}PATCHING GitHub PR: $PATCH_URL${NC}"
                            RESPONSE=$(curl -s -X PATCH -H "Authorization: token $GITHUB_TOKEN" \
                                -H "Accept: application/vnd.github.v3+json" \
                                -d "{\"body\":$TAG_METADATA_JSON}" \
                                "$PATCH_URL")
                            echo -e "${YELLOW}API Response:${NC} $RESPONSE"
                        else
                            echo -e "${RED}ERROR: Could not extract PR number from PR_URL: $PR_URL${NC}"
                        fi
                    fi
                elif [[ "$REMOTE_URL" =~ gitlab ]]; then
                    # GitLab: PUT the MR description
                    if [ -n "$GITLAB_TOKEN" ]; then
                        if [[ "$REMOTE_URL" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                            PROJECT_PATH=${BASH_REMATCH[1]}
                            # Robust MR IID extraction
                            MR_IID=$(echo "$PR_URL" | grep -oE '/merge_requests/[0-9]+' | grep -oE '[0-9]+' | head -1)
                            if [ -n "$MR_IID" ]; then
                                API_URL="https://gitlab.com/api/v4/projects/$(echo $PROJECT_PATH | sed 's/\//%2F/g')/merge_requests/$MR_IID"
                                echo -e "${YELLOW}PUTTING GitLab MR: $API_URL${NC}"
                                echo -e "${YELLOW}MR_IID: $MR_IID${NC}"
                                RESPONSE=$(curl -s -X PUT -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
                                    -H "Content-Type: application/json" \
                                    -d "{\"description\":$TAG_METADATA_JSON}" \
                                    "$API_URL")
                                echo -e "${YELLOW}API Response:${NC} $RESPONSE"
                            else
                                echo -e "${RED}ERROR: Could not extract MR_IID from PR_URL: $PR_URL${NC}"
                            fi
                        else
                            echo -e "${RED}ERROR: Could not extract PROJECT_PATH from REMOTE_URL: $REMOTE_URL${NC}"
                        fi
                    fi
                fi
            done
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