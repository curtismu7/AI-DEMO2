#!/usr/bin/env python3
"""
Script to fix relative imports to absolute imports.
"""
import os
import re
from pathlib import Path

def fix_imports_in_file(file_path):
    """Fix relative imports in a single file."""
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Replace relative imports with absolute imports
    patterns = [
        (r'from \.\.models\.', 'from models.'),
        (r'from \.\.config\.', 'from config.'),
        (r'from \.\.security\.', 'from security.'),
        (r'from \.\.services\.', 'from services.'),
        (r'from \.\.authentication\.', 'from authentication.'),
        (r'from \.\.mcp\.', 'from mcp.'),
        (r'from \.\.agent\.', 'from agent.'),
        (r'from \.\.api\.', 'from api.'),
        (r'from \.\.storage\.', 'from storage.'),
        (r'from \.\.log_utils\.', 'from log_utils.'),
        (r'from \.\.errors\.', 'from errors.'),
    ]
    
    original_content = content
    for pattern, replacement in patterns:
        content = re.sub(pattern, replacement, content)
    
    if content != original_content:
        with open(file_path, 'w') as f:
            f.write(content)
        print(f"Fixed imports in {file_path}")
        return True
    return False

def main():
    """Fix all relative imports in the src directory."""
    src_dir = Path("src")
    fixed_count = 0
    
    for py_file in src_dir.rglob("*.py"):
        if fix_imports_in_file(py_file):
            fixed_count += 1
    
    print(f"Fixed imports in {fixed_count} files")

if __name__ == "__main__":
    main()