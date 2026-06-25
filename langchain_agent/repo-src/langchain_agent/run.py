#!/usr/bin/env python3
"""
Application runner script that sets up the Python path correctly.
"""
import sys
from pathlib import Path

# Add src directory to Python path
src_path = Path(__file__).parent / "src"
sys.path.insert(0, str(src_path))

# Import and run the main application
if __name__ == "__main__":
    from main import main
    import asyncio
    asyncio.run(main())