from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.assessments import router as assessments_router
from app.api.audit import router as audit_router
from app.api.clips import router as clips_router
from app.api.dashboard import router as dashboard_router
from app.api.graph import router as graph_router
from app.api.health import router as health_router
from app.api.ingestion import router as ingestion_router
from app.api.routing import router as routing_router
from app.api.topics import router as topics_router

app = FastAPI(title="CourseFoundry Pipeline")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health_router)
app.include_router(ingestion_router)
app.include_router(topics_router)
app.include_router(graph_router)
app.include_router(clips_router)
app.include_router(assessments_router)
app.include_router(routing_router)
app.include_router(dashboard_router)
app.include_router(audit_router)
