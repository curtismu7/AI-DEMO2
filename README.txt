Claude Code Shareable Skills
==============================

How to install a skill
-----------------------
1. Copy the skill folder into ~/.claude/skills/ on your machine
2. Restart Claude Code

That's it. Claude Code will auto-detect it.

Folder structure
----------------
general/    - General purpose skills, useful in any project
security/   - Security scanning and static analysis
pingone/    - PingOne / Identity engineering skills

Skills that install via plugin (not in this zip)
-------------------------------------------------
These come from the official Claude Code plugin system.
Run inside Claude Code:

  /plugins install superpowers     -> verification-before-completion + workflow skills
  /plugins install skill-creator   -> create and improve skills
  /plugins install code-review     -> code review skill

Last updated: June 2026
