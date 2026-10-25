"""Explanation drafts from a local language model served by Ollama on this machine.

The model writes only the "what changed" narrative. Evidence, missing-data notes and the workflow
line stay rule-based. Every model sentence must cite facts it was shown, may only use numbers that
appear in those facts, and may not use diagnostic, treatment or reassurance language. Anything
else raises, and the service falls back to the template provider.

Only facts are sent: no patient identifiers beyond the display code are needed, and the request
never leaves the machine (non-loopback URLs are refused).
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

from app.explain.context import ExplanationContext, Fact, Section
from app.explain.providers import ProviderError, TemplateProvider

NAME = "local-llm"
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
MAX_SENTENCES = 3
RECENT_FACTS = 8
CACHE_SIZE = 256
# Prompts are under ~1.5k tokens; a small context keeps the model's memory footprint small.
NUM_CTX = 4096

SYSTEM_PROMPT = """You restate recorded waiting-room observations for an emergency nurse.
Write 1 to 3 short, plain-English sentences (each under 35 words) describing what changed in
the recorded data. Focus on the largest changes; do not list every reading.
Rules:
- Use only the facts provided. Every sentence must cite the labels of the facts it restates.
- Copy numbers, units and times exactly as written in the facts. Do not calculate differences,
  averages or rates.
- Describe readings and reports, not the person's condition. Do not diagnose, suggest causes,
  treatment, urgency or next steps, and do not call anyone stable, safe, improving, worsening
  or critical. Do not mention ESI or priority.
Reply only with JSON matching the schema, for example:
{"sentences": [{"text": "Heart rate went from 80 bpm at 12:17 to 96 bpm at 15:25.",
"citations": ["F1", "F4"]}]}"""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "citations": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "citations"],
            },
        }
    },
    "required": ["sentences"],
}

# Words that would turn a restatement into clinical judgement or advice.
BANNED = re.compile(
    r"\b(diagnos\w*|stable|stabl\w*|safe\w*|critical\w*|improv\w*|worsen\w*|deteriorat\w*|"
    r"seps\w*|infect\w*|treat\w*|medicat\w*|administer\w*|dose\w*|esi|priorit\w*|"
    r"recommend\w*|should|consider\w*|must)\b",
    re.IGNORECASE,
)
# Fact labels (F1, F2, ...) belong in citations, not in the text a nurse reads.
LABEL_IN_TEXT = re.compile(r"\bF\d+\b")
# Standalone numbers; digits inside words such as "SpO2" are not numbers.
NUMBER = re.compile(r"(?<![\w.])\d+(?:\.\d+)?(?![\w])")

Transport = Callable[[str, dict[str, Any], float], dict[str, Any]]
Sentences = list[tuple[str, tuple[str, ...]]]

# A rejected draft gets one more try, told exactly why it was rejected.
RETRIES = 1
RETRY_HINT = (
    "That reply was rejected. Rewrite it: cite every fact whose numbers you use, copy numbers "
    "exactly, and follow all the rules."
)


def _post_json(url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        out: dict[str, Any] = json.loads(resp.read())
        return out


def numbers(text: str) -> set[str]:
    return {n.rstrip("0").rstrip(".") if "." in n else n for n in NUMBER.findall(text)}


def check_sentence(text: str, cited: list[Fact], also_allowed: str = "") -> None:
    """Raises ProviderError when a sentence is not a faithful restatement of its cited facts."""
    if not cited:
        raise ProviderError("local model draft rejected: a sentence cites no recorded data")
    if m := BANNED.search(text):
        raise ProviderError(f"local model draft rejected: used '{m.group(0)}'")
    if LABEL_IN_TEXT.search(text):
        raise ProviderError("local model draft rejected: mentioned fact labels in the text")
    allowed = numbers(also_allowed)
    for f in cited:
        allowed |= numbers(f.text)
    extra = numbers(text) - allowed
    if extra:
        raise ProviderError(
            f"local model draft rejected: number(s) not in cited data: {', '.join(sorted(extra))}"
        )


def prompt_facts(ctx: ExplanationContext) -> list[Fact]:
    """The facts the model sees: the alert's evidence or each vital's first and latest reading,
    plus the most recent events. For an alert, nothing after the alert was raised. Bounded so
    prompts stay small."""
    cutoff = ctx.facts[ctx.subject_id].at if ctx.subject == "alert" else ctx.as_of
    visible = {i: f for i, f in ctx.facts.items() if f.at <= cutoff}
    chosen: dict[str, Fact] = {}
    if ctx.subject == "alert":
        for i in [ctx.subject_id, *ctx.alert_event_ids]:
            if i in visible:
                chosen[i] = visible[i]
    for first, last in ctx.vital_changes:
        for f in (first, last):
            if f.id in visible:
                chosen[f.id] = f
    for f in sorted(visible.values(), key=lambda f: (f.at, f.id))[-RECENT_FACTS:]:
        chosen.setdefault(f.id, f)
    return sorted(chosen.values(), key=lambda f: (f.at, f.id))


def labels(facts: list[Fact]) -> dict[str, Fact]:
    """Short labels (F1, F2, ...) for the prompt. Long ids invite the model to copy them."""
    return {f"F{i}": f for i, f in enumerate(facts, start=1)}


def user_prompt(ctx: ExplanationContext, labelled: dict[str, Fact]) -> str:
    lines = [f"Patient {ctx.patient_code}. Facts (label: text):"]
    lines += [f"{label}: {f.text}" for label, f in labelled.items()]
    if ctx.subject == "alert":
        alert = next(label for label, f in labelled.items() if f.id == ctx.subject_id)
        lines.append(f"VIGIL raised a reassessment request ({alert}).")
        lines += [f"Detector rule: {r}" for r in ctx.alert_rules]
        lines.append("Describe what changed in the readings that led to this request.")
    else:
        lines.append("Describe what changed in this patient's recorded data since arrival.")
    lines.append("Cite facts by label in `citations`; never write labels in the sentence text.")
    return "\n".join(lines)


# Stale-data and data-quality requests are about the data, not the patient. The rule-based text
# says that precisely; a model tends to narrate the readings as if they were a change.
TEMPLATE_ONLY_ALERTS = {"DATA_STALE", "DATA_QUALITY"}


class LocalModelProvider:
    """Ollama chat API on a loopback address. Thread-safe; one generation at a time."""

    name = NAME

    @staticmethod
    def applies_to(ctx: ExplanationContext) -> bool:
        return ctx.alert_type not in TEMPLATE_ONLY_ALERTS

    def __init__(
        self,
        url: str,
        model: str,
        timeout_seconds: float = 30.0,
        transport: Transport = _post_json,
    ) -> None:
        self.url = url.rstrip("/")
        self.model = model
        self.version = model
        self.timeout = timeout_seconds
        self._post = transport
        self._lock = threading.Lock()  # one generation at a time
        self._cache_lock = threading.Lock()
        self._cache: OrderedDict[str, list[Section] | str] = OrderedDict()
        host = urlparse(self.url).hostname
        self._config_error = (
            None if host in LOOPBACK else "local model URL must point to this machine"
        )
        self._template = TemplateProvider()

    def _request(self, messages: list[dict[str, str]]) -> dict[str, Any]:
        return {
            "model": self.model,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "format": SCHEMA,
            "options": {"temperature": 0, "seed": 0, "num_predict": 800, "num_ctx": NUM_CTX},
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        }

    def _generate(self, messages: list[dict[str, str]]) -> tuple[str, Sentences]:
        """Returns the raw reply (for a retry turn) and the parsed sentences."""
        try:
            raw = self._post(f"{self.url}/api/chat", self._request(messages), self.timeout)
        except TimeoutError as exc:
            raise ProviderError("local model timed out") from exc
        except (urllib.error.URLError, ConnectionError, OSError) as exc:
            raise ProviderError("local model not reachable") from exc
        try:
            reply = str(raw["message"]["content"])
            items = json.loads(reply)["sentences"]
            out = [(str(s["text"]).strip(), tuple(str(c) for c in s["citations"])) for s in items]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("local model returned malformed output") from exc
        if not out:
            raise ProviderError("local model returned no sentences")
        return reply, out[:MAX_SENTENCES]

    @staticmethod
    def _validate(sentences: Sentences, shown: dict[str, Fact], allowed: str) -> list[Section]:
        changed: list[Section] = []
        for text, cited in sentences:
            if any(c not in shown for c in cited):
                raise ProviderError("local model draft rejected: cites data it was not shown")
            check_sentence(text, [shown[c] for c in cited], also_allowed=allowed)
            changed.append(Section("what_changed", text, tuple(shown[c].id for c in cited)))
        return changed

    def draft(self, ctx: ExplanationContext) -> list[Section]:
        """Checked model sentences for this context. One retry with the rejection reason; the
        outcome (sections or the final rejection) is cached on the prompt, which has no clock."""
        if self._config_error:
            raise ProviderError(self._config_error)
        shown = labels(prompt_facts(ctx))
        allowed = " ".join([ctx.patient_code, *ctx.alert_rules])
        prompt = user_prompt(ctx, shown)
        ids = ",".join(f.id for f in shown.values())
        key = hashlib.sha256(f"{self.model}\n{prompt}\n{ids}".encode()).hexdigest()
        if (hit := self._cached(key)) is not None:
            return self._unwrap(hit)
        if not self._lock.acquire(timeout=self.timeout):
            raise ProviderError("local model busy")
        try:
            if (hit := self._cached(key)) is not None:  # generated while we waited
                return self._unwrap(hit)
            messages = [{"role": "user", "content": prompt}]
            outcome: list[Section] | str
            for attempt in range(1 + RETRIES):
                reply, sentences = self._generate(messages)
                try:
                    outcome = self._validate(sentences, shown, allowed)
                    break
                except ProviderError as exc:
                    outcome = str(exc)
                    messages += [
                        {"role": "assistant", "content": reply},
                        {"role": "user", "content": f"{RETRY_HINT} Problem: {exc}."},
                    ]
                    if attempt == RETRIES:
                        break
            with self._cache_lock:
                self._cache[key] = outcome
                while len(self._cache) > CACHE_SIZE:
                    self._cache.popitem(last=False)
            return self._unwrap(outcome)
        finally:
            self._lock.release()

    @staticmethod
    def _unwrap(outcome: list[Section] | str) -> list[Section]:
        if isinstance(outcome, str):
            raise ProviderError(outcome)
        return outcome

    def _cached(self, key: str) -> list[Section] | str | None:
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        return None

    def explain(self, ctx: ExplanationContext) -> list[Section]:
        rest = [s for s in self._template.explain(ctx) if s.kind != "what_changed"]
        return self.draft(ctx) + rest

    def warm_up(self) -> None:
        """Load the model into memory so the first explanation is not slow. Errors are ignored."""
        if self._config_error:
            return
        with contextlib.suppress(Exception):
            self._post(
                f"{self.url}/api/chat",
                {
                    "model": self.model,
                    "messages": [],
                    "keep_alive": "30m",
                    "stream": False,
                    "options": {"num_ctx": NUM_CTX},
                },
                self.timeout,
            )
