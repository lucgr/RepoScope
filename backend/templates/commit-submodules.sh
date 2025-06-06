#!/bin/bash

# Script to commit changes in all submodules
# Usage: ./commit-submodules.sh "Your commit message"

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if commit message is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: No commit message provided${NC}"
    echo -e "Usage: ./commit-submodules.sh \"Your commit message\""
    exit 1
fi

COMMIT_MESSAGE="$1"
CURRENT_DIR=$(pwd)
CHANGES_MADE=false

# Check if this is a git repository with submodules
if [ ! -d ".git" ] || [ ! -f ".gitmodules" ]; then
    echo -e "${RED}Error: This does not appear to be a git repository with submodules${NC}"
    exit 1
fi

echo -e "${BLUE}=== Scanning for changes in submodules ===${NC}"

# Get list of submodules
SUBMODULES=$(git config --file .gitmodules --get-regexp path | awk '{ print $2 }')

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
            
            if [ -t 0 ]; then
                # Interactive: Ask user for branch name
                echo -e "  ${YELLOW}Enter branch name to commit changes to (will be created if it doesn't exist):${NC}"
                read -r BRANCH_NAME
            else
                # Non-interactive: Use default branch name
                BRANCH_NAME="changes-$(date +%Y%m%d%H%M%S)"
                echo -e "  ${YELLOW}No TTY detected, using generated branch name: $BRANCH_NAME${NC}"
            fi
            
            if [ -z "$BRANCH_NAME" ]; then
                BRANCH_NAME="changes-$(date +%Y%m%d%H%M%S)"
                echo -e "  ${YELLOW}No branch name provided, using generated name: $BRANCH_NAME${NC}"
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
        if [ -t 0 ]; then
            # Interactive: Ask user if they want to push
            echo -e "  ${YELLOW}Do you want to push the changes to remote? (y/n)${NC}"
            read -r PUSH_RESPONSE
            if [[ "$PUSH_RESPONSE" =~ ^[Yy]$ ]]; then
                git push origin "$CURRENT_BRANCH"
                if [ $? -eq 0 ]; then
                    echo -e "  ${GREEN}Changes pushed to remote for $SUBMODULE${NC}"
                else
                    echo -e "  ${RED}Failed to push changes to remote for $SUBMODULE${NC}"
                    echo -e "  ${YELLOW}You may need to manually push with: git push -u origin $CURRENT_BRANCH${NC}"
                fi
            else
                echo -e "  ${YELLOW}Changes NOT pushed to remote for $SUBMODULE${NC}"
            fi
        else
            # Non-interactive: Always push
            echo -e "  ${YELLOW}No TTY detected, automatically pushing changes to remote${NC}"
            git push origin "$CURRENT_BRANCH"
            if [ $? -eq 0 ]; then
                echo -e "  ${GREEN}Changes pushed to remote for $SUBMODULE${NC}"
            else
                echo -e "  ${RED}Failed to push changes to remote for $SUBMODULE${NC}"
                echo -e "  ${YELLOW}You may need to manually push with: git push -u origin $CURRENT_BRANCH${NC}"
            fi
        fi
        
        CHANGES_MADE=true
    else
        echo -e "  ${YELLOW}No changes in $SUBMODULE${NC}"
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
    
    # Push changes to main repo
    if [ -t 0 ]; then
        # Interactive: Ask user if they want to push
        echo -e "${YELLOW}Do you want to push the submodule updates to the main repository? (y/n)${NC}"
        read -r PUSH_MAIN
        if [[ "$PUSH_MAIN" =~ ^[Yy]$ ]]; then
            CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
            git push origin "$CURRENT_BRANCH"
            echo -e "${GREEN}Changes pushed to remote for the main repository${NC}"
        else
            echo -e "${YELLOW}Changes NOT pushed to remote for the main repository${NC}"
        fi
    else
        # Non-interactive: Always push
        echo -e "${YELLOW}No TTY detected, automatically pushing submodule updates to main repository${NC}"
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        git push origin "$CURRENT_BRANCH"
        echo -e "${GREEN}Changes pushed to remote for the main repository${NC}"
    fi
    
    echo -e "${GREEN}=== Done! Submodule changes have been committed and the main repository has been updated ===${NC}"
else
    echo -e "${YELLOW}No changes detected in any submodules${NC}"
fi 