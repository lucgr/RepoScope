#!/bin/bash

# multi-repo.sh - A wrapper for managing multiple repositories in a virtual workspace
# This script provides easy command aliases and extensibility for operations across repos

# Source .env file if it exists to load environment variables like GITLAB_TOKEN
if [ -f ".env" ]; then
    echo -e "${BLUE}Sourcing environment variables from .env file...${NC}"
    set -a # Automatically export all variables subsequently set or modified
    source ./.env
    set +a # Disable auto-export
fi

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "multi-repo.sh version: 2025-06-01"

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
    echo -e "  ${GREEN}pr \"title\" -d \"desc\" [-b \"branch\"]${NC} Create pull requests for repos with changes"
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
        echo -e "${BLUE}=== Initializing all submodules in parallel ===${NC}"

        if [ ! -f ".gitmodules" ]; then
            echo -e "${RED}ERROR: .gitmodules file not found. Cannot initialize submodules.${NC}"
            exit 1
        fi

        # Get submodule paths
        SUBMODULE_PATHS=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        # Clean up any existing directories to ensure a fresh clone
        for path in $SUBMODULE_PATHS; do
            if [ -d "$path" ]; then
                echo -e "${YELLOW}Removing existing directory: $path${NC}"
                rm -rf "$path"
            fi
        done

        # Initialize submodule configuration in .git/config. This reads .gitmodules
        # and prepares git for submodule operations.
        git submodule init

        MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        echo -e "${BLUE}Main branch detected: ${GREEN}$MAIN_BRANCH${NC}. Will use this for all submodules."
        
        # This function will be run in parallel for each submodule.
        # It clones the repository and sets it to the correct branch.
        clone_and_setup_submodule() {
            local path=$1
            local main_branch=$2
            
            local submodule_url
            submodule_url=$(git config --file .gitmodules --get-regexp "submodule\..*\.path" | awk -v p="$path" '$2 == p { gsub(/\.path$/, ".url", $1); print $1; exit }' | xargs git config -f .gitmodules)
            
            if [ -z "$submodule_url" ]; then
                echo -e "${RED}Could not find URL for submodule $path${NC}" >&2
                return 1
            fi

            echo -e "${BLUE}Cloning ${YELLOW}$path${NC}..."
            if ! git clone --quiet "$submodule_url" "$path"; then
                echo -e "${RED}Failed to clone $path from $submodule_url${NC}" >&2
                return 1
            fi
            
            # Setting up the branch inside the newly cloned repository
            (
                cd "$path" || return 1
                
                echo -e "${BLUE}Setting branch for ${YELLOW}$path${NC} to ${GREEN}$main_branch${NC}"
                # Check if branch exists locally. (Should not, after a fresh clone, unless it's the default branch)
                if git show-ref --verify --quiet "refs/heads/$main_branch"; then
                    git checkout "$main_branch" --quiet
                    echo -e "  ${GREEN}Switched to existing branch '$main_branch' in $path${NC}"
                # Check if branch exists on remote 'origin'
                elif git ls-remote --heads origin "$main_branch" | grep -q "$main_branch"; then
                    git checkout -b "$main_branch" --track "origin/$main_branch" --quiet
                    echo -e "  ${GREEN}Created tracking branch for 'origin/$main_branch' in $path${NC}"
                else
                    # If it doesn't exist remotely, create it locally.
                    git checkout -b "$main_branch" --quiet
                    echo -e "  ${GREEN}Created and checked out new local branch '$main_branch' in $path${NC}"
                fi
            )
            local status=$?
            if [ $status -ne 0 ]; then
                echo -e "${RED}Failed to set up branch in $path${NC}" >&2
                return $status
            fi
            
            return 0
        }
        
        export -f clone_and_setup_submodule
        export BLUE GREEN YELLOW RED NC

        pids=()
        for path in $SUBMODULE_PATHS; do
            clone_and_setup_submodule "$path" "$MAIN_BRANCH" &
            pids+=($!)
        done
        
        # Wait for all background jobs and check for failures
        all_success=true
        for pid in "${pids[@]}"; do
            if ! wait "$pid"; then
                echo -e "${RED}A submodule setup process failed (PID: $pid).${NC}" >&2
                all_success=false
            fi
        done
        
        if ! $all_success; then
            echo -e "${RED}One or more submodules failed to initialize. Please check the output above. Aborting.${NC}"
            exit 1
        fi
        
        echo -e "${GREEN}All submodules cloned and branches configured successfully.${NC}"

        # Sequentially update the gitlinks in the main repository's index.
        # This records the submodule commits in the parent repository.
        echo -e "${BLUE}Updating submodule pointers in the main repository...${NC}"
        for path in $SUBMODULE_PATHS; do
            if [ -d "$path/.git" ]; then
                echo -e "  Updating index for ${YELLOW}$path${NC}"
                git add "$path"
            else
                echo -e "${YELLOW}Warning: '$path' is not a git repository. Skipping index update.${NC}"
            fi
        done
        
        echo -e "${GREEN}Workspace initialization completed successfully!${NC}"
        ;;
        
    commit)
        COMMIT_MESSAGE=""
        # Handle git-style -m flag for commit message
        if [ "$1" == "-m" ]; then
            if [ -z "$2" ]; then
                echo -e "${RED}Error: No commit message provided for -m flag${NC}" >&2
                echo -e "Usage: multi-repo commit -m \"Your commit message\"" >&2
                exit 1
            fi
            COMMIT_MESSAGE=$2
        elif [ -n "$1" ]; then
            COMMIT_MESSAGE=$1
        fi

        if [ -z "$COMMIT_MESSAGE" ]; then
            echo -e "${RED}Error: No commit message provided${NC}" >&2
            echo -e "Usage: multi-repo commit \"Your commit message\"" >&2
            exit 1
        fi
        
        echo -e "${BLUE}=== Committing changes in parallel with message: \"$COMMIT_MESSAGE\" ===${NC}"
        
        # Function to process a single repository (specifically submodules here)
        commit_submodule() {
            local repo_path=$1
            
            ( # Run in a subshell to isolate cd
                cd "$repo_path" || return 1

                # Check for changes, including untracked files
                if ! git status --porcelain | grep -q .; then
                    echo -e "${YELLOW}No changes to commit in $repo_path.${NC}"
                    return 0
                fi

                echo -e "${BLUE}Staging and committing changes in ${YELLOW}$repo_path${NC}..."
                git add .
                if git commit -m "$COMMIT_MESSAGE"; then
                    echo -e "${GREEN}Committed changes in $repo_path.${NC}"
                    return 0
                else
                    echo -e "${RED}Failed to commit changes in $repo_path.${NC}" >&2
                    return 1
                fi
            )
        }
        
        export -f commit_submodule
        export COMMIT_MESSAGE
        export BLUE GREEN YELLOW RED NC

        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        pids=()

        # Process submodules in parallel
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                commit_submodule "$SUBMODULE" &
                pids+=($!)
            fi
        done

        # Wait for all background submodule jobs and check for failures
        all_success=true
        for pid in "${pids[@]}"; do
            if ! wait "$pid"; then
                echo -e "${RED}A submodule commit process failed (PID: $pid).${NC}" >&2
                all_success=false
            fi
        done
        
        if ! $all_success; then
            echo -e "${RED}One or more submodules failed to commit. Main repository commit is aborted.${NC}"
            exit 1
        fi

        echo -e "\n${BLUE}Submodule commits complete. Processing Main repository...${NC}"

        # Process main repository last (this will include submodule pointer updates)
        git add .

        # Check if there are any staged changes to commit.
        if git diff --cached --quiet; then
            echo -e "${YELLOW}No changes to commit in Main repository.${NC}"
        else
            echo -e "${BLUE}Committing changes in ${YELLOW}Main repository${NC}..."
            if git commit -m "$COMMIT_MESSAGE"; then
                echo -e "${GREEN}Committed changes in Main repository.${NC}"
            else
                echo -e "${RED}Failed to commit changes in Main repository.${NC}" >&2
                exit 1
            fi
        fi
        
        echo -e "\n${GREEN}=== Commit operation completed ===${NC}"
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
        # --- Argument Parsing ---
        PR_TITLE=""
        PR_DESCRIPTION=""
        TARGET_BRANCH=""

        if [ -z "$1" ]; then
            echo -e "${RED}Error: No PR title provided.${NC}" >&2
            echo "Usage: multi-repo pr \"Your PR title\" -d \"Your description\" [-b \"target_branch\"]" >&2
            exit 1
        fi
        PR_TITLE="$1"
        shift

        while (( "$#" )); do
            case "$1" in
                -d|--description)
                    PR_DESCRIPTION="$2"
                    shift 2
                    ;;
                -b|--target-branch)
                    TARGET_BRANCH="$2"
                    shift 2
                    ;;
                *)
                    echo -e "${RED}Error: Unsupported flag $1${NC}" >&2
                    exit 1
                    ;;
            esac
        done

        if [ -z "$PR_DESCRIPTION" ]; then
            echo -e "${RED}Error: PR description is required. Use -d \"Your description\".${NC}" >&2
            exit 1
        fi

        if [ -z "$TARGET_BRANCH" ]; then
            TARGET_BRANCH="main"
            echo -e "${YELLOW}Target branch not specified, defaulting to 'main'.${NC}"
        fi

        # --- Helper for JSON escaping ---
        json_escape() {
            printf "%s" "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g'
        }
        export -f json_escape

        echo -e "${BLUE}=== Creating pull requests in parallel for title: \"$PR_TITLE\" ===${NC}"
        
        CURRENT_DIR=$(pwd)
        SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')
        
        TMP_DIR=$(mktemp -d)
        trap 'rm -rf -- "$TMP_DIR"' EXIT

        # --- Function to create PR for a single repository ---
        create_pr_for_repo() {
            local repo_path=$1
            local repo_name
            repo_name=$(basename "$repo_path")
            
            ( # Subshell to isolate cd and variables
                cd "$repo_path" || return 1

                echo -e "${BLUE}Processing repo: ${YELLOW}$repo_name${NC}"

                # Step 1: Commit and Push Uncommitted Changes
                if git status --porcelain | grep -q .; then
                    echo -e "  ${GREEN}Uncommitted changes detected in $repo_name. Staging, committing, and pushing...${NC}"
                    git add .
                    git commit -m "Automated commit: Pre-PR changes for '$PR_TITLE'"
                    
                    local current_branch
                    current_branch=$(git rev-parse --abbrev-ref HEAD)
                    
                    if ! git push --set-upstream origin "$current_branch"; then
                        echo -e "  ${RED}Failed to push changes for $repo_name. Aborting PR creation for this repo.${NC}" >&2
                        return 1
                    fi
                    echo -e "  ${GREEN}Changes pushed successfully for $repo_name.${NC}"
                else
                    echo -e "  ${YELLOW}No uncommitted changes in $repo_name.${NC}"
                fi

                # Step 2: Check for diffs and create PR
                local source_branch
                source_branch=$(git rev-parse --abbrev-ref HEAD)

                git fetch origin "$TARGET_BRANCH" --quiet
                if ! git diff --quiet "origin/$TARGET_BRANCH" "$source_branch"; then
                    echo -e "  ${GREEN}Differences found between '$source_branch' and 'origin/$TARGET_BRANCH'. Proceeding with PR creation for $repo_name.${NC}"
                else
                    echo -e "  ${YELLOW}No differences found between '$source_branch' and 'origin/$TARGET_BRANCH' for $repo_name. Skipping PR.${NC}"
                    return 0
                fi

                local remote_url
                remote_url=$(git remote get-url origin)
                
                if [[ ! "$remote_url" =~ gitlab ]]; then
                    echo -e "  ${YELLOW}Skipping repo $repo_name as it does not appear to be a GitLab repository ($remote_url).${NC}"
                    return 0
                fi

                if [ -z "$GITLAB_TOKEN" ]; then
                    echo -e "  ${RED}GITLAB_TOKEN env var not set. Cannot create MR for $repo_name.${NC}" >&2
                    return 1
                fi

                if [[ "$remote_url" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                    local project_path=${BASH_REMATCH[1]}
                    local api_url="https://gitlab.com/api/v4/projects/$(echo "$project_path" | sed 's#/#%2F#g')/merge_requests"
                    local escaped_pr_desc
                    escaped_pr_desc=$(json_escape "$PR_DESCRIPTION")
                    local json_payload
                    json_payload=$(printf '{"source_branch": "%s", "target_branch": "%s", "title": "%s", "description": "%s"}' \
                        "$source_branch" "$TARGET_BRANCH" "$PR_TITLE" "$escaped_pr_desc")
                    
                    local response
                    response=$(curl -s -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d "$json_payload" "$api_url")
                    
                    if echo "$response" | grep -q "web_url"; then
                        local raw_mr_url
                        raw_mr_url=$(echo "$response" | grep -o '"web_url":"[^"]*"' | sed 's/"web_url":"//;s/"$//' | xargs)
                        local mr_url="$raw_mr_url"

                        # Clean up potentially malformed URL from GitLab API.
                        # It sometimes returns a string with multiple URLs concatenated.
                        if [[ "$raw_mr_url" =~ https://.*https:// ]]; then
                            echo -e "  ${YELLOW}Malformed GitLab URL detected. Attempting to clean...${NC}"
                            # The assumption is the last URL is the correct one.
                            mr_url=$(echo "$raw_mr_url" | sed 's/.*https:\/\//https:\/\//')
                            echo -e "  ${YELLOW}Cleaned URL: $mr_url${NC}"
                        fi

                        echo "$repo_name|$remote_url|$source_branch|$mr_url" > "$TMP_DIR/$repo_name.meta"
                        echo -e "  ${GREEN}GitLab MR created for $repo_name: $mr_url${NC}"
                    else
                        echo -e "  ${RED}Failed to create GitLab MR for $repo_name. Response: $response${NC}" >&2
                        return 1
                    fi
                else
                    echo -e "  ${RED}Could not extract project path from GitLab URL: $remote_url${NC}" >&2
                    return 1
                fi
            )
        }
        export -f create_pr_for_repo
        export PR_TITLE PR_DESCRIPTION TARGET_BRANCH GITLAB_TOKEN TMP_DIR
        export BLUE GREEN YELLOW RED NC

        # --- Run PR creation in parallel ---
        pids=()
        for SUBMODULE in $SUBMODULES; do
            if [ -d "$SUBMODULE" ]; then
                create_pr_for_repo "$SUBMODULE" &
                pids+=($!)
            fi
        done

        all_success=true
        for pid in "${pids[@]}"; do
            if ! wait "$pid"; then
                echo -e "${RED}A repo processing job failed (PID: $pid).${NC}" >&2
                all_success=false
            fi
        done

        if ! $all_success; then
            echo -e "${RED}One or more repositories failed during PR creation. Cross-linking may be incomplete.${NC}"
        fi

        # --- Collect Metadata ---
        PR_METADATA=()
        for f in "$TMP_DIR"/*.meta; do
            if [ -f "$f" ]; then
                PR_METADATA+=("$(cat "$f")")
            fi
        done
        
        # --- Step 3: Update PR/MR descriptions with cross-links (in parallel) ---
        if [ ${#PR_METADATA[@]} -gt 1 ]; then
            echo -e "${BLUE}=== Updating PR/MR descriptions with cross-links ===${NC}"
            
            CROSSLINK_SUMMARY="This change is part of a multi-repo update. Related PRs/MRs:"
            for entry in "${PR_METADATA[@]}"; do
                IFS='|' read -r SUBMODULE_NAME _ _ PR_LINK <<< "$entry"
                CROSSLINK_SUMMARY+=$'\n'"- $SUBMODULE_NAME: $PR_LINK"
            done
            
            update_pr_description() {
                local pr_entry="$1"
                local crosslink_summary_str="$2"
                
                IFS='|' read -r submodule_name remote_url_entry source_branch_entry current_pr_url <<< "$pr_entry"
                
                local full_desc
                full_desc=$(printf "%s\n\n%s" "$PR_DESCRIPTION" "$crosslink_summary_str")
                
                # Escape for JSON
                local escaped_desc
                escaped_desc=$(json_escape "$full_desc")

                if [[ ! "$remote_url_entry" =~ gitlab ]]; then
                    # This should not be reached if repos are filtered earlier, but acts as a safeguard.
                    return 0
                fi

                if [[ "$remote_url_entry" =~ gitlab.com[/:]([^/]+/[^/.]+) ]]; then
                    local project_path=${BASH_REMATCH[1]}
                    local mr_iid
                    mr_iid=$(echo "$current_pr_url" | grep -oE '/merge_requests/[0-9]+' | grep -oE '[0-9]+')
                    local api_url="https://gitlab.com/api/v4/projects/$(echo "$project_path" | sed 's#/#%2F#g')/merge_requests/$mr_iid"
                    local payload
                    payload=$(printf '{"description": "%s"}' "$escaped_desc")
                    
                    local response_body
                    response_body=$(curl -s -w "\\n%{http_code}" -X PUT -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d "$payload" "$api_url")
                    local http_code
                    http_code=$(echo "$response_body" | tail -n1)
                    response_body=$(echo "$response_body" | sed '$d')

                    if [ "$http_code" -eq 200 ]; then
                        echo -e "  ${GREEN}Updated MR description for $submodule_name${NC}"
                    else
                        echo -e "  ${RED}Failed to update MR description for $submodule_name. Status: $http_code. Response: $response_body${NC}" >&2
                    fi
                fi
            }
            export -f update_pr_description
            export PR_DESCRIPTION GITLAB_TOKEN

            update_pids=()
            for entry in "${PR_METADATA[@]}"; do
                update_pr_description "$entry" "$CROSSLINK_SUMMARY" &
                update_pids+=($!)
            done

            for pid in "${update_pids[@]}"; do
                wait "$pid"
            done
            echo -e "${GREEN}=== Cross-link update process completed ===${NC}"
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