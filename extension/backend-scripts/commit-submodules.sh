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
        
        # Add all changes
        git add .
        
        # Commit changes
        git commit -m "$COMMIT_MESSAGE"
        echo -e "  ${GREEN}Changes committed in $SUBMODULE${NC}"
        
        # Ask if user wants to push changes
        echo -e "  ${YELLOW}Do you want to push the changes to remote? (y/n)${NC}"
        read -r PUSH_RESPONSE
        
        if [[ "$PUSH_RESPONSE" =~ ^[Yy]$ ]]; then
            # Get current branch
            CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
            
            # Push changes
            git push origin "$CURRENT_BRANCH"
            echo -e "  ${GREEN}Changes pushed to remote for $SUBMODULE${NC}"
        else
            echo -e "  ${YELLOW}Changes NOT pushed to remote for $SUBMODULE${NC}"
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
    
    # Ask if user wants to push changes to the main repository
    echo -e "${YELLOW}Do you want to push the submodule updates to the main repository? (y/n)${NC}"
    read -r PUSH_MAIN
    
    if [[ "$PUSH_MAIN" =~ ^[Yy]$ ]]; then
        # Get current branch
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        
        # Push changes
        git push origin "$CURRENT_BRANCH"
        echo -e "${GREEN}Changes pushed to remote for the main repository${NC}"
    else
        echo -e "${YELLOW}Changes NOT pushed to remote for the main repository${NC}"
    fi
    
    echo -e "${GREEN}=== Done! Submodule changes have been committed and the main repository has been updated ===${NC}"
else
    echo -e "${YELLOW}No changes detected in any submodules${NC}"
fi 