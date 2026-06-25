"""
Tests for CodeGraph LangChain tools.

Tests cover formatting, empty results, truncation, async delegation, and factory.
"""
import asyncio
from unittest.mock import patch, MagicMock

import pytest

from src.codegraph.tools import (
    CodeGraphExploreTool,
    CodeGraphSearchTool,
    CodeGraphCallersTool,
    CodeGraphCalleesTool,
    get_codegraph_tools,
)


class TestCodeGraphExploreTool:
    """Tests for CodeGraphExploreTool."""

    def test_formats_results_single_row(self):
        """Test formatting a single result row."""
        tool = CodeGraphExploreTool()
        fake_rows = [
            {
                "name": "handleTransfer",
                "kind": "function",
                "file_path": "demo_api_server/routes/transfer.js",
                "start_line": 45,
                "qualified_name": "routes.transfer.handleTransfer",
                "docstring": "Handles transfer requests",
            }
        ]
        with patch("src.codegraph.tools.db.explore", return_value=fake_rows):
            result = tool._run("transfer")
        assert "handleTransfer" in result
        assert "function" in result
        assert "transfer.js:45" in result
        assert result != "No results found."

    def test_formats_results_multiple_rows(self):
        """Test formatting multiple result rows."""
        tool = CodeGraphExploreTool()
        fake_rows = [
            {
                "name": "handleTransfer",
                "kind": "function",
                "file_path": "demo_api_server/routes/transfer.js",
                "start_line": 45,
                "qualified_name": "routes.transfer.handleTransfer",
                "docstring": None,
            },
            {
                "name": "processPayment",
                "kind": "function",
                "file_path": "demo_api_server/services/payments.js",
                "start_line": 12,
                "qualified_name": "services.payments.processPayment",
                "docstring": None,
            },
        ]
        with patch("src.codegraph.tools.db.explore", return_value=fake_rows):
            result = tool._run("payment")
        assert "handleTransfer" in result
        assert "processPayment" in result
        assert "transfer.js:45" in result
        assert "payments.js:12" in result

    def test_empty_returns_no_results(self):
        """Test that empty results return 'No results found.'"""
        tool = CodeGraphExploreTool()
        with patch("src.codegraph.tools.db.explore", return_value=[]):
            result = tool._run("xyz")
        assert result == "No results found."

    def test_truncates_long_output(self):
        """Test that output is truncated if exceeds 4000 chars."""
        tool = CodeGraphExploreTool()
        # Create enough fake rows to exceed 4000 chars
        fake_rows = [
            {
                "name": f"function_{i}",
                "kind": "function",
                "file_path": f"path/to/very_long_filename_that_adds_to_the_output_{i}.js",
                "start_line": i * 10,
                "qualified_name": f"module.submodule.function_{i}",
                "docstring": f"This is a docstring for function {i}",
            }
            for i in range(200)
        ]
        with patch("src.codegraph.tools.db.explore", return_value=fake_rows):
            result = tool._run("function")
        assert len(result) <= 3986  # 3970 slice + 16 chars for truncation suffix
        assert "truncated" in result

    def test_arun_delegates_to_run(self):
        """Test that _arun delegates to _run."""
        tool = CodeGraphExploreTool()
        with patch("src.codegraph.tools.db.explore", return_value=[]):
            result = asyncio.run(tool._arun("test"))
        assert result == "No results found."

    def test_arun_with_results(self):
        """Test that _arun returns formatted results."""
        tool = CodeGraphExploreTool()
        fake_rows = [
            {
                "name": "testFunc",
                "kind": "function",
                "file_path": "test.js",
                "start_line": 1,
                "qualified_name": "test.testFunc",
                "docstring": None,
            }
        ]
        with patch("src.codegraph.tools.db.explore", return_value=fake_rows):
            result = asyncio.run(tool._arun("test"))
        assert "testFunc" in result
        assert "test.js:1" in result


class TestCodeGraphSearchTool:
    """Tests for CodeGraphSearchTool."""

    def test_formats_results(self):
        """Test formatting search results."""
        tool = CodeGraphSearchTool()
        fake_rows = [
            {
                "name": "handleTransfer",
                "kind": "function",
                "file_path": "demo_api_server/routes/transfer.js",
                "start_line": 45,
                "qualified_name": "routes.transfer.handleTransfer",
                "signature": None,
            }
        ]
        with patch("src.codegraph.tools.db.search", return_value=fake_rows):
            result = tool._run("Transfer")
        assert "handleTransfer" in result
        assert "function" in result
        assert "transfer.js:45" in result

    def test_empty_returns_no_results(self):
        """Test that empty search results return 'No results found.'"""
        tool = CodeGraphSearchTool()
        with patch("src.codegraph.tools.db.search", return_value=[]):
            result = tool._run("notexist")
        assert result == "No results found."

    def test_truncates_long_output(self):
        """Test that output is truncated if exceeds 4000 chars."""
        tool = CodeGraphSearchTool()
        fake_rows = [
            {
                "name": f"search_result_{i}",
                "kind": "class",
                "file_path": f"path/to/very/long/path/file_{i}.py",
                "start_line": i * 5,
                "qualified_name": f"module.Search_{i}",
                "signature": None,
            }
            for i in range(200)
        ]
        with patch("src.codegraph.tools.db.search", return_value=fake_rows):
            result = tool._run("search")
        assert len(result) <= 3986
        assert "truncated" in result

    def test_arun_delegates(self):
        """Test _arun delegation."""
        tool = CodeGraphSearchTool()
        with patch("src.codegraph.tools.db.search", return_value=[]):
            result = asyncio.run(tool._arun("test"))
        assert result == "No results found."


class TestCodeGraphCallersTool:
    """Tests for CodeGraphCallersTool."""

    def test_formats_results_with_call_line(self):
        """Test formatting callers with call_line."""
        tool = CodeGraphCallersTool()
        fake_rows = [
            {
                "name": "executeTransfer",
                "kind": "function",
                "file_path": "demo_api_server/routes/agent.js",
                "start_line": 88,
                "qualified_name": "routes.agent.executeTransfer",
                "call_line": 102,
            }
        ]
        with patch("src.codegraph.tools.db.callers", return_value=fake_rows):
            result = tool._run("handleTransfer")
        assert "executeTransfer" in result
        assert "agent.js:88" in result
        assert "calls at line 102" in result or "line 102" in result

    def test_empty_returns_no_results(self):
        """Test empty callers result."""
        tool = CodeGraphCallersTool()
        with patch("src.codegraph.tools.db.callers", return_value=[]):
            result = tool._run("unused_function")
        assert result == "No results found."

    def test_multiple_callers(self):
        """Test multiple callers formatted."""
        tool = CodeGraphCallersTool()
        fake_rows = [
            {
                "name": "caller1",
                "kind": "function",
                "file_path": "file1.js",
                "start_line": 10,
                "qualified_name": "mod.caller1",
                "call_line": 20,
            },
            {
                "name": "caller2",
                "kind": "function",
                "file_path": "file2.js",
                "start_line": 50,
                "qualified_name": "mod.caller2",
                "call_line": 65,
            },
        ]
        with patch("src.codegraph.tools.db.callers", return_value=fake_rows):
            result = tool._run("target")
        assert "caller1" in result
        assert "caller2" in result
        assert "file1.js:10" in result
        assert "file2.js:50" in result

    def test_truncates_long_output(self):
        """Test truncation of long caller lists."""
        tool = CodeGraphCallersTool()
        fake_rows = [
            {
                "name": f"caller_{i}",
                "kind": "function",
                "file_path": f"path/to/file_{i}.js",
                "start_line": i,
                "qualified_name": f"mod.caller_{i}",
                "call_line": i + 1,
            }
            for i in range(150)
        ]
        with patch("src.codegraph.tools.db.callers", return_value=fake_rows):
            result = tool._run("target")
        assert len(result) <= 3986
        assert "truncated" in result

    def test_arun_delegates(self):
        """Test _arun delegation."""
        tool = CodeGraphCallersTool()
        with patch("src.codegraph.tools.db.callers", return_value=[]):
            result = asyncio.run(tool._arun("symbol"))
        assert result == "No results found."


class TestCodeGraphCalleesTool:
    """Tests for CodeGraphCalleesTool."""

    def test_formats_results_with_call_line(self):
        """Test formatting callees with call_line."""
        tool = CodeGraphCalleesTool()
        fake_rows = [
            {
                "name": "executePayment",
                "kind": "function",
                "file_path": "demo_api_server/services/payments.js",
                "start_line": 30,
                "qualified_name": "services.payments.executePayment",
                "call_line": 50,
            }
        ]
        with patch("src.codegraph.tools.db.callees", return_value=fake_rows):
            result = tool._run("handleTransfer")
        assert "executePayment" in result
        assert "payments.js:30" in result
        assert "calls at line 50" in result or "line 50" in result

    def test_empty_returns_no_results(self):
        """Test empty callees result."""
        tool = CodeGraphCalleesTool()
        with patch("src.codegraph.tools.db.callees", return_value=[]):
            result = tool._run("leaf_function")
        assert result == "No results found."

    def test_multiple_callees(self):
        """Test multiple callees formatted."""
        tool = CodeGraphCalleesTool()
        fake_rows = [
            {
                "name": "callee1",
                "kind": "function",
                "file_path": "file1.js",
                "start_line": 100,
                "qualified_name": "mod.callee1",
                "call_line": 120,
            },
            {
                "name": "callee2",
                "kind": "function",
                "file_path": "file2.js",
                "start_line": 200,
                "qualified_name": "mod.callee2",
                "call_line": 215,
            },
        ]
        with patch("src.codegraph.tools.db.callees", return_value=fake_rows):
            result = tool._run("source")
        assert "callee1" in result
        assert "callee2" in result
        assert "file1.js:100" in result
        assert "file2.js:200" in result

    def test_truncates_long_output(self):
        """Test truncation of long callee lists."""
        tool = CodeGraphCalleesTool()
        fake_rows = [
            {
                "name": f"callee_{i}",
                "kind": "function",
                "file_path": f"path/to/file_{i}.js",
                "start_line": i * 2,
                "qualified_name": f"mod.callee_{i}",
                "call_line": i * 2 + 1,
            }
            for i in range(150)
        ]
        with patch("src.codegraph.tools.db.callees", return_value=fake_rows):
            result = tool._run("source")
        assert len(result) <= 3986
        assert "truncated" in result

    def test_arun_delegates(self):
        """Test _arun delegation."""
        tool = CodeGraphCalleesTool()
        with patch("src.codegraph.tools.db.callees", return_value=[]):
            result = asyncio.run(tool._arun("symbol"))
        assert result == "No results found."


class TestGetCodegraphTools:
    """Tests for get_codegraph_tools factory function."""

    def test_returns_six_tools(self):
        """Factory returns the four codegraph tools plus grep + read_file."""
        tools = get_codegraph_tools()
        assert len(tools) == 6

    def test_tool_names(self):
        tools = get_codegraph_tools()
        names = {t.name for t in tools}
        expected_names = {
            "codegraph_explore",
            "codegraph_search",
            "codegraph_callers",
            "codegraph_callees",
            "grep",
            "read_file",
        }
        assert names == expected_names

    def test_tool_types(self):
        """Test that all returned objects are BaseTool instances."""
        from langchain_core.tools import BaseTool

        tools = get_codegraph_tools()
        for tool in tools:
            assert isinstance(tool, BaseTool)

    def test_tool_descriptions_exist(self):
        """Test that all tools have descriptions."""
        tools = get_codegraph_tools()
        for tool in tools:
            assert hasattr(tool, "description")
            assert tool.description
            assert len(tool.description) > 0

    def test_tool_instances_run_with_empty_db(self, tmp_path, monkeypatch):
        """Every tool runs without raising and returns a non-empty string.

        The db-backed tools are patched empty; the file tools (grep/read_file)
        are pointed at an empty REPO_SRC_ROOT so they return their own empty/
        not-found messages instead of scanning the live repo."""
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        tools = get_codegraph_tools()
        with patch("src.codegraph.tools.db.explore", return_value=[]), \
             patch("src.codegraph.tools.db.search", return_value=[]), \
             patch("src.codegraph.tools.db.callers", return_value=[]), \
             patch("src.codegraph.tools.db.callees", return_value=[]):
            for tool in tools:
                result = tool._run("test")
                assert isinstance(result, str) and result


class TestReadFileTool:
    """Tests for ReadFileTool."""

    def test_reads_whole_file_numbered(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        (tmp_path / "x.js").write_text("const a = 1;\nconst b = 2;\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = ReadFileTool()._run("x.js")
        assert "1\tconst a = 1;" in result
        assert "2\tconst b = 2;" in result

    def test_reads_line_window(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        (tmp_path / "x.py").write_text("\n".join(f"line{i}" for i in range(1, 21)) + "\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = ReadFileTool()._run("x.py:5:7")
        assert "5\tline5" in result
        assert "7\tline7" in result
        assert "line4" not in result
        assert "line8" not in result

    def test_missing_or_escaping_path(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "not found" in ReadFileTool()._run("nope.js").lower()
        assert "not found" in ReadFileTool()._run("../escape.js").lower()

    def test_empty_or_reversed_range(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        (tmp_path / "x.py").write_text("\n".join(f"line{i}" for i in range(1, 11)) + "\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        out = ReadFileTool()._run("x.py:7:3")
        assert "range" in out.lower()
        assert "(empty file)" not in out


class TestRepoGrepTool:
    """Tests for RepoGrepTool."""

    def test_finds_matches_with_file_line(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "svc").mkdir()
        (tmp_path / "svc" / "auth.js").write_text("function ruleStore() {}\nconst x = 1;\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = RepoGrepTool()._run("ruleStore")
        assert "svc/auth.js:1:" in result
        assert "ruleStore" in result

    def test_case_insensitive(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "a.py").write_text("DELEGATION_DB = 'x'\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "a.py:1:" in RepoGrepTool()._run("delegation")

    def test_no_matches(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "a.py").write_text("nothing here\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert RepoGrepTool()._run("zzz_no_match") == "No matches found."

    def test_invalid_regex(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "invalid regex" in RepoGrepTool()._run("(unclosed").lower()

    def test_spans_many_files_not_truncated_by_global_cap(self, tmp_path, monkeypatch):
        # A common token appears in 30 files (3x each). Per-file capping must let
        # results span the files (so a "defining" file late in walk order is still
        # shown) instead of a global match cap eating the budget on early files.
        for i in range(30):
            (tmp_path / f"f{i:02d}.js").write_text("foo\nfoo\nfoo\nbar\n")
        (tmp_path / "zzz_defining.js").write_text("function foo() {}\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        from src.codegraph.tools import RepoGrepTool
        out = RepoGrepTool()._run("foo")
        files = {ln.split(":")[0] for ln in out.splitlines() if ".js:" in ln}
        # Spans well beyond a handful of files...
        assert len(files) >= 20
        # ...and no single file contributes more than the per-file cap (2).
        from collections import Counter
        per_file = Counter(ln.split(":")[0] for ln in out.splitlines() if ".js:" in ln)
        assert max(per_file.values()) <= 2

    def test_matches_filename_even_without_content_match(self, tmp_path, monkeypatch):
        # A file NAMED after the concept whose body doesn't contain the term must
        # still surface (filename match), since grep is how the agent locates files.
        (tmp_path / "services").mkdir()
        (tmp_path / "services" / "mcpToolAuthorizationService.js").write_text(
            "function authorizeToolCall() { return true; }\n"
        )
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        from src.codegraph.tools import RepoGrepTool
        out = RepoGrepTool()._run("mcpToolAuthorization")
        assert "services/mcpToolAuthorizationService.js" in out
