import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.access import router as access_router
from app.api.assessments import router as assessments_router
from app.api.audit import router as audit_router
from app.api.clips import router as clips_router
from app.api.course_os import router as course_os_router
from app.api.dashboard import router as dashboard_router
from app.api.graph import router as graph_router
from app.api.health import router as health_router
from app.api.ingestion import router as ingestion_router
from app.api.routing import router as routing_router
from app.api.topics import router as topics_router
from app.config import get_settings
from app.db.pool import close_connection_pools
from app.dependencies import get_course_generation_worker


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    stop_event = asyncio.Event()
    worker_task: asyncio.Task[None] | None = None
    if settings.generation_worker_enabled:
        worker_task = asyncio.create_task(
            get_course_generation_worker().run(stop_event),
            name="course-generation-worker",
        )
    try:
        yield
    finally:
        stop_event.set()
        if worker_task is not None:
            with suppress(asyncio.CancelledError):
                await worker_task
        await close_connection_pools()


settings = get_settings()
cors_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]

app = FastAPI(title="Manifold Pipeline", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(access_router)
app.include_router(course_os_router)
app.include_router(ingestion_router)
app.include_router(topics_router)
app.include_router(graph_router)
app.include_router(clips_router)
app.include_router(assessments_router)
app.include_router(routing_router)
app.include_router(dashboard_router)
app.include_router(audit_router)
