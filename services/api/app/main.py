"""FastAPI application factory. Run a single worker: the SSE broker is in-process."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __doc__ as app_doc
from app.api import alerts, ingest, patients, simulation, stream
from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory, run_migrations, write_lock
from app.errors import DomainError
from app.runtime import Runtime
from app.schemas.outputs import HealthOut
from app.services import simulation as sim_service

VERSION = "0.1.0"
log = logging.getLogger("vigil")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        run_migrations(settings.database_url)
        engine = make_engine(settings.database_url)
        runtime = Runtime(settings, make_session_factory(engine))
        runtime.broker.bind_loop(asyncio.get_running_loop())
        app.state.runtime = runtime
        with write_lock, runtime.session_factory() as db:
            # A fresh process has no runner task, so a persisted "running" state would be a lie.
            if sim_service.pause_stale_run(db):
                db.commit()
                log.info("simulation was running before restart; now paused")
        if settings.autoload_scenario:
            with write_lock, runtime.session_factory() as db:
                if sim_service.get_state(db) is None:
                    sim_service.load_scenario(db, settings.default_scenario, settings.default_seed)
                    db.commit()
                    log.info(
                        "loaded scenario %s seed %s",
                        settings.default_scenario,
                        settings.default_seed,
                    )
        yield
        await runtime.stop()
        engine.dispose()

    app = FastAPI(
        title="VIGIL API",
        version=VERSION,
        description=(app_doc or "")
        + "\n\nSynthetic data only. Alerts are advisory; clinicians make every decision.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Raw inputs are omitted: they may be non-JSON (NaN) and are patient-like payloads.
        errors = [
            {
                "loc": list(e.get("loc", ())),
                "msg": str(e.get("msg", "")),
                "type": str(e.get("type", "")),
            }
            for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.exception_handler(DomainError)
    async def _domain_error(_request: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.get("/health", response_model=HealthOut, tags=["health"])
    def health() -> HealthOut:
        return HealthOut(status="ok", version=VERSION)

    for module in (patients, ingest, alerts, simulation, stream):
        app.include_router(module.router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app()
