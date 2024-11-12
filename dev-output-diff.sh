#!/bin/bash

# 1. Take the feature branch as the first param
feature_branch=$1

# 2. Take the google doc id as the second param  
google_doc_id=$2

# 3. Save current branch
current_branch=$(git branch --show-current)

# 4. Check out the main git branch
git checkout main

# 5. Run the node devtool.js command and store the result
main_output=$(node devtools.js md $google_doc_id)
main_output_file=$(mktemp)
echo "$main_output" > "$main_output_file"

# 6. Check out the feature branch
git checkout $feature_branch

# 7. Run the same node command
branch_output=$(node devtools.js md $google_doc_id)
branch_output_file=$(mktemp)
echo "$branch_output" > "$branch_output_file"

# 8. Output a git diff of the two command runs
git diff "$main_output_file" "$branch_output_file"

# 9. Clean up temporary files
rm "$main_output_file" "$branch_output_file"

# 10. Return to initial branch
git checkout $current_branch