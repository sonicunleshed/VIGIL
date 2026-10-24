from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta


def should_emit(
    created_at: datetime, prior: Iterable[tuple[datetime, str]], cooldown_minutes: int
) -> bool:
    """Suppress a repeat while an alert in the same family is unresolved, or within the cooldown
    after the last one. `prior` is (created_at, status) for earlier alerts in the family."""
    cooldown = timedelta(minutes=cooldown_minutes)
    for at, status in prior:
        if status != "resolved":
            return False
        if created_at - at < cooldown:
            return False
    return True
