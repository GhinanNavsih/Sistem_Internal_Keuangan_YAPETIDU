#!/bin/bash

# Set the working directory to the script's directory
cd "$(dirname "$0")"

# Check if there are any changes to deploy
if [ -z "$(git status --porcelain)" ]; then
  echo "No changes detected. Nothing to deploy."
  exit 0
fi

# Show status
git status

# Ask for a commit message
echo ""
echo "Enter commit message (press Enter for 'Deploy update'):"
read -r commit_msg

if [ -z "$commit_msg" ]; then
  commit_msg="Deploy update"
fi

# Stage and commit
echo "Staging and committing changes..."
git add .
git commit -m "$commit_msg"

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# Push to GitHub (triggers Firebase App Hosting)
echo "Pushing to GitHub on branch '$CURRENT_BRANCH'..."
git push origin "$CURRENT_BRANCH"

echo ""
echo "Deployment triggered! Firebase App Hosting is now building and deploying your update."
echo "You can monitor the build status in the Firebase Console under App Hosting."
