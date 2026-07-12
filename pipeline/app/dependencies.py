from functools import lru_cache

from app.access.postgres_repository import PostgresAccessRepository
from app.access.service import AccessService
from app.asr.factory import build_asr_provider
from app.assessments.factory import build_assessment_agent
from app.assessments.postgres_repository import PostgresAssessmentRepository
from app.assessments.service import AssessmentService
from app.audit.postgres_repository import PostgresAuditRepository
from app.audit.service import AuditService
from app.clips.factory import build_clip_extraction_agent
from app.clips.postgres_repository import PostgresClipRepository
from app.clips.service import ClipService
from app.config import Settings, get_settings
from app.dashboard.postgres_repository import PostgresDashboardRepository
from app.dashboard.service import DashboardService
from app.graph.factory import build_concept_graph_agent
from app.graph.review_postgres_repository import PostgresConceptGraphRepository
from app.graph.review_service import ConceptGraphService
from app.ingestion.postgres_repository import PostgresIngestionRepository
from app.ingestion.service import IngestionService
from app.ingestion.storage import LocalUploadStorage
from app.ingestion.url_fetcher import DirectUrlFetcher
from app.routing.postgres_repository import PostgresRoutingRepository
from app.routing.service import RoutingService
from app.segmentation.factory import build_segmentation_agent
from app.segmentation.postgres_repository import PostgresTopicRepository
from app.segmentation.service import SegmentationService
from app.video.factory import build_video_delivery_provider


@lru_cache
def get_access_service() -> AccessService:
    settings = get_settings()
    return build_access_service(settings)


def build_access_service(settings: Settings) -> AccessService:
    return AccessService(repository=PostgresAccessRepository(settings.database_url))


@lru_cache
def get_ingestion_service() -> IngestionService:
    settings = get_settings()
    return build_ingestion_service(settings)


def build_ingestion_service(settings: Settings) -> IngestionService:
    return IngestionService(
        repository=PostgresIngestionRepository(settings.database_url),
        asr_provider=build_asr_provider(settings),
        upload_storage=LocalUploadStorage(settings.local_video_storage_path),
        url_fetcher=DirectUrlFetcher(
            settings.local_video_storage_path,
            settings.direct_url_download_timeout_seconds,
        ),
        video_delivery_provider=build_video_delivery_provider(settings),
        demo_video_path=settings.demo_video_path,
        demo_transcript_path=settings.demo_transcript_path,
    )


@lru_cache
def get_segmentation_service() -> SegmentationService:
    settings = get_settings()
    return build_segmentation_service(settings)


def build_segmentation_service(settings: Settings) -> SegmentationService:
    return SegmentationService(
        repository=PostgresTopicRepository(settings.database_url),
        agent=build_segmentation_agent(settings),
        audit_service=build_audit_service(settings),
    )


@lru_cache
def get_concept_graph_service() -> ConceptGraphService:
    settings = get_settings()
    return build_concept_graph_service(settings)


def build_concept_graph_service(settings: Settings) -> ConceptGraphService:
    return ConceptGraphService(
        repository=PostgresConceptGraphRepository(settings.database_url),
        agent=build_concept_graph_agent(settings),
        audit_service=build_audit_service(settings),
    )


@lru_cache
def get_clip_service() -> ClipService:
    settings = get_settings()
    return build_clip_service(settings)


def build_clip_service(settings: Settings) -> ClipService:
    return ClipService(
        repository=PostgresClipRepository(settings.database_url),
        agent=build_clip_extraction_agent(settings),
        audit_service=build_audit_service(settings),
    )


@lru_cache
def get_assessment_service() -> AssessmentService:
    settings = get_settings()
    return build_assessment_service(settings)


def build_assessment_service(settings: Settings) -> AssessmentService:
    return AssessmentService(
        repository=PostgresAssessmentRepository(settings.database_url),
        agent=build_assessment_agent(settings),
        audit_service=build_audit_service(settings),
    )


@lru_cache
def get_routing_service() -> RoutingService:
    settings = get_settings()
    return build_routing_service(settings)


def build_routing_service(settings: Settings) -> RoutingService:
    return RoutingService(repository=PostgresRoutingRepository(settings.database_url))


@lru_cache
def get_dashboard_service() -> DashboardService:
    settings = get_settings()
    return build_dashboard_service(settings)


def build_dashboard_service(settings: Settings) -> DashboardService:
    return DashboardService(
        repository=PostgresDashboardRepository(settings.database_url),
        audit_service=build_audit_service(settings),
    )


@lru_cache
def get_audit_service() -> AuditService:
    settings = get_settings()
    return build_audit_service(settings)


def build_audit_service(settings: Settings) -> AuditService:
    return AuditService(repository=PostgresAuditRepository(settings.database_url))
