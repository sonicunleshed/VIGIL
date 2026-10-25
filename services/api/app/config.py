"""Runtime configuration. All values are local-demo defaults; no secrets live here."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent.parent


def _default_db_url() -> str:
    var_dir = API_ROOT / "var"
    var_dir.mkdir(exist_ok=True)
    return f"sqlite:///{var_dir / 'vigil.db'}"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get("VIGIL_DB_URL") or _default_db_url()
    )
    default_scenario: str = os.environ.get("VIGIL_DEFAULT_SCENARIO", "waiting-room-30")
    default_seed: int = int(os.environ.get("VIGIL_DEFAULT_SEED", "42"))
    # Load the default scenario on startup when the database holds no scenario yet.
    autoload_scenario: bool = os.environ.get("VIGIL_AUTOLOAD", "1") == "1"
    # Simulated clinician identities. Production authentication is out of scope.
    demo_actors: frozenset[str] = frozenset({"nurse-demo-1", "nurse-demo-2", "charge-demo-1"})
    cors_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")
    # Explanation provider name (see app/explain). "template" is rule-based and always available.
    explainer: str = os.environ.get("VIGIL_EXPLAINER", "template")
    # Local model for explanation drafts (VIGIL_EXPLAINER=local-llm). Must be a loopback URL.
    llm_url: str = os.environ.get("VIGIL_LLM_URL", "http://127.0.0.1:11434")
    llm_model: str = os.environ.get("VIGIL_LLM_MODEL", "qwen3:4b-instruct")
    llm_timeout_seconds: float = float(os.environ.get("VIGIL_LLM_TIMEOUT", "30"))
    # Wall-clock seconds between simulation ticks while running.
    tick_seconds: float = 0.5
    # Accept observations timestamped at most this far ahead of the simulation clock.
    future_tolerance_seconds: int = 300
    # A patient check-in code stops working this long after it was issued (simulation clock).
    checkin_ttl_minutes: int = 240


def get_settings() -> Settings:
    return Settings()
