"""FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.runtime import Runtime


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime = request.app.state.runtime
    return runtime


def get_db(runtime: Annotated[Runtime, Depends(get_runtime)]) -> Iterator[Session]:
    with runtime.session_factory() as db:
        yield db


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
DbDep = Annotated[Session, Depends(get_db)]
