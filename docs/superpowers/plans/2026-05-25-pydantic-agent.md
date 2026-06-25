# PydanticAI Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully independent PydanticAI banking agent service (`pydantic_agent/`) that runs side-by-side with the existing LangChain agent, connects to the existing `demo_mcp_server` via Streamable HTTP, and is showcased through a new structured-output React component selectable from the UI.

**Architecture:** Standalone Python service in `pydantic_agent/` — zero imports from `langchain_agent/`. WebSocket chat on port 8893, health check on 8894. PydanticAI `Agent` with `MCPServerHTTP` connecting to `demo_mcp_server:8080/mcp`. New `PydanticAgent.jsx` React component renders structured turn state (reasoning steps, typed tool cards, final answer) rather than raw streamed text.

**Tech Stack:** Python 3.10+, pydantic-ai, websockets, httpx, PyJWT, python-dotenv, asyncio; React (CRA), existing `BankingAgent.css` patterns.

**Spec:** `docs/superpowers/specs/2026-05-25-pydantic-agent-design.md`

---

## File Map

### New files — Python service (`pydantic_agent/`)
| File | Responsibility |
|---|---|
| `pydantic_agent/requirements.txt` | All Python deps |
| `pydantic_agent/run.py` | Entry-point shim (`python run.py`) |
| `pydantic_agent/src/__init__.py` | Package marker |
| `pydantic_agent/src/main.py` | `PydanticAIApplication` — init, start, shutdown |
| `pydantic_agent/src/config/settings.py` | `AgentConfig`, `ChatConfig`, `MCPConfig` dataclasses + `ConfigManager` |
| `pydantic_agent/src/models/messages.py` | Wire protocol Pydantic models (all inbound + outbound types) |
| `pydantic_agent/src/agent/llm_factory.py` | Provider factory: Anthropic, Helix, Ollama, LM Studio |
| `pydantic_agent/src/agent/banking_agent.py` | PydanticAI `Agent`, `AgentResponse`, `ToolCall`, `ReasoningStep` |
| `pydantic_agent/src/agent/agent_runner.py` | Per-session message history, turn execution, streaming |
| `pydantic_agent/src/mcp/client.py` | `MCPServerHTTP` wrapper with dynamic auth headers |
| `pydantic_agent/src/mcp/auth_challenge.py` | Auth challenge state machine (CSRF, asyncio.Event, timeout) |
| `pydantic_agent/src/authentication/oauth_manager.py` | Client-credentials + PKCE token management |
| `pydantic_agent/src/api/health.py` | `GET /health`, `GET /inspector` FastAPI routes |
| `pydantic_agent/src/api/websocket_handler.py` | WebSocket server, connection lifecycle, message dispatch |
| `pydantic_agent/src/api/message_processor.py` | Per-session worker pool (WR-02 pattern) |

### New files — tests
| File | Covers |
|---|---|
| `pydantic_agent/tests/__init__.py` | Package marker |
| `pydantic_agent/tests/test_messages.py` | Wire protocol serialisation/deserialisation |
| `pydantic_agent/tests/test_settings.py` | Config loading from env vars |
| `pydantic_agent/tests/test_llm_factory.py` | Provider resolution |
| `pydantic_agent/tests/test_banking_agent.py` | `AgentResponse` model, system prompt |
| `pydantic_agent/tests/test_auth_challenge.py` | CSRF state machine, timeout, happy path |
| `pydantic_agent/tests/test_message_processor.py` | Per-session worker ordering |
| `pydantic_agent/tests/test_agent_runner.py` | Session memory, turn execution with TestModel |
| `pydantic_agent/tests/test_integration_websocket.py` | Connect → chat → disconnect flow |

### New files — React UI
| File | Responsibility |
|---|---|
| `demo_api_ui/src/services/pydanticAgentWebSocket.js` | Singleton WS client to port 8893 |
| `demo_api_ui/src/components/PydanticAgent.jsx` | Main component — structured turn rendering |
| `demo_api_ui/src/components/PydanticAgent.css` | Styling (light theme, blue accent) |

### Modified files
| File | Change |
|---|---|
| `run.sh` | Add PydanticAI agent start/stop/status/ports (mirrors LangChain block) |
| `demo_api_ui/src/components/AgentModeSelector.jsx` | Add "PydanticAI" tab that mounts `PydanticAgent` |
| `REGRESSION_PLAN.md` | Add ports 8893/8894 to §3 port table |

---

## Task 1: Scaffold the package and install dependencies

**Files:**
- Create: `pydantic_agent/requirements.txt`
- Create: `pydantic_agent/src/__init__.py`
- Create: `pydantic_agent/tests/__init__.py`
- Create: `pydantic_agent/run.py`

- [ ] **Step 1: Create the directory structure**

```bash
mkdir -p pydantic_agent/src/agent \
         pydantic_agent/src/api \
         pydantic_agent/src/authentication \
         pydantic_agent/src/config \
         pydantic_agent/src/mcp \
         pydantic_agent/src/models \
         pydantic_agent/tests
touch pydantic_agent/src/__init__.py \
      pydantic_agent/src/agent/__init__.py \
      pydantic_agent/src/api/__init__.py \
      pydantic_agent/src/authentication/__init__.py \
      pydantic_agent/src/config/__init__.py \
      pydantic_agent/src/mcp/__init__.py \
      pydantic_agent/src/models/__init__.py \
      pydantic_agent/tests/__init__.py
```

- [ ] **Step 2: Write `requirements.txt`**

```
# PydanticAI agent service
pydantic-ai[anthropic,openai,ollama]>=0.2.0
pydantic>=2.0.0,<3.0.0
fastapi>=0.100.0
uvicorn>=0.20.0
websockets>=11.0.0
httpx>=0.24.0
PyJWT[crypto]>=2.8.0
python-dotenv>=1.0.0
cryptography>=41.0.0

# Dev / test
pytest>=7.0.0
pytest-asyncio>=0.21.0
pytest-mock>=3.10.0
```

- [ ] **Step 3: Create venv and install**

```bash
cd pydantic_agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Expected: no errors. `pydantic-ai` installs cleanly.

- [ ] **Step 4: Write `run.py`**

```python
"""Entry-point shim — allows `python run.py` from pydantic_agent/ directory."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from src.main import main
import asyncio

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/
git commit -m "feat(pydantic-agent): scaffold package structure and requirements"
```

---

## Task 2: Wire protocol models

**Files:**
- Create: `pydantic_agent/src/models/messages.py`
- Create: `pydantic_agent/tests/test_messages.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_messages.py
import json
import pytest
from src.models.messages import (
    ChatMessage, AuthResponseMessage, PingMessage,
    ConnectedMessage, ErrorMessage, PongMessage,
    TurnStartMessage, TurnCompleteMessage, TokenDeltaMessage,
    ToolStartMessage, ToolResultMessage, ToolErrorMessage,
    AuthChallengeMessage, ReasoningStepMessage,
)

def test_chat_message_round_trip():
    msg = ChatMessage(session_id="s1", content="hello")
    data = json.loads(msg.model_dump_json())
    assert data["type"] == "chat_message"
    assert data["session_id"] == "s1"
    assert data["content"] == "hello"

def test_tool_result_has_typed_dict():
    msg = ToolResultMessage(
        turn_id="t1",
        tool_name="get_balance",
        result={"balance": 100.0, "currency": "USD"},
        duration_ms=42,
    )
    data = json.loads(msg.model_dump_json())
    assert data["result"]["balance"] == 100.0
    assert data["duration_ms"] == 42

def test_connected_has_agent_version():
    msg = ConnectedMessage(session_id="s1")
    data = json.loads(msg.model_dump_json())
    assert data["agent_version"] == "pydantic"

def test_error_message():
    msg = ErrorMessage(code="mcp_unavailable", message="MCP server not reachable")
    data = json.loads(msg.model_dump_json())
    assert data["type"] == "error"
    assert data["code"] == "mcp_unavailable"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_messages.py -v
```

Expected: `ImportError` — `src.models.messages` does not exist yet.

- [ ] **Step 3: Write `messages.py`**

```python
# pydantic_agent/src/models/messages.py
"""Wire protocol message types — all inbound and outbound WebSocket messages."""
from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel


# ── Inbound (client → server) ────────────────────────────────────────────────

class ChatMessage(BaseModel):
    type: Literal["chat_message"] = "chat_message"
    session_id: str
    content: str
    user_token: Optional[str] = None


class AuthResponseMessage(BaseModel):
    type: Literal["auth_response"] = "auth_response"
    session_id: str
    code: str
    state: str


class PingMessage(BaseModel):
    type: Literal["ping"] = "ping"


# ── Outbound (server → client) ───────────────────────────────────────────────

class ConnectedMessage(BaseModel):
    type: Literal["connected"] = "connected"
    session_id: str
    agent_version: Literal["pydantic"] = "pydantic"


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"


class TurnStartMessage(BaseModel):
    type: Literal["turn_start"] = "turn_start"
    session_id: str
    turn_id: str


class TurnCompleteMessage(BaseModel):
    type: Literal["turn_complete"] = "turn_complete"
    session_id: str
    turn_id: str
    final_text: str


class TokenDeltaMessage(BaseModel):
    type: Literal["token_delta"] = "token_delta"
    turn_id: str
    delta: str


class ToolStartMessage(BaseModel):
    type: Literal["tool_start"] = "tool_start"
    turn_id: str
    tool_name: str
    args: dict[str, Any]


class ToolResultMessage(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    turn_id: str
    tool_name: str
    result: dict[str, Any]
    duration_ms: int


class ToolErrorMessage(BaseModel):
    type: Literal["tool_error"] = "tool_error"
    turn_id: str
    tool_name: str
    error: str


class AuthChallengeMessage(BaseModel):
    type: Literal["auth_challenge"] = "auth_challenge"
    turn_id: str
    authorization_url: str
    scope: str
    expires_at: str
    state: str


class ReasoningStepMessage(BaseModel):
    type: Literal["reasoning_step"] = "reasoning_step"
    turn_id: str
    step_index: int
    thought: str
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_messages.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/models/messages.py pydantic_agent/tests/test_messages.py
git commit -m "feat(pydantic-agent): add wire protocol Pydantic message models"
```

---

## Task 3: Config system

**Files:**
- Create: `pydantic_agent/src/config/settings.py`
- Create: `pydantic_agent/tests/test_settings.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_settings.py
import os
import pytest
from src.config.settings import ConfigManager, AgentConfig


def test_config_loads_defaults(monkeypatch):
    """Config loads with minimal required env vars set."""
    monkeypatch.setenv("PINGONE_BASE_URL", "https://auth.pingone.com/test-env/as")
    monkeypatch.setenv("PINGONE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("PINGONE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("ENVIRONMENT", "test")
    cfg = ConfigManager().load_config()
    assert cfg.chat.websocket_port == 8893
    assert cfg.chat.health_port == 8894
    assert cfg.agent.provider == "helix"


def test_config_provider_from_env(monkeypatch):
    monkeypatch.setenv("PINGONE_BASE_URL", "https://auth.pingone.com/test-env/as")
    monkeypatch.setenv("PINGONE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("PINGONE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("AGENT_PROVIDER", "anthropic")
    cfg = ConfigManager().load_config()
    assert cfg.agent.provider == "anthropic"


def test_mcp_url_default(monkeypatch):
    monkeypatch.setenv("PINGONE_BASE_URL", "https://auth.pingone.com/test-env/as")
    monkeypatch.setenv("PINGONE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("PINGONE_CLIENT_SECRET", "test-secret")
    cfg = ConfigManager().load_config()
    assert cfg.mcp.server_url == "http://localhost:8080/mcp"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_settings.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `settings.py`**

```python
# pydantic_agent/src/config/settings.py
"""Configuration dataclasses and loader for the PydanticAI agent service."""
from __future__ import annotations
import os
from dataclasses import dataclass
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


@dataclass
class AgentConfig:
    """LLM provider + model settings."""
    provider: str = "helix"          # helix | anthropic | ollama | lmstudio
    model_name: str = "claude-sonnet-4-6"
    temperature: float = 0.7
    max_tokens: int = 1000
    # Anthropic (direct cloud)
    anthropic_api_key: str = ""
    anthropic_base_url: str = ""     # override for LM Studio compat
    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    # LM Studio (OpenAI-compat)
    lmstudio_base_url: str = "http://localhost:1234/v1"
    # Helix
    helix_base_url: str = "https://openam-helix.forgeblocks.com"
    helix_api_key: str = ""
    helix_environment_id: str = ""
    helix_agent_id: str = ""
    helix_prompt_field_id: str = ""


@dataclass
class ChatConfig:
    """WebSocket server settings."""
    websocket_port: int = 8893
    health_port: int = 8894
    max_message_length: int = 4096
    max_session_workers: int = 50
    session_worker_idle_ttl_seconds: int = 900
    session_worker_reap_interval_seconds: int = 60
    auth_challenge_timeout_seconds: int = 120


@dataclass
class MCPConfig:
    """MCP server connection settings (Streamable HTTP)."""
    server_url: str = "http://localhost:8080/mcp"
    connection_timeout_seconds: int = 30
    retry_attempts: int = 3


@dataclass
class PingOneConfig:
    """PingOne OAuth settings."""
    base_url: str          # e.g. https://auth.pingone.com/<env-id>/as
    client_id: str
    client_secret: str
    redirect_uri: str = "http://localhost:8893/auth/callback"
    default_scope: str = "openid profile"


@dataclass
class AppConfig:
    """Root config object."""
    environment: str
    debug: bool
    log_level: str
    agent: AgentConfig
    chat: ChatConfig
    mcp: MCPConfig
    pingone: PingOneConfig


class ConfigManager:
    """Loads AppConfig from environment variables."""

    def __init__(self) -> None:
        self._config: Optional[AppConfig] = None

    def load_config(self, environment: Optional[str] = None) -> AppConfig:
        if self._config is None:
            self._config = self._build()
        return self._config

    def _build(self) -> AppConfig:
        env = os.getenv("ENVIRONMENT", "development")
        debug = os.getenv("DEBUG", "false").lower() == "true"
        log_level = os.getenv("LOG_LEVEL", "INFO")

        agent = AgentConfig(
            provider=os.getenv("AGENT_PROVIDER", "helix"),
            model_name=os.getenv("AGENT_MODEL_NAME", "claude-sonnet-4-6"),
            temperature=float(os.getenv("AGENT_TEMPERATURE", "0.7")),
            max_tokens=int(os.getenv("AGENT_MAX_TOKENS", "1000")),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
            anthropic_base_url=os.getenv("ANTHROPIC_BASE_URL", ""),
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            lmstudio_base_url=os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
            helix_base_url=os.getenv("HELIX_BASE_URL", "https://openam-helix.forgeblocks.com"),
            helix_api_key=os.getenv("HELIX_API_KEY", ""),
            helix_environment_id=os.getenv("HELIX_ENVIRONMENT_ID", ""),
            helix_agent_id=os.getenv("HELIX_AGENT_ID", ""),
            helix_prompt_field_id=os.getenv("HELIX_PROMPT_FIELD_ID", ""),
        )

        chat = ChatConfig(
            websocket_port=int(os.getenv("PYDANTIC_WS_PORT", "8893")),
            health_port=int(os.getenv("PYDANTIC_HEALTH_PORT", "8894")),
            max_message_length=int(os.getenv("MAX_MESSAGE_LENGTH", "4096")),
            max_session_workers=int(os.getenv("MAX_SESSION_WORKERS", "50")),
            session_worker_idle_ttl_seconds=int(os.getenv("SESSION_WORKER_IDLE_TTL", "900")),
            session_worker_reap_interval_seconds=int(os.getenv("SESSION_WORKER_REAP_INTERVAL", "60")),
            auth_challenge_timeout_seconds=int(os.getenv("AUTH_CHALLENGE_TIMEOUT", "120")),
        )

        mcp = MCPConfig(
            server_url=os.getenv("MCP_SERVER_URL", "http://localhost:8080/mcp"),
            connection_timeout_seconds=int(os.getenv("MCP_CONNECTION_TIMEOUT", "30")),
            retry_attempts=int(os.getenv("MCP_RETRY_ATTEMPTS", "3")),
        )

        pingone = PingOneConfig(
            base_url=os.environ["PINGONE_BASE_URL"],
            client_id=os.environ["PINGONE_CLIENT_ID"],
            client_secret=os.environ["PINGONE_CLIENT_SECRET"],
            redirect_uri=os.getenv("PINGONE_REDIRECT_URI", "http://localhost:8893/auth/callback"),
            default_scope=os.getenv("PINGONE_DEFAULT_SCOPE", "openid profile"),
        )

        return AppConfig(
            environment=env,
            debug=debug,
            log_level=log_level,
            agent=agent,
            chat=chat,
            mcp=mcp,
            pingone=pingone,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_settings.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/config/settings.py pydantic_agent/tests/test_settings.py
git commit -m "feat(pydantic-agent): add config system with dataclasses + env var loader"
```

---

## Task 4: LLM factory

**Files:**
- Create: `pydantic_agent/src/agent/llm_factory.py`
- Create: `pydantic_agent/tests/test_llm_factory.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_llm_factory.py
import pytest
from unittest.mock import patch
from src.config.settings import AgentConfig
from src.agent.llm_factory import get_model


def test_anthropic_provider_returns_model():
    cfg = AgentConfig(
        provider="anthropic",
        model_name="claude-sonnet-4-6",
        anthropic_api_key="test-key",
    )
    with patch("src.agent.llm_factory.AnthropicModel") as MockModel:
        get_model(cfg)
        MockModel.assert_called_once_with(
            "claude-sonnet-4-6",
            provider=pytest.approx,  # AnthropicProvider instance
        )


def test_unknown_provider_raises():
    cfg = AgentConfig(provider="unknown_xyz")
    with pytest.raises(ValueError, match="Unknown AGENT_PROVIDER"):
        get_model(cfg)


def test_ollama_provider():
    cfg = AgentConfig(
        provider="ollama",
        model_name="llama3.2",
        ollama_base_url="http://localhost:11434",
    )
    with patch("src.agent.llm_factory.OllamaModel") as MockModel:
        get_model(cfg)
        MockModel.assert_called_once()


def test_lmstudio_provider():
    cfg = AgentConfig(
        provider="lmstudio",
        model_name="my-model",
        lmstudio_base_url="http://localhost:1234/v1",
    )
    # LM Studio uses OpenAI-compat via AnthropicModel with custom base_url
    with patch("src.agent.llm_factory.OpenAIModel") as MockModel:
        get_model(cfg)
        MockModel.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_llm_factory.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `llm_factory.py`**

```python
# pydantic_agent/src/agent/llm_factory.py
"""LLM provider factory — returns a pydantic-ai Model for the configured provider.

Providers:
  anthropic  — Anthropic cloud (claude-sonnet-4-6 default). Requires ANTHROPIC_API_KEY.
               Set ANTHROPIC_BASE_URL to route to LM Studio Anthropic-compat endpoint.
  ollama     — Local Ollama. Requires OLLAMA_BASE_URL (default: http://localhost:11434).
  lmstudio   — LM Studio OpenAI-compat endpoint (default: http://localhost:1234/v1).
  helix      — Helix via custom HelixtModel (HTTP wrapper around Helix API).
"""
from __future__ import annotations
import logging
from typing import Any

from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.anthropic import AnthropicProvider
from pydantic_ai.providers.openai import OpenAIProvider

from src.config.settings import AgentConfig

logger = logging.getLogger(__name__)


def get_model(cfg: AgentConfig) -> Any:
    """Return a pydantic-ai model instance for the given provider config."""
    provider = cfg.provider.lower()

    if provider == "anthropic":
        logger.info("LLM provider: Anthropic (model=%s)", cfg.model_name)
        kwargs: dict[str, Any] = {}
        if cfg.anthropic_base_url:
            # Route to LM Studio Anthropic-compat endpoint
            kwargs["provider"] = AnthropicProvider(
                api_key=cfg.anthropic_api_key or "lm-studio",
                base_url=cfg.anthropic_base_url,
            )
        else:
            kwargs["provider"] = AnthropicProvider(api_key=cfg.anthropic_api_key)
        return AnthropicModel(cfg.model_name, **kwargs)

    elif provider == "ollama":
        logger.info("LLM provider: Ollama (model=%s, url=%s)", cfg.model_name, cfg.ollama_base_url)
        try:
            from pydantic_ai.models.ollama import OllamaModel
        except ImportError as e:
            raise ImportError("pydantic-ai[ollama] extra not installed") from e
        return OllamaModel(cfg.model_name, base_url=cfg.ollama_base_url)

    elif provider == "lmstudio":
        logger.info("LLM provider: LM Studio OpenAI-compat (model=%s, url=%s)", cfg.model_name, cfg.lmstudio_base_url)
        return OpenAIModel(
            cfg.model_name,
            provider=OpenAIProvider(
                api_key="lm-studio",
                base_url=cfg.lmstudio_base_url,
            ),
        )

    elif provider == "helix":
        logger.info("LLM provider: Helix (agent=%s)", cfg.helix_agent_id)
        from src.agent.helix_model import HelixModel
        return HelixModel(cfg)

    else:
        raise ValueError(
            f"Unknown AGENT_PROVIDER={cfg.provider!r}. "
            "Valid options: anthropic, ollama, lmstudio, helix"
        )
```

- [ ] **Step 4: Create Helix model stub** (minimal — avoids import error; full implementation in Task 5)

```python
# pydantic_agent/src/agent/helix_model.py
"""Helix LLM model — wraps Helix HTTP API as a pydantic-ai Model.

Helix is a private LLM gateway. This is a stub that raises NotImplementedError
until the full implementation is added in Task 5. The factory will fall back to
anthropic if helix is not configured.
"""
from __future__ import annotations
from src.config.settings import AgentConfig


class HelixModel:
    """Stub — raises on use if Helix env vars are not configured."""

    def __init__(self, cfg: AgentConfig) -> None:
        self.cfg = cfg
        if not cfg.helix_api_key:
            raise ValueError(
                "HELIX_API_KEY is required for provider=helix. "
                "Set AGENT_PROVIDER=anthropic to use Anthropic instead."
            )
```

- [ ] **Step 5: Fix test — update assertion style**

The `test_anthropic_provider_returns_model` assertion is too strict with `pytest.approx`. Replace that test body:

```python
def test_anthropic_provider_returns_model():
    cfg = AgentConfig(
        provider="anthropic",
        model_name="claude-sonnet-4-6",
        anthropic_api_key="test-key",
    )
    with patch("src.agent.llm_factory.AnthropicModel") as MockModel:
        get_model(cfg)
        assert MockModel.called
        call_args = MockModel.call_args
        assert call_args[0][0] == "claude-sonnet-4-6"
```

- [ ] **Step 6: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_llm_factory.py -v
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add pydantic_agent/src/agent/llm_factory.py \
        pydantic_agent/src/agent/helix_model.py \
        pydantic_agent/tests/test_llm_factory.py
git commit -m "feat(pydantic-agent): add LLM factory (Anthropic, Ollama, LM Studio, Helix stub)"
```

---

## Task 5: Banking agent + structured output types

**Files:**
- Create: `pydantic_agent/src/agent/banking_agent.py`
- Create: `pydantic_agent/tests/test_banking_agent.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_banking_agent.py
import pytest
from src.agent.banking_agent import AgentResponse, ToolCall, ReasoningStep


def test_agent_response_defaults():
    r = AgentResponse(final_text="Hello")
    assert r.tool_calls == []
    assert r.reasoning_steps == []


def test_agent_response_with_tool_call():
    r = AgentResponse(
        final_text="Your balance is $100",
        tool_calls=[
            ToolCall(
                tool_name="get_account_balance",
                args={"account_id": "acc_123"},
                result={"balance": 100.0, "currency": "USD"},
                duration_ms=38,
            )
        ],
        reasoning_steps=[
            ReasoningStep(step_index=1, thought="User wants balance, calling get_account_balance.")
        ],
    )
    assert len(r.tool_calls) == 1
    assert r.tool_calls[0].tool_name == "get_account_balance"
    assert r.reasoning_steps[0].step_index == 1


def test_system_prompt_contains_identity():
    from src.agent.banking_agent import build_system_prompt
    prompt = build_system_prompt(user_id="user_42", display_name="Alice")
    assert "Alice" in prompt
    assert "user_42" in prompt


def test_system_prompt_no_user():
    from src.agent.banking_agent import build_system_prompt
    prompt = build_system_prompt()
    assert isinstance(prompt, str)
    assert len(prompt) > 50
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_banking_agent.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `banking_agent.py`**

```python
# pydantic_agent/src/agent/banking_agent.py
"""PydanticAI banking agent — Agent definition, structured output types, system prompt."""
from __future__ import annotations
import logging
from typing import Any, Optional

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerHTTP

from src.config.settings import AppConfig
from src.agent.llm_factory import get_model

logger = logging.getLogger(__name__)


# ── Structured output types ──────────────────────────────────────────────────

class ToolCall(BaseModel):
    tool_name: str
    args: dict[str, Any]
    result: Optional[dict[str, Any]] = None
    duration_ms: Optional[int] = None


class ReasoningStep(BaseModel):
    step_index: int
    thought: str


class AgentResponse(BaseModel):
    final_text: str
    tool_calls: list[ToolCall] = []
    reasoning_steps: list[ReasoningStep] = []


# ── System prompt ────────────────────────────────────────────────────────────

def build_system_prompt(
    user_id: Optional[str] = None,
    display_name: Optional[str] = None,
) -> str:
    """Build the agent system prompt, optionally personalised to the current user."""
    identity = ""
    if display_name and user_id:
        identity = f"\nThe current user is {display_name} (user ID: {user_id})."
    elif display_name:
        identity = f"\nThe current user is {display_name}."

    return f"""You are a helpful banking assistant for a demo banking application.
You have access to banking tools via MCP that let you retrieve account balances,
transaction history, and perform transfers on behalf of the authenticated user.{identity}

Always be professional and concise. When you use a tool, explain what you found
in plain language. Never expose raw token values or internal IDs unless explicitly
asked. If a tool fails, explain the failure clearly and suggest next steps."""


# ── Agent factory ────────────────────────────────────────────────────────────

def create_banking_agent(
    config: AppConfig,
    get_agent_token: Any,  # callable () -> str
) -> Agent[None, AgentResponse]:
    """Create and return the PydanticAI banking Agent.

    Args:
        config: Application config.
        get_agent_token: Zero-arg callable that returns the current bearer token
                         string for the MCP server. Called on each request so the
                         token is always fresh.
    """
    model = get_model(config.agent)

    mcp_server = MCPServerHTTP(
        url=config.mcp.server_url,
        headers=lambda: {"Authorization": f"Bearer {get_agent_token()}"},
        timeout=config.mcp.connection_timeout_seconds,
    )

    agent: Agent[None, AgentResponse] = Agent(
        model=model,
        mcp_servers=[mcp_server],
        result_type=AgentResponse,
        system_prompt=build_system_prompt(),
    )

    return agent
```

- [ ] **Step 4: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_banking_agent.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/agent/banking_agent.py pydantic_agent/tests/test_banking_agent.py
git commit -m "feat(pydantic-agent): add AgentResponse structured types and banking agent factory"
```

---

## Task 6: Auth challenge state machine

**Files:**
- Create: `pydantic_agent/src/mcp/auth_challenge.py`
- Create: `pydantic_agent/tests/test_auth_challenge.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_auth_challenge.py
import asyncio
import pytest
from src.mcp.auth_challenge import AuthChallengeManager


@pytest.mark.asyncio
async def test_register_and_resolve_challenge():
    mgr = AuthChallengeManager(timeout_seconds=5)
    state = mgr.register_challenge("session-1", "http://auth.example.com/authorize", "openid")
    # State is a random token, not predictable
    assert len(state) >= 20

    # Resolve it
    mgr.resolve_challenge(state, code="auth-code-abc")

    code = await mgr.wait_for_code(state)
    assert code == "auth-code-abc"


@pytest.mark.asyncio
async def test_unknown_state_raises():
    mgr = AuthChallengeManager(timeout_seconds=1)
    with pytest.raises(KeyError):
        mgr.resolve_challenge("unknown-state-xyz", code="some-code")


@pytest.mark.asyncio
async def test_timeout_raises():
    mgr = AuthChallengeManager(timeout_seconds=0.1)
    state = mgr.register_challenge("session-2", "http://auth.example.com/authorize", "openid")
    with pytest.raises(asyncio.TimeoutError):
        await mgr.wait_for_code(state)


@pytest.mark.asyncio
async def test_state_not_reusable_after_resolved():
    mgr = AuthChallengeManager(timeout_seconds=5)
    state = mgr.register_challenge("session-3", "http://auth.example.com/authorize", "openid")
    mgr.resolve_challenge(state, code="code-1")
    await mgr.wait_for_code(state)
    # Second resolution should raise
    with pytest.raises(KeyError):
        mgr.resolve_challenge(state, code="code-2")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_auth_challenge.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `auth_challenge.py`**

```python
# pydantic_agent/src/mcp/auth_challenge.py
"""Auth challenge state machine.

Manages the lifecycle of a PingOne OAuth popup triggered during a tool call:
  1. register_challenge()  — creates a CSRF-safe state token, stores pending entry
  2. get_challenge_info()  — returns the auth URL for sending to the UI
  3. resolve_challenge()   — called when UI sends back auth_response; sets Event
  4. wait_for_code()       — awaited by the tool function; blocks until resolved or timeout
"""
from __future__ import annotations
import asyncio
import logging
import secrets
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class _PendingChallenge:
    session_id: str
    authorization_url: str
    scope: str
    event: asyncio.Event
    code: Optional[str] = None


class AuthChallengeManager:
    """Thread-safe (asyncio) manager for pending auth challenges."""

    def __init__(self, timeout_seconds: float = 120.0) -> None:
        self._timeout = timeout_seconds
        self._pending: dict[str, _PendingChallenge] = {}

    def register_challenge(
        self,
        session_id: str,
        authorization_url: str,
        scope: str,
    ) -> str:
        """Register a new pending challenge. Returns the CSRF state token."""
        state = secrets.token_urlsafe(32)
        self._pending[state] = _PendingChallenge(
            session_id=session_id,
            authorization_url=authorization_url,
            scope=scope,
            event=asyncio.Event(),
        )
        logger.debug("Auth challenge registered: session=%s state=%s", session_id, state[:8])
        return state

    def resolve_challenge(self, state: str, code: str) -> None:
        """Called when the UI returns the auth code. Signals the waiting tool."""
        if state not in self._pending:
            raise KeyError(f"Unknown or expired auth challenge state: {state!r}")
        challenge = self._pending[state]
        challenge.code = code
        challenge.event.set()
        logger.debug("Auth challenge resolved: state=%s", state[:8])

    async def wait_for_code(self, state: str) -> str:
        """Await the auth code for the given state. Raises asyncio.TimeoutError on timeout."""
        if state not in self._pending:
            raise KeyError(f"Unknown auth challenge state: {state!r}")
        challenge = self._pending[state]
        try:
            await asyncio.wait_for(challenge.event.wait(), timeout=self._timeout)
            code = challenge.code
            assert code is not None
            return code
        finally:
            # Remove after use — state is not reusable
            self._pending.pop(state, None)

    def get_challenge_info(self, state: str) -> tuple[str, str]:
        """Return (authorization_url, scope) for the given state."""
        if state not in self._pending:
            raise KeyError(f"Unknown auth challenge state: {state!r}")
        c = self._pending[state]
        return c.authorization_url, c.scope
```

- [ ] **Step 4: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_auth_challenge.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/mcp/auth_challenge.py pydantic_agent/tests/test_auth_challenge.py
git commit -m "feat(pydantic-agent): add auth challenge state machine with CSRF + timeout"
```

---

## Task 7: OAuth manager

**Files:**
- Create: `pydantic_agent/src/authentication/oauth_manager.py`

No new tests here — the OAuth patterns are already battle-tested in `langchain_agent`. We write a focused minimal version with one test covering token caching.

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_oauth_manager.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from src.authentication.oauth_manager import OAuthManager
from src.config.settings import PingOneConfig


@pytest.fixture
def pingone_config():
    return PingOneConfig(
        base_url="https://auth.pingone.com/test-env/as",
        client_id="client-id",
        client_secret="client-secret",
    )


@pytest.mark.asyncio
async def test_get_agent_token_caches_result(pingone_config):
    mgr = OAuthManager(pingone_config)
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "access_token": "tok-abc",
        "expires_in": 3600,
        "token_type": "Bearer",
    }
    mock_response.raise_for_status = MagicMock()

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        token1 = await mgr.get_agent_token()
        token2 = await mgr.get_agent_token()  # Should use cache

    assert token1 == "tok-abc"
    assert token2 == "tok-abc"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_oauth_manager.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `oauth_manager.py`**

```python
# pydantic_agent/src/authentication/oauth_manager.py
"""OAuth manager — client credentials token for agent MCP calls.

Fetches and caches a client-credentials access token from PingOne.
Token is refreshed 5 minutes before expiry.
"""
from __future__ import annotations
import logging
import time
from typing import Optional

import httpx

from src.config.settings import PingOneConfig

logger = logging.getLogger(__name__)

_EXPIRY_BUFFER_SECONDS = 300


class OAuthManager:
    def __init__(self, config: PingOneConfig) -> None:
        self._config = config
        self._token: Optional[str] = None
        self._expires_at: float = 0.0

    def get_agent_token_sync(self) -> str:
        """Synchronous accessor for lambda use in MCPServerHTTP headers."""
        # Returns cached token if still valid; otherwise returns empty string
        # (caller must ensure async init happened).
        return self._token or ""

    async def get_agent_token(self) -> str:
        """Return a valid client-credentials access token, refreshing if needed."""
        if self._token and time.time() < self._expires_at - _EXPIRY_BUFFER_SECONDS:
            return self._token
        return await self._fetch_token()

    async def _fetch_token(self) -> str:
        token_url = f"{self._config.base_url}/token"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._config.client_id,
                    "client_secret": self._config.client_secret,
                    "scope": self._config.default_scope,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()

        self._token = data["access_token"]
        self._expires_at = time.time() + int(data.get("expires_in", 3600))
        logger.info("Agent token refreshed (expires_in=%s)", data.get("expires_in"))
        return self._token
```

- [ ] **Step 4: Run test**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_oauth_manager.py -v
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/authentication/oauth_manager.py \
        pydantic_agent/tests/test_oauth_manager.py
git commit -m "feat(pydantic-agent): add OAuth manager (client credentials + token cache)"
```

---

## Task 8: Agent runner (session memory + turn execution)

**Files:**
- Create: `pydantic_agent/src/agent/agent_runner.py`
- Create: `pydantic_agent/tests/test_agent_runner.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_agent_runner.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.agent.agent_runner import AgentRunner
from src.agent.banking_agent import AgentResponse


@pytest.fixture
def mock_agent():
    agent = MagicMock()
    agent.run = AsyncMock(return_value=MagicMock(
        data=AgentResponse(final_text="Hello!"),
        new_messages=lambda: [],
    ))
    return agent


def test_new_session_has_empty_history(mock_agent):
    runner = AgentRunner(agent=mock_agent)
    assert runner.get_history("session-new") == []


@pytest.mark.asyncio
async def test_run_turn_returns_response(mock_agent):
    runner = AgentRunner(agent=mock_agent)
    response = await runner.run_turn(
        session_id="sess-1",
        user_message="What is my balance?",
        turn_id="turn-1",
    )
    assert response.final_text == "Hello!"


@pytest.mark.asyncio
async def test_history_grows_after_turn(mock_agent):
    fake_messages = [MagicMock(), MagicMock()]
    mock_agent.run.return_value.new_messages = lambda: fake_messages
    runner = AgentRunner(agent=mock_agent)
    await runner.run_turn(session_id="sess-2", user_message="Hi", turn_id="t1")
    assert len(runner.get_history("sess-2")) == 2


def test_clear_session(mock_agent):
    runner = AgentRunner(agent=mock_agent)
    runner._history["sess-3"] = [MagicMock()]
    runner.clear_session("sess-3")
    assert runner.get_history("sess-3") == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_agent_runner.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `agent_runner.py`**

```python
# pydantic_agent/src/agent/agent_runner.py
"""Agent runner — manages per-session message history and executes turns.

Each turn calls agent.run() with the full message history for the session,
then appends the new messages returned by PydanticAI to the history.
"""
from __future__ import annotations
import logging
import time
from typing import Any, Optional

from pydantic_ai import Agent
from src.agent.banking_agent import AgentResponse

logger = logging.getLogger(__name__)

# Sessions idle longer than this are reaped
_SESSION_IDLE_TTL = 900  # seconds


class AgentRunner:
    def __init__(self, agent: Agent) -> None:
        self._agent = agent
        self._history: dict[str, list[Any]] = {}
        self._last_activity: dict[str, float] = {}

    def get_history(self, session_id: str) -> list[Any]:
        return self._history.get(session_id, [])

    def clear_session(self, session_id: str) -> None:
        self._history.pop(session_id, None)
        self._last_activity.pop(session_id, None)

    async def run_turn(
        self,
        session_id: str,
        user_message: str,
        turn_id: str,
        user_prompt_suffix: Optional[str] = None,
    ) -> AgentResponse:
        """Execute one agent turn and return structured AgentResponse."""
        history = self._history.get(session_id, [])
        message = user_message
        if user_prompt_suffix:
            message = f"{user_message}\n\n{user_prompt_suffix}"

        logger.info("Agent turn: session=%s turn=%s", session_id, turn_id)
        result = await self._agent.run(
            message,
            message_history=history,
        )

        # Append new messages to session history
        new_msgs = result.new_messages()
        self._history.setdefault(session_id, []).extend(new_msgs)
        self._last_activity[session_id] = time.time()

        return result.data

    def reap_idle_sessions(self) -> int:
        """Remove sessions idle longer than _SESSION_IDLE_TTL. Returns count reaped."""
        now = time.time()
        stale = [
            sid for sid, last in self._last_activity.items()
            if now - last > _SESSION_IDLE_TTL
        ]
        for sid in stale:
            self.clear_session(sid)
        if stale:
            logger.info("Reaped %d idle sessions", len(stale))
        return len(stale)
```

- [ ] **Step 4: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_agent_runner.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/agent/agent_runner.py pydantic_agent/tests/test_agent_runner.py
git commit -m "feat(pydantic-agent): add agent runner with session history + idle reap"
```

---

## Task 9: Message processor (per-session worker pool)

**Files:**
- Create: `pydantic_agent/src/api/message_processor.py`
- Create: `pydantic_agent/tests/test_message_processor.py`

- [ ] **Step 1: Write the failing test**

```python
# pydantic_agent/tests/test_message_processor.py
import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock
from src.api.message_processor import MessageProcessor


@pytest.fixture
def mock_handler():
    return AsyncMock()


@pytest.mark.asyncio
async def test_messages_for_same_session_are_ordered(mock_handler):
    """Messages for the same session are processed in submission order."""
    results = []
    order_barrier = asyncio.Barrier(2)

    async def handler(session_id: str, message: str):
        results.append(message)

    processor = MessageProcessor(handler=handler, max_workers=10)
    await processor.start()

    await processor.enqueue("sess-1", "first")
    await processor.enqueue("sess-1", "second")
    await asyncio.sleep(0.1)  # let workers run
    await processor.stop()

    assert results == ["first", "second"]


@pytest.mark.asyncio
async def test_different_sessions_are_independent(mock_handler):
    call_count = {"n": 0}

    async def handler(session_id: str, message: str):
        call_count["n"] += 1

    processor = MessageProcessor(handler=handler, max_workers=10)
    await processor.start()
    await processor.enqueue("sess-a", "hello")
    await processor.enqueue("sess-b", "hello")
    await asyncio.sleep(0.1)
    await processor.stop()

    assert call_count["n"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_message_processor.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `message_processor.py`**

```python
# pydantic_agent/src/api/message_processor.py
"""Per-session message processor — WR-02 pattern.

Each session gets its own asyncio.Queue + one worker Task.
Messages within a session are processed in strict order.
Different sessions run concurrently.
"""
from __future__ import annotations
import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


class MessageProcessor:
    def __init__(
        self,
        handler: Callable[[str, str], Awaitable[None]],
        max_workers: int = 50,
        idle_ttl_seconds: float = 900,
        reap_interval_seconds: float = 60,
    ) -> None:
        self._handler = handler
        self._max_workers = max_workers
        self._idle_ttl = idle_ttl_seconds
        self._reap_interval = reap_interval_seconds
        self._queues: dict[str, asyncio.Queue] = {}
        self._workers: dict[str, asyncio.Task] = {}
        self._last_activity: dict[str, float] = {}
        self._reaper_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._reaper_task = asyncio.create_task(self._reaper_loop())

    async def stop(self) -> None:
        self._running = False
        if self._reaper_task:
            self._reaper_task.cancel()
            try:
                await self._reaper_task
            except asyncio.CancelledError:
                pass
        for task in list(self._workers.values()):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def enqueue(self, session_id: str, message: str) -> None:
        if session_id not in self._queues:
            if len(self._workers) >= self._max_workers:
                raise RuntimeError(
                    f"Max session workers ({self._max_workers}) reached. "
                    "Try again in a moment."
                )
            self._queues[session_id] = asyncio.Queue()
            self._workers[session_id] = asyncio.create_task(
                self._worker(session_id)
            )
        self._queues[session_id].put_nowait(message)
        self._last_activity[session_id] = time.time()

    async def _worker(self, session_id: str) -> None:
        queue = self._queues[session_id]
        while True:
            message = await queue.get()
            try:
                await self._handler(session_id, message)
            except Exception:
                logger.exception("Error processing message for session=%s", session_id)
            finally:
                queue.task_done()

    async def _reaper_loop(self) -> None:
        while self._running:
            await asyncio.sleep(self._reap_interval)
            now = time.time()
            stale = [
                sid for sid, last in self._last_activity.items()
                if now - last > self._idle_ttl and self._queues[sid].empty()
            ]
            for sid in stale:
                task = self._workers.pop(sid, None)
                if task:
                    task.cancel()
                self._queues.pop(sid, None)
                self._last_activity.pop(sid, None)
                logger.debug("Reaped idle worker: session=%s", sid)
```

- [ ] **Step 4: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_message_processor.py -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/api/message_processor.py pydantic_agent/tests/test_message_processor.py
git commit -m "feat(pydantic-agent): add per-session message processor (WR-02 pattern)"
```

---

## Task 10: Health check server

**Files:**
- Create: `pydantic_agent/src/api/health.py`

- [ ] **Step 1: Write `health.py`**

```python
# pydantic_agent/src/api/health.py
"""Health check HTTP server — GET /health and GET /inspector."""
from __future__ import annotations
import asyncio
import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

logger = logging.getLogger(__name__)


class _HealthHandler(BaseHTTPRequestHandler):
    status: dict[str, Any] = {}

    def do_GET(self) -> None:
        if self.path == "/health":
            body = json.dumps({
                "status": "ok",
                "service": "pydantic-agent",
                **self.status,
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/inspector":
            body = json.dumps({
                "service": "pydantic-agent",
                "ws_port": self.status.get("ws_port", 8893),
                "mcp_url": self.status.get("mcp_url", ""),
                "provider": self.status.get("provider", ""),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        pass  # Suppress default access log noise


async def start_health_server(port: int, status: dict[str, Any]) -> None:
    """Start the health check HTTP server in a thread-pool executor."""
    _HealthHandler.status = status
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    logger.info("Health server listening on :%d", port)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, server.serve_forever)
```

- [ ] **Step 2: Quick smoke test**

```bash
cd pydantic_agent
.venv/bin/python -c "
import asyncio, httpx, threading, time
from src.api.health import start_health_server

async def run():
    asyncio.create_task(start_health_server(18894, {'ws_port': 8893}))
    await asyncio.sleep(0.2)
    r = httpx.get('http://localhost:18894/health')
    assert r.status_code == 200, r.text
    assert r.json()['status'] == 'ok'
    print('Health check OK')

asyncio.run(run())
"
```

Expected: `Health check OK`

- [ ] **Step 3: Commit**

```bash
git add pydantic_agent/src/api/health.py
git commit -m "feat(pydantic-agent): add health check HTTP server"
```

---

## Task 11: WebSocket handler

**Files:**
- Create: `pydantic_agent/src/api/websocket_handler.py`
- Create: `pydantic_agent/tests/test_integration_websocket.py`

- [ ] **Step 1: Write the failing integration test**

```python
# pydantic_agent/tests/test_integration_websocket.py
import asyncio
import json
import pytest
import websockets
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_connect_receives_connected_message():
    """Connecting to the WebSocket server returns a 'connected' message."""
    from src.api.websocket_handler import WebSocketHandler

    mock_processor = MagicMock()
    mock_processor.enqueue = AsyncMock()
    mock_processor.start = AsyncMock()
    mock_processor.stop = AsyncMock()

    handler = WebSocketHandler(
        message_processor=mock_processor,
        port=18893,
    )
    await handler.start()
    await asyncio.sleep(0.1)

    try:
        async with websockets.connect("ws://localhost:18893") as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            msg = json.loads(raw)
            assert msg["type"] == "connected"
            assert msg["agent_version"] == "pydantic"
            assert "session_id" in msg
    finally:
        await handler.stop()


@pytest.mark.asyncio
async def test_ping_returns_pong():
    from src.api.websocket_handler import WebSocketHandler

    mock_processor = MagicMock()
    mock_processor.enqueue = AsyncMock()
    mock_processor.start = AsyncMock()
    mock_processor.stop = AsyncMock()

    handler = WebSocketHandler(message_processor=mock_processor, port=18894)
    await handler.start()
    await asyncio.sleep(0.1)

    try:
        async with websockets.connect("ws://localhost:18894") as ws:
            await ws.recv()  # connected
            await ws.send(json.dumps({"type": "ping"}))
            raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
            msg = json.loads(raw)
            assert msg["type"] == "pong"
    finally:
        await handler.stop()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_integration_websocket.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `websocket_handler.py`**

```python
# pydantic_agent/src/api/websocket_handler.py
"""WebSocket server — connection lifecycle and message dispatch.

Wire protocol:
  inbound:  chat_message | auth_response | ping
  outbound: connected | error | pong | turn_start | turn_complete |
            token_delta | tool_start | tool_result | tool_error |
            auth_challenge | reasoning_step
"""
from __future__ import annotations
import asyncio
import json
import logging
import uuid
from typing import Any, Callable, Awaitable, Optional

import websockets
from websockets.server import WebSocketServerProtocol

from src.models.messages import (
    ConnectedMessage, ErrorMessage, PongMessage,
)

logger = logging.getLogger(__name__)

# Maximum inbound message size (bytes)
_MAX_MSG_SIZE = 64 * 1024


class WebSocketHandler:
    def __init__(
        self,
        message_processor: Any,
        port: int = 8893,
        on_auth_response: Optional[Callable[[str, str, str], Awaitable[None]]] = None,
    ) -> None:
        self._processor = message_processor
        self._port = port
        self._on_auth_response = on_auth_response
        self._connections: dict[str, WebSocketServerProtocol] = {}
        self._server: Any = None

    async def start(self) -> None:
        self._server = await websockets.serve(
            self._handle_connection,
            "0.0.0.0",
            self._port,
            max_size=_MAX_MSG_SIZE,
        )
        logger.info("WebSocket server listening on :%d", self._port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def send_to_session(self, session_id: str, message: Any) -> None:
        """Send a message to the WebSocket for the given session_id."""
        ws = self._connections.get(session_id)
        if ws and ws.open:
            try:
                if hasattr(message, "model_dump_json"):
                    await ws.send(message.model_dump_json())
                else:
                    await ws.send(json.dumps(message))
            except websockets.ConnectionClosed:
                pass

    async def _handle_connection(self, ws: WebSocketServerProtocol) -> None:
        session_id = str(uuid.uuid4())
        self._connections[session_id] = ws
        logger.debug("Client connected: session=%s", session_id)

        try:
            # Send connected message
            await ws.send(ConnectedMessage(session_id=session_id).model_dump_json())

            async for raw in ws:
                if len(raw) > _MAX_MSG_SIZE:
                    await ws.send(
                        ErrorMessage(code="message_too_large", message="Message exceeds size limit").model_dump_json()
                    )
                    continue
                await self._dispatch(session_id, ws, raw)
        except websockets.ConnectionClosedOK:
            pass
        except websockets.ConnectionClosedError as e:
            logger.debug("Connection closed with error: session=%s err=%s", session_id, e)
        finally:
            self._connections.pop(session_id, None)
            logger.debug("Client disconnected: session=%s", session_id)

    async def _dispatch(self, session_id: str, ws: WebSocketServerProtocol, raw: str) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send(ErrorMessage(code="invalid_json", message="Could not parse message").model_dump_json())
            return

        msg_type = data.get("type")

        if msg_type == "ping":
            await ws.send(PongMessage().model_dump_json())

        elif msg_type == "chat_message":
            content = data.get("content", "").strip()
            if not content:
                await ws.send(ErrorMessage(code="empty_message", message="Message content is empty").model_dump_json())
                return
            await self._processor.enqueue(session_id, content)

        elif msg_type == "auth_response":
            code = data.get("code", "")
            state = data.get("state", "")
            if self._on_auth_response and code and state:
                await self._on_auth_response(session_id, code, state)

        else:
            await ws.send(ErrorMessage(code="unknown_type", message=f"Unknown message type: {msg_type!r}").model_dump_json())
```

- [ ] **Step 4: Run tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_integration_websocket.py -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/api/websocket_handler.py \
        pydantic_agent/tests/test_integration_websocket.py
git commit -m "feat(pydantic-agent): add WebSocket handler with new wire protocol"
```

---

## Task 12: Application entry point (`main.py`)

**Files:**
- Create: `pydantic_agent/src/main.py`

- [ ] **Step 1: Write `main.py`**

```python
# pydantic_agent/src/main.py
"""PydanticAI agent service entry point.

Starts:
  - Health check HTTP server (:8894)
  - WebSocket chat server (:8893)
  - Session idle reaper background task
"""
from __future__ import annotations
import asyncio
import logging
import os
import sys
from pathlib import Path

# Ensure src/ is importable when run as `python -m src.main`
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
except ImportError:
    pass

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from src.config.settings import ConfigManager
from src.authentication.oauth_manager import OAuthManager
from src.agent.banking_agent import create_banking_agent
from src.agent.agent_runner import AgentRunner
from src.mcp.auth_challenge import AuthChallengeManager
from src.api.message_processor import MessageProcessor
from src.api.websocket_handler import WebSocketHandler
from src.api.health import start_health_server


class PydanticAIApplication:
    def __init__(self) -> None:
        self.config = ConfigManager().load_config()
        self.oauth_manager = OAuthManager(self.config.pingone)
        self.auth_challenge_manager = AuthChallengeManager(
            timeout_seconds=self.config.chat.auth_challenge_timeout_seconds
        )

        # Pre-fetch agent token so MCPServerHTTP header lambda has a value
        self._agent_token: str = ""

        self.agent = create_banking_agent(
            config=self.config,
            get_agent_token=lambda: self._agent_token,
        )
        self.runner = AgentRunner(agent=self.agent)

        self.processor = MessageProcessor(
            handler=self._process_message,
            max_workers=self.config.chat.max_session_workers,
            idle_ttl_seconds=self.config.chat.session_worker_idle_ttl_seconds,
            reap_interval_seconds=self.config.chat.session_worker_reap_interval_seconds,
        )
        self.ws_handler = WebSocketHandler(
            message_processor=self.processor,
            port=self.config.chat.websocket_port,
            on_auth_response=self._on_auth_response,
        )

    async def _process_message(self, session_id: str, content: str) -> None:
        """Called by MessageProcessor worker for each inbound chat message."""
        import uuid
        turn_id = str(uuid.uuid4())
        from src.models.messages import TurnStartMessage, TurnCompleteMessage, ErrorMessage
        await self.ws_handler.send_to_session(
            session_id, TurnStartMessage(session_id=session_id, turn_id=turn_id)
        )
        try:
            response = await self.runner.run_turn(
                session_id=session_id,
                user_message=content,
                turn_id=turn_id,
            )
            await self.ws_handler.send_to_session(
                session_id,
                TurnCompleteMessage(
                    session_id=session_id,
                    turn_id=turn_id,
                    final_text=response.final_text,
                ),
            )
        except Exception as e:
            logger.exception("Error processing turn: session=%s turn=%s", session_id, turn_id)
            await self.ws_handler.send_to_session(
                session_id,
                ErrorMessage(code="turn_error", message=str(e)),
            )

    async def _on_auth_response(self, session_id: str, code: str, state: str) -> None:
        """Called when the UI sends back an auth_response."""
        try:
            self.auth_challenge_manager.resolve_challenge(state, code)
        except KeyError:
            logger.warning("Received auth_response for unknown state: %s", state)

    async def start(self) -> None:
        # Fetch initial agent token
        try:
            self._agent_token = await self.oauth_manager.get_agent_token()
            logger.info("Agent token obtained")
        except Exception as e:
            logger.warning("Could not obtain agent token at startup: %s", e)

        await self.processor.start()
        await self.ws_handler.start()

        status = {
            "ws_port": self.config.chat.websocket_port,
            "mcp_url": self.config.mcp.server_url,
            "provider": self.config.agent.provider,
        }
        asyncio.create_task(
            start_health_server(self.config.chat.health_port, status)
        )
        logger.info(
            "PydanticAI agent started — WS :%d  health :%d",
            self.config.chat.websocket_port,
            self.config.chat.health_port,
        )

    async def stop(self) -> None:
        await self.processor.stop()
        await self.ws_handler.stop()
        logger.info("PydanticAI agent stopped")


async def main() -> None:
    app = PydanticAIApplication()
    await app.start()
    try:
        await asyncio.Future()  # run forever
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await app.stop()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Smoke-test imports**

```bash
cd pydantic_agent
PINGONE_BASE_URL=https://auth.pingone.com/x/as \
PINGONE_CLIENT_ID=x \
PINGONE_CLIENT_SECRET=y \
  .venv/bin/python -c "from src.main import PydanticAIApplication; print('imports OK')"
```

Expected: `imports OK` (no crash).

- [ ] **Step 3: Commit**

```bash
git add pydantic_agent/src/main.py
git commit -m "feat(pydantic-agent): add application entry point and startup orchestration"
```

---

## Task 13: Wire up `run.sh`

**Files:**
- Modify: `run.sh`
- Modify: `REGRESSION_PLAN.md`

- [ ] **Step 1: Add PID/log vars to `run.sh`**

Find the block (around line 92):
```bash
PID_AGENT=/tmp/demo-langchain.pid
```

Add after `LOG_AGENT=/tmp/demo-langchain.log`:
```bash
PID_PYDANTIC=/tmp/demo-pydantic.pid
LOG_PYDANTIC=/tmp/demo-pydantic.log
```

- [ ] **Step 2: Add log file to touch/truncate lists**

Find:
```bash
touch "${LOG_API}" "${LOG_UI}" "${LOG_MCP}" "${LOG_AGENT}" "${LOG_MCP_TRAFFIC}" \
      "${LOG_GW}" "${LOG_HITL}" "${LOG_AGENT_SVC}" "${LOG_INVEST}" "${LOG_MORTGAGE}" "${LOG_AUTH}" \
```
Add `"${LOG_PYDANTIC}"` to the end of the touch list.

- [ ] **Step 3: Add to port sweep list**

Find:
```bash
for port in 3001 4000 8080 8888 8889 8890 3005 3006 3009 8081 8082; do
```
Change to:
```bash
for port in 3001 4000 8080 8888 8889 8890 3005 3006 3009 8081 8082 8893 8894; do
```
(There are two such lines — update both.)

- [ ] **Step 4: Add to stop loop**

Find:
```bash
for pid_file in "$PID_API" "$PID_MCP" "$PID_GW" "$PID_HITL" "$PID_AGENT_SVC" "$PID_INVEST" "$PID_MORTGAGE" "$PID_AGENT" "$PID_UI"; do
```
Add `"$PID_PYDANTIC"` to the list.

- [ ] **Step 5: Add service status line**

Find:
```bash
service_status_line "LangChain Agent"      8890         "/health"        "ws://localhost:8889 (chat WS)"
```
Add after:
```bash
service_status_line "PydanticAI Agent"     8894         "/health"        "ws://localhost:8893 (chat WS)"
```

- [ ] **Step 6: Add startup block** — add after the LangChain agent block (after line ~986):

```bash
# ── PydanticAI Agent (chat WS :8893 + health :8894) ──────────────────────────
# Standalone asyncio app — mirrors langchain_agent startup pattern.
# Reads pydantic_agent/.env via python-dotenv. The venv is .venv.
if [[ -f "$BASEDIR/pydantic_agent/src/main.py" ]]; then
  echo "[PYDANTIC] Starting PydanticAI Agent (chat WS :8893, health :8894)..."
  (
    cd "$BASEDIR/pydantic_agent"
    if [[ -x ".venv/bin/python" ]]; then
      PY=".venv/bin/python"
    elif [[ -x "venv/bin/python" ]]; then
      PY="venv/bin/python"
    else
      PY="python3"
    fi
    "$PY" -m src.main > "${LOG_PYDANTIC}" 2>&1
  ) &
  echo $! > "$PID_PYDANTIC"
fi
```

- [ ] **Step 7: Add to wait_for_health calls** — add after the LangChain wait:

```bash
# PydanticAI: warn-only, not a gate
wait_for_health 8894 "/health" 20 "PydanticAI Agent" "${LOG_PYDANTIC}" >/dev/null || true
```

- [ ] **Step 8: Update REGRESSION_PLAN.md §3 port table**

Add to the port table in §3:
```
| 8893 | PydanticAI Agent chat WebSocket | loopback only |
| 8894 | PydanticAI Agent health check   | loopback only |
```

- [ ] **Step 9: Verify run.sh syntax**

```bash
bash -n run.sh
```

Expected: no output (no syntax errors).

- [ ] **Step 10: Commit**

```bash
git add run.sh REGRESSION_PLAN.md
git commit -m "feat(pydantic-agent): wire up run.sh and register ports in REGRESSION_PLAN"
```

---

## Task 14: React WebSocket client service

**Files:**
- Create: `demo_api_ui/src/services/pydanticAgentWebSocket.js`

- [ ] **Step 1: Write `pydanticAgentWebSocket.js`**

```javascript
// demo_api_ui/src/services/pydanticAgentWebSocket.js
/**
 * Singleton WebSocket client for the PydanticAI agent (port 8893).
 * 
 * Usage:
 *   import pydanticWs from '../services/pydanticAgentWebSocket';
 *   pydanticWs.on('connected', (msg) => { ... });
 *   pydanticWs.connect();
 *   pydanticWs.send({ type: 'chat_message', session_id: '...', content: '...' });
 */

const WS_PORT = 8893;
const RECONNECT_DELAY_MS = 2000;

class PydanticAgentWebSocket {
  constructor() {
    this._ws = null;
    this._handlers = {};   // type -> [callback]
    this._sessionId = null;
    this._reconnectTimer = null;
    this._shouldReconnect = false;
  }

  on(type, callback) {
    if (!this._handlers[type]) this._handlers[type] = [];
    this._handlers[type].push(callback);
    return () => {
      this._handlers[type] = (this._handlers[type] || []).filter(cb => cb !== callback);
    };
  }

  _emit(type, data) {
    (this._handlers[type] || []).forEach(cb => cb(data));
    (this._handlers['*'] || []).forEach(cb => cb({ type, ...data }));
  }

  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._shouldReconnect = true;
    const host = window.location.hostname;
    const url = `ws://${host}:${WS_PORT}`;

    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      clearTimeout(this._reconnectTimer);
    };

    this._ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          this._sessionId = msg.session_id;
        }
        this._emit(msg.type, msg);
      } catch (e) {
        console.error('[PydanticWS] Failed to parse message', e);
      }
    };

    this._ws.onclose = () => {
      this._sessionId = null;
      if (this._shouldReconnect) {
        this._reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    };

    this._ws.onerror = (err) => {
      console.error('[PydanticWS] Connection error', err);
    };
  }

  disconnect() {
    this._shouldReconnect = false;
    clearTimeout(this._reconnectTimer);
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  send(message) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      console.warn('[PydanticWS] Cannot send — not connected');
      return;
    }
    this._ws.send(JSON.stringify({ ...message, session_id: this._sessionId }));
  }

  get sessionId() { return this._sessionId; }
  get connected() { return this._ws && this._ws.readyState === WebSocket.OPEN; }
}

const pydanticWs = new PydanticAgentWebSocket();
export default pydanticWs;
```

- [ ] **Step 2: Verify no build error**

```bash
cd demo_api_ui
npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully` (no errors).

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/services/pydanticAgentWebSocket.js
git commit -m "feat(pydantic-agent): add WebSocket client service singleton"
```

---

## Task 15: `PydanticAgent.jsx` and CSS

**Files:**
- Create: `demo_api_ui/src/components/PydanticAgent.jsx`
- Create: `demo_api_ui/src/components/PydanticAgent.css`

- [ ] **Step 1: Write `PydanticAgent.css`**

```css
/* demo_api_ui/src/components/PydanticAgent.css */
/* PydanticAI agent panel — light theme, blue accent (#2563eb) */

.pa-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f8f9fa;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #1e293b;
}

/* Header */
.pa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.pa-header-title {
  font-weight: 600;
  color: #1e293b;
}
.pa-header-badge {
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
  margin-left: 8px;
}
.pa-status-dot {
  font-size: 11px;
  color: #94a3b8;
}
.pa-status-dot.connected { color: #16a34a; }

/* Message thread */
.pa-thread {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* User bubble */
.pa-bubble-user {
  align-self: flex-end;
  background: #2563eb;
  color: #fff;
  padding: 8px 12px;
  border-radius: 12px 12px 2px 12px;
  max-width: 80%;
  font-size: 13px;
  line-height: 1.5;
}

/* Agent turn container */
.pa-turn {
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 95%;
  width: 100%;
}

/* Reasoning accordion */
.pa-reasoning {
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  overflow: hidden;
  font-size: 12px;
}
.pa-reasoning-header {
  padding: 6px 10px;
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
}
.pa-reasoning-body {
  padding: 10px 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pa-reasoning-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.pa-reasoning-num {
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}
.pa-reasoning-thought {
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
}

/* Tool call card */
.pa-tool-card {
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.pa-tool-card-header {
  padding: 6px 10px;
  background: #eff6ff;
  color: #1d4ed8;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
}
.pa-tool-duration {
  background: #dcfce7;
  color: #15803d;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
}
.pa-tool-body {
  padding: 8px 10px;
  background: #fff;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pa-tool-section-label {
  color: #94a3b8;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
}
.pa-tool-kv {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 5px 7px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 10px;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-all;
}

/* Final answer */
.pa-final-answer {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #1e293b;
}
.pa-final-answer-label {
  color: #15803d;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 5px;
}

/* Streaming indicator */
.pa-streaming {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
}
.pa-streaming span {
  width: 6px;
  height: 6px;
  background: #93c5fd;
  border-radius: 50%;
  animation: pa-bounce 1.2s infinite ease-in-out;
}
.pa-streaming span:nth-child(2) { animation-delay: 0.2s; }
.pa-streaming span:nth-child(3) { animation-delay: 0.4s; }
@keyframes pa-bounce {
  0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
  40% { transform: scale(1.2); opacity: 1; }
}

/* Input row */
.pa-input-row {
  display: flex;
  gap: 6px;
  padding: 8px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.pa-input {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
  color: #1e293b;
}
.pa-input:focus { border-color: #2563eb; }
.pa-send-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 7px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pa-send-btn:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 2: Write `PydanticAgent.jsx`**

```jsx
// demo_api_ui/src/components/PydanticAgent.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import pydanticWs from '../services/pydanticAgentWebSocket';
import './PydanticAgent.css';

/** Render typed key/value pairs from a tool args or result object. */
function KVTable({ data }) {
  if (!data || typeof data !== 'object') return <span className="pa-tool-kv">{String(data)}</span>;
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="pa-tool-kv">(empty)</span>;
  return (
    <div className="pa-tool-kv">
      {entries.map(([k, v]) => (
        <div key={k}>
          <span style={{ color: '#94a3b8' }}>{k}: </span>
          <span style={{ color: typeof v === 'number' ? '#16a34a' : '#d97706' }}>
            {typeof v === 'string' ? `"${v}"` : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ToolCallCard({ call }) {
  return (
    <div className="pa-tool-card">
      <div className="pa-tool-card-header">
        <span>⚙ {call.toolName}</span>
        {call.durationMs != null && (
          <span className="pa-tool-duration">{call.durationMs}ms ✅</span>
        )}
      </div>
      <div className="pa-tool-body">
        <div>
          <div className="pa-tool-section-label">Args</div>
          <KVTable data={call.args} />
        </div>
        <div>
          <div className="pa-tool-section-label">Result</div>
          {call.result ? <KVTable data={call.result} /> : <span className="pa-tool-kv">pending…</span>}
        </div>
      </div>
    </div>
  );
}

function ReasoningAccordion({ steps }) {
  const [open, setOpen] = useState(false);
  if (!steps || steps.length === 0) return null;
  return (
    <div className="pa-reasoning">
      <div className="pa-reasoning-header" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▼' : '▶'} Agent reasoning ({steps.length} step{steps.length !== 1 ? 's' : ''})</span>
        {!open && <span style={{ color: '#93c5fd', fontSize: '10px' }}>click to expand</span>}
      </div>
      {open && (
        <div className="pa-reasoning-body">
          {steps.map(s => (
            <div key={s.stepIndex} className="pa-reasoning-step">
              <span className="pa-reasoning-num">{s.stepIndex}</span>
              <span className="pa-reasoning-thought">{s.thought}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentTurn({ turn }) {
  return (
    <div className="pa-turn">
      <ReasoningAccordion steps={turn.reasoningSteps} />
      {turn.toolCalls.map((tc, i) => <ToolCallCard key={i} call={tc} />)}
      {(turn.finalText || turn.partialText) && (
        <div className="pa-final-answer">
          {turn.finalText && <div className="pa-final-answer-label">✅ Final Answer</div>}
          {turn.finalText || turn.partialText}
        </div>
      )}
    </div>
  );
}

export default function PydanticAgent() {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);  // { role: 'user'|'agent', content?, turn? }
  const [activeTurn, setActiveTurn] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const threadRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, activeTurn]);

  useEffect(() => {
    pydanticWs.connect();

    const offConnected = pydanticWs.on('connected', () => setConnected(true));
    const offError = pydanticWs.on('error', (msg) => {
      console.error('[PydanticAgent] error', msg);
      setStreaming(false);
    });

    const offTurnStart = pydanticWs.on('turn_start', (msg) => {
      setStreaming(true);
      setActiveTurn({ turnId: msg.turn_id, reasoningSteps: [], toolCalls: [], partialText: '', finalText: '' });
    });

    const offTokenDelta = pydanticWs.on('token_delta', (msg) => {
      setActiveTurn(t => t && t.turnId === msg.turn_id
        ? { ...t, partialText: t.partialText + msg.delta }
        : t
      );
    });

    const offReasoningStep = pydanticWs.on('reasoning_step', (msg) => {
      setActiveTurn(t => t && t.turnId === msg.turn_id
        ? { ...t, reasoningSteps: [...t.reasoningSteps, { stepIndex: msg.step_index, thought: msg.thought }] }
        : t
      );
    });

    const offToolStart = pydanticWs.on('tool_start', (msg) => {
      setActiveTurn(t => t && t.turnId === msg.turn_id
        ? { ...t, toolCalls: [...t.toolCalls, { toolName: msg.tool_name, args: msg.args, result: null, durationMs: null }] }
        : t
      );
    });

    const offToolResult = pydanticWs.on('tool_result', (msg) => {
      setActiveTurn(t => {
        if (!t || t.turnId !== msg.turn_id) return t;
        const calls = t.toolCalls.map(tc =>
          tc.toolName === msg.tool_name && tc.result === null
            ? { ...tc, result: msg.result, durationMs: msg.duration_ms }
            : tc
        );
        return { ...t, toolCalls: calls };
      });
    });

    const offTurnComplete = pydanticWs.on('turn_complete', (msg) => {
      setActiveTurn(t => {
        const completed = t ? { ...t, finalText: msg.final_text, partialText: '' } : null;
        if (completed) {
          setMessages(prev => [...prev, { role: 'agent', turn: completed }]);
        }
        return null;
      });
      setStreaming(false);
    });

    return () => {
      offConnected(); offError(); offTurnStart(); offTokenDelta();
      offReasoningStep(); offToolStart(); offToolResult(); offTurnComplete();
      pydanticWs.disconnect();
    };
  }, []);

  const sendMessage = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !connected || streaming) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInputValue('');
    pydanticWs.send({ type: 'chat_message', content: text });
  }, [inputValue, connected, streaming]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="pa-panel">
      <div className="pa-header">
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="pa-header-title">PydanticAI Agent</span>
          <span className="pa-header-badge">NEW</span>
        </div>
        <span className={`pa-status-dot${connected ? ' connected' : ''}`}>
          {connected ? '● Connected' : '● Disconnected'}
        </span>
      </div>

      <div className="pa-thread" ref={threadRef}>
        {messages.map((msg, i) => (
          <React.Fragment key={i}>
            {msg.role === 'user' && (
              <div className="pa-bubble-user">{msg.content}</div>
            )}
            {msg.role === 'agent' && <AgentTurn turn={msg.turn} />}
          </React.Fragment>
        ))}
        {activeTurn && <AgentTurn turn={activeTurn} />}
        {streaming && !activeTurn && (
          <div className="pa-streaming"><span/><span/><span/></div>
        )}
      </div>

      <div className="pa-input-row">
        <input
          className="pa-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your finances..."
          disabled={!connected}
        />
        <button
          className="pa-send-btn"
          onClick={sendMessage}
          disabled={!connected || streaming || !inputValue.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify no errors**

```bash
cd demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/PydanticAgent.jsx \
        demo_api_ui/src/components/PydanticAgent.css
git commit -m "feat(pydantic-agent): add PydanticAgent React component with structured turn rendering"
```

---

## Task 16: Wire up AgentModeSelector

**Files:**
- Modify: `demo_api_ui/src/components/AgentModeSelector.jsx`

- [ ] **Step 1: Read current `AgentModeSelector.jsx` to identify insertion point**

The file currently imports `useLangchainProvider` and renders core mode options from `CORE_MODE_IDS`. We add a simple tab to mount `PydanticAgent` when selected — independent of the existing mode system (PydanticAI is a separate service, not a LangChain mode).

- [ ] **Step 2: Add PydanticAI tab**

At the top of `AgentModeSelector.jsx`, add the import:
```jsx
import PydanticAgent from './PydanticAgent';
```

Add state near the top of the component function (after existing hooks):
```jsx
const [showPydantic, setShowPydantic] = React.useState(false);
```

After the closing `</div>` of the existing selector markup, add:
```jsx
{/* PydanticAI tab — independent of LangChain mode selector */}
<button
  className={`ams-pydantic-tab${showPydantic ? ' ams-pydantic-tab--active' : ''}`}
  onClick={() => setShowPydantic(s => !s)}
  title="Switch to PydanticAI agent"
>
  PydanticAI
</button>

{showPydantic && (
  <div className="ams-pydantic-panel">
    <PydanticAgent />
  </div>
)}
```

- [ ] **Step 3: Add minimal CSS to `AgentModeSelector.css`**

Append to the end of `AgentModeSelector.css`:
```css
/* PydanticAI tab */
.ams-pydantic-tab {
  margin-top: 6px;
  padding: 6px 14px;
  background: #f8f9fa;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
}
.ams-pydantic-tab--active {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}
.ams-pydantic-panel {
  margin-top: 8px;
  height: 500px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
}
```

- [ ] **Step 4: Build**

```bash
cd demo_api_ui
npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AgentModeSelector.jsx \
        demo_api_ui/src/components/AgentModeSelector.css
git commit -m "feat(pydantic-agent): add PydanticAI tab to AgentModeSelector"
```

---

## Task 17: Run full test suite and verify

- [ ] **Step 1: Run all pydantic_agent tests**

```bash
cd pydantic_agent
.venv/bin/pytest tests/ -v
```

Expected: all tests pass. No failures.

- [ ] **Step 2: Run existing API server tests** (verify nothing broken)

```bash
cd /path/to/repo/demo_api_server
npx jest --passWithNoTests 2>&1 | tail -10
```

Expected: all existing tests pass.

- [ ] **Step 3: Run UI build one final time**

```bash
cd demo_api_ui
npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully`.

- [ ] **Step 4: Verify run.sh syntax**

```bash
bash -n run.sh
```

Expected: no output.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(pydantic-agent): final wiring — all tests pass, UI builds clean"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task(s) |
|---|---|
| §1 Goal — side-by-side service | Task 1 (scaffold), Task 13 (run.sh) |
| §2 Architecture — pydantic_agent/ directory | Task 1 |
| §2 Ports 8893/8894 | Task 12 (main.py), Task 13 (run.sh) |
| §3 Agent definition + MCPServerHTTP | Task 5 (banking_agent.py) |
| §3 Structured output types | Task 5 |
| §3 Session memory (message_history) | Task 8 (agent_runner.py) |
| §3 LLM providers: Anthropic, Ollama, LM Studio, Helix | Task 4 (llm_factory.py) |
| §3 Auth challenge state machine | Task 6 (auth_challenge.py) |
| §4 Wire protocol — all message types | Task 2 (messages.py) |
| §5 React component + structured turn state | Task 15 (PydanticAgent.jsx) |
| §5 WebSocket client service | Task 14 (pydanticAgentWebSocket.js) |
| §5 AgentModeSelector third tab | Task 16 |
| §6 Error handling | Task 12 (_process_message error catch), Task 11 (websocket_handler errors) |
| §7 Testing strategy — all test files | Tasks 2, 3, 4, 5, 6, 7, 8, 9, 11 |
| §8 run.sh integration | Task 13 |
| §9 Phase 277 dependency (confirmed shipped) | No action needed |

All spec sections covered. No gaps found.
