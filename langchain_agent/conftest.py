# langchain_agent/conftest.py
"""
Root-level conftest for langchain_agent test suite.

Stubs langgraph at sys.modules level BEFORE any test or production module is
imported by pytest. This must live at the rootdir (next to pytest.ini), not
inside tests/, because pytest loads rootdir conftest.py before collection.
"""
import sys
from unittest.mock import Mock, MagicMock


def _stub_langgraph():
    """
    T-275-06: Stub langgraph so tests run without the package installed.

    create_react_agent and MemorySaver are mocked per-test in the test files;
    this stub only prevents the ImportError at module collection time.
    """
    if 'langgraph' not in sys.modules:
        langgraph_mock = MagicMock()
        langgraph_mock.prebuilt.create_react_agent = Mock(return_value=MagicMock())
        langgraph_mock.checkpoint.memory.MemorySaver = Mock(return_value=MagicMock())
        sys.modules['langgraph'] = langgraph_mock
        sys.modules['langgraph.prebuilt'] = langgraph_mock.prebuilt
        sys.modules['langgraph.checkpoint'] = langgraph_mock.checkpoint
        sys.modules['langgraph.checkpoint.memory'] = langgraph_mock.checkpoint.memory


_stub_langgraph()
