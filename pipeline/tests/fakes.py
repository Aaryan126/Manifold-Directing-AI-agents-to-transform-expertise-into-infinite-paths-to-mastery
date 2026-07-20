from pathlib import Path
from uuid import UUID, uuid4

from fastapi import UploadFile

from app.asr.base import ASRProvider, Transcript, TranscriptWord
from app.graph.agent import ConceptGraphAgent
from app.graph.models import (
    Concept,
    ConceptCreate,
    ConceptEdit,
    ConceptGraph,
    ConceptGraphEdge,
    ConceptGraphProposal,
    CourseGraphContext,
    EdgeEdit,
    GraphReviewStatus,
    TopicContext,
)
from app.graph.proposal_policy import concept_names_match
from app.graph.review_repository import ConceptGraphRepository
from app.graph.validator import GraphValidationError, validate_no_cycle
from app.ingestion.models import (
    IngestionJob,
    IngestionJobStatus,
    SourceKind,
    StoredUpload,
    VideoMedia,
    transcript_to_json,
)
from app.ingestion.repository import IngestionRepository
from app.segmentation.agent import SegmentationAgent
from app.segmentation.models import (
    Topic,
    TopicEdit,
    TopicProposal,
    TopicReviewStatus,
    VideoTranscript,
)
from app.segmentation.models import (
    TranscriptWord as SegmentationTranscriptWord,
)
from app.segmentation.repository import TopicRepository
from app.video.base import PlaybackReference


class StaticASRProvider(ASRProvider):
    async def transcribe(self, media_path: Path) -> Transcript:
        return Transcript(
            text="Hello adaptive learning.",
            words=(
                TranscriptWord(text="Hello", start_seconds=0.0, end_seconds=0.4),
                TranscriptWord(text="adaptive", start_seconds=0.5, end_seconds=1.0),
                TranscriptWord(text="learning.", start_seconds=1.1, end_seconds=1.7),
            ),
        )


class MemoryIngestionRepository(IngestionRepository):
    def __init__(self) -> None:
        self.jobs: dict[UUID, IngestionJob] = {}
        self.transcripts: dict[UUID, dict[str, object]] = {}
        self.media: dict[UUID, VideoMedia] = {}

    async def create_video_and_job(
        self,
        source_kind: SourceKind,
        source_uri: str,
        course_id: UUID | None,
        content_type: str | None,
    ) -> IngestionJob:
        video_id = uuid4()
        job = IngestionJob(
            id=uuid4(),
            video_id=video_id,
            course_id=course_id,
            source_kind=source_kind,
            source_uri=source_uri,
            status=IngestionJobStatus.QUEUED,
            progress=0,
            error_message=None,
        )
        self.jobs[job.id] = job
        self.media[video_id] = VideoMedia(
            source_kind=source_kind,
            source_uri=source_uri,
            content_type=content_type,
        )
        return job

    async def get_or_create_demo_job(
        self,
        source_uri: str,
        transcript: dict[str, object],
        duration_seconds: float,
    ) -> IngestionJob:
        del duration_seconds
        existing = next(
            (job for job in self.jobs.values() if job.source_uri == source_uri),
            None,
        )
        if existing is not None:
            return existing
        video_id = uuid4()
        job = IngestionJob(
            id=uuid4(),
            video_id=video_id,
            course_id=uuid4(),
            source_kind=SourceKind.UPLOAD,
            source_uri=source_uri,
            status=IngestionJobStatus.COMPLETE,
            progress=100,
            error_message=None,
        )
        self.jobs[job.id] = job
        self.transcripts[video_id] = transcript
        self.media[video_id] = VideoMedia(
            source_kind=SourceKind.UPLOAD,
            source_uri=source_uri,
            content_type="video/mp4",
            playback_provider="local",
        )
        return job

    async def mark_processing(self, job_id: UUID) -> None:
        job = self.jobs[job_id]
        self.jobs[job_id] = _replace_job(
            job,
            status=IngestionJobStatus.PROCESSING,
            progress=10,
            error_message=None,
        )

    async def mark_complete(
        self,
        job_id: UUID,
        transcript: Transcript,
        playback: PlaybackReference | None = None,
        local_source_uri: str | None = None,
    ) -> None:
        job = self.jobs[job_id]
        if job.video_id is not None:
            self.transcripts[job.video_id] = transcript_to_json(transcript)
            if playback is not None or local_source_uri is not None:
                media = self.media[job.video_id]
                self.media[job.video_id] = VideoMedia(
                    source_kind=media.source_kind,
                    source_uri=media.source_uri,
                    content_type=media.content_type,
                    playback_provider=playback.provider if playback else media.playback_provider,
                    playback_id=playback.playback_id if playback else media.playback_id,
                    playback_url=playback.playback_url if playback else media.playback_url,
                    delivery_asset_id=playback.asset_id if playback else media.delivery_asset_id,
                    local_source_uri=local_source_uri,
                )
        self.jobs[job_id] = _replace_job(
            job,
            status=IngestionJobStatus.COMPLETE,
            progress=100,
            error_message=None,
        )

    async def mark_failed(self, job_id: UUID, error_message: str) -> None:
        job = self.jobs[job_id]
        self.jobs[job_id] = _replace_job(
            job,
            status=IngestionJobStatus.FAILED,
            progress=100,
            error_message=error_message,
        )

    async def get_job(self, job_id: UUID) -> IngestionJob | None:
        return self.jobs.get(job_id)

    async def get_video_transcript(self, video_id: UUID) -> dict[str, object] | None:
        return self.transcripts.get(video_id)

    async def get_video_media(self, video_id: UUID) -> VideoMedia | None:
        return self.media.get(video_id)


class MemoryUploadStorage:
    def __init__(self, path: Path, content_type: str = "video/mp4") -> None:
        self._path = path
        self._content_type = content_type

    async def store(self, upload: UploadFile) -> StoredUpload:
        if upload.content_type == "application/octet-stream":
            raise ValueError("Unsupported upload content type: application/octet-stream")
        return StoredUpload(
            path=self._path,
            source_uri=str(self._path),
            content_type=upload.content_type or self._content_type,
        )


class NoopUrlFetcher:
    def __init__(self, path: Path) -> None:
        self._path = path

    async def fetch(self, url: str) -> Path:
        if "unsupported" in url:
            raise ValueError("URL did not resolve to a supported direct audio/video file.")
        return self._path


class StaticSegmentationAgent(SegmentationAgent):
    def __init__(self, proposals: tuple[TopicProposal, ...]) -> None:
        self._proposals = proposals

    async def propose_topics(self, transcript: VideoTranscript) -> tuple[TopicProposal, ...]:
        del transcript
        return self._proposals


class StaticConceptGraphAgent(ConceptGraphAgent):
    def __init__(self, proposal: ConceptGraphProposal) -> None:
        self._proposal = proposal

    async def propose_graph(self, context: CourseGraphContext) -> ConceptGraphProposal:
        del context
        return self._proposal


class MemoryConceptGraphRepository(ConceptGraphRepository):
    def __init__(self, context: CourseGraphContext | None = None) -> None:
        self.context = context or CourseGraphContext(
            course_id=uuid4(),
            topics=(
                TopicContext(
                    id=uuid4(),
                    title="Vectors",
                    summary="Vector basics",
                    start_seconds=0,
                    end_seconds=600,
                ),
            ),
        )
        self.concepts: dict[UUID, Concept] = {}
        self.edges: dict[UUID, ConceptGraphEdge] = {}

    async def get_course_context(self, course_id: UUID) -> CourseGraphContext | None:
        if course_id != self.context.course_id:
            return None
        return self.context

    async def replace_ai_graph(
        self,
        course_id: UUID,
        proposal: ConceptGraphProposal,
    ) -> ConceptGraph:
        protected_concept_ids = {
            concept_id
            for edge in self.edges.values()
            if edge.review_status != GraphReviewStatus.PROPOSED
            for concept_id in (edge.from_concept_id, edge.to_concept_id)
        }
        self.concepts = {
            concept_id: concept
            for concept_id, concept in self.concepts.items()
            if not (
                concept.course_id == course_id
                and concept.review_status == GraphReviewStatus.PROPOSED
                and concept_id not in protected_concept_ids
            )
        }
        self.edges = {
            edge_id: edge
            for edge_id, edge in self.edges.items()
            if edge.review_status != GraphReviewStatus.PROPOSED
        }
        preserved_concepts = [
            concept
            for concept in self.concepts.values()
            if concept.course_id == course_id
            and (
                concept.review_status != GraphReviewStatus.PROPOSED
                or concept.id in protected_concept_ids
            )
        ]
        key_to_id: dict[str, UUID] = {}
        for proposal_concept in proposal.concepts:
            reviewed_match = next(
                (
                    concept
                    for concept in preserved_concepts
                    if concept_names_match(proposal_concept.name, concept.name)
                ),
                None,
            )
            if reviewed_match is not None:
                if (
                    reviewed_match.review_status != GraphReviewStatus.DISMISSED
                    and reviewed_match.merged_into_concept_id is None
                ):
                    key_to_id[proposal_concept.key] = reviewed_match.id
                continue
            concept = Concept(
                id=uuid4(),
                course_id=course_id,
                name=proposal_concept.name,
                description=proposal_concept.description,
                review_status=GraphReviewStatus.PROPOSED,
                ai_proposal={
                    "key": proposal_concept.key,
                    "name": proposal_concept.name,
                    "description": proposal_concept.description,
                    "topic_ids": [str(topic_id) for topic_id in proposal_concept.topic_ids],
                    "evidence": proposal_concept.evidence,
                    "confidence": proposal_concept.confidence,
                },
                instructor_revision=None,
                approved_at=None,
                dismissed_at=None,
                merged_into_concept_id=None,
            )
            self.concepts[concept.id] = concept
            key_to_id[proposal_concept.key] = concept.id
        for proposal_edge in proposal.edges:
            from_id = key_to_id.get(proposal_edge.from_key)
            to_id = key_to_id.get(proposal_edge.to_key)
            if from_id is None or to_id is None or from_id == to_id:
                continue
            if any(
                edge.from_concept_id == from_id and edge.to_concept_id == to_id
                for edge in self.edges.values()
            ):
                continue
            try:
                validate_no_cycle(_active_edge_pairs(self.edges) | {(from_id, to_id)})
            except GraphValidationError:
                continue
            edge = ConceptGraphEdge(
                id=uuid4(),
                from_concept_id=from_id,
                to_concept_id=to_id,
                relationship="requires",
                review_status=GraphReviewStatus.PROPOSED,
                ai_proposal={
                    "from_key": proposal_edge.from_key,
                    "to_key": proposal_edge.to_key,
                    "rationale": proposal_edge.rationale,
                    "evidence": proposal_edge.evidence,
                    "confidence": proposal_edge.confidence,
                },
                instructor_revision=None,
                approved_at=None,
                dismissed_at=None,
            )
            self.edges[edge.id] = edge
        return await self.get_graph(course_id)

    async def get_graph(self, course_id: UUID) -> ConceptGraph:
        return ConceptGraph(
            course_id=course_id,
            concepts=tuple(
                concept for concept in self.concepts.values() if concept.course_id == course_id
            ),
            edges=tuple(self.edges.values()),
        )

    async def add_concept(self, course_id: UUID, create: ConceptCreate) -> Concept:
        valid_topic_ids = {topic.id for topic in self.context.topics}
        if course_id != self.context.course_id or not set(create.topic_ids).issubset(
            valid_topic_ids
        ):
            raise ValueError("Concept topic links must belong to the same course.")
        concept = Concept(
            id=uuid4(),
            course_id=course_id,
            name=create.name,
            description=create.description,
            review_status=GraphReviewStatus.EDITED,
            ai_proposal=None,
            instructor_revision={
                "name": create.name,
                "description": create.description,
                "topic_ids": [str(topic_id) for topic_id in create.topic_ids],
                "action": create.action,
            },
            approved_at="now",
            dismissed_at=None,
            merged_into_concept_id=None,
        )
        self.concepts[concept.id] = concept
        return concept

    async def edit_concept(self, concept_id: UUID, edit: ConceptEdit) -> Concept | None:
        concept = self.concepts.get(concept_id)
        if concept is None:
            return None
        updated = _replace_concept(
            concept,
            name=edit.name,
            description=edit.description,
            review_status=GraphReviewStatus.EDITED,
            instructor_revision={
                **(concept.instructor_revision or {}),
                "name": edit.name,
                "description": edit.description,
                "action": edit.action,
            },
            approved_at="now",
            dismissed_at=None,
        )
        self.concepts[concept_id] = updated
        return updated

    async def accept_concept(self, concept_id: UUID) -> Concept | None:
        concept = self.concepts.get(concept_id)
        if concept is None:
            return None
        updated = _replace_concept(
            concept,
            review_status=GraphReviewStatus.ACCEPTED,
            approved_at="now",
            dismissed_at=None,
        )
        self.concepts[concept_id] = updated
        return updated

    async def set_concept_topics(
        self,
        concept_id: UUID,
        topic_ids: tuple[UUID, ...],
    ) -> Concept | None:
        concept = self.concepts.get(concept_id)
        if concept is None:
            return None
        updated = _replace_concept(
            concept,
            review_status=GraphReviewStatus.EDITED,
            instructor_revision={
                **(concept.instructor_revision or {}),
                "action": "edit_topic_links",
                "topic_ids": [str(topic_id) for topic_id in topic_ids],
            },
            approved_at="now",
            dismissed_at=None,
        )
        self.concepts[concept_id] = updated
        return updated

    async def dismiss_concept(self, concept_id: UUID) -> Concept | None:
        concept = self.concepts.get(concept_id)
        if concept is None:
            return None
        updated = _replace_concept(
            concept,
            review_status=GraphReviewStatus.DISMISSED,
            dismissed_at="now",
        )
        self.concepts[concept_id] = updated
        for edge_id, edge in list(self.edges.items()):
            if edge.from_concept_id == concept_id or edge.to_concept_id == concept_id:
                self.edges[edge_id] = _replace_edge(
                    edge,
                    review_status=GraphReviewStatus.DISMISSED,
                    dismissed_at="now",
                    instructor_revision={"action": "auto_dismiss_orphaned_by_concept"},
                )
        return updated

    async def merge_concepts(
        self,
        source_concept_id: UUID,
        target_concept_id: UUID,
    ) -> Concept | None:
        source = self.concepts.get(source_concept_id)
        if source is None or target_concept_id not in self.concepts:
            return None
        self.concepts[source_concept_id] = _replace_concept(
            source,
            review_status=GraphReviewStatus.DISMISSED,
            dismissed_at="now",
            merged_into_concept_id=target_concept_id,
            instructor_revision={
                "action": "merge",
                "merged_into_concept_id": str(target_concept_id),
            },
        )
        for edge_id, edge in list(self.edges.items()):
            from_id = (
                target_concept_id
                if edge.from_concept_id == source_concept_id
                else edge.from_concept_id
            )
            to_id = (
                target_concept_id if edge.to_concept_id == source_concept_id else edge.to_concept_id
            )
            if from_id == to_id:
                self.edges[edge_id] = _replace_edge(
                    edge,
                    review_status=GraphReviewStatus.DISMISSED,
                    dismissed_at="now",
                )
            elif from_id != edge.from_concept_id or to_id != edge.to_concept_id:
                self.edges[edge_id] = _replace_edge(
                    edge,
                    from_concept_id=from_id,
                    to_concept_id=to_id,
                    review_status=GraphReviewStatus.EDITED,
                    instructor_revision={"action": "merge_relink"},
                    approved_at="now",
                )
        return self.concepts[source_concept_id]

    async def add_edge(self, course_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge:
        del course_id
        _raise_if_cycle(self.edges, edit.from_concept_id, edit.to_concept_id)
        edge = ConceptGraphEdge(
            id=uuid4(),
            from_concept_id=edit.from_concept_id,
            to_concept_id=edit.to_concept_id,
            relationship="requires",
            review_status=GraphReviewStatus.EDITED,
            ai_proposal=None,
            instructor_revision=_edge_edit_json(edit),
            approved_at="now",
            dismissed_at=None,
        )
        self.edges[edge.id] = edge
        return edge

    async def edit_edge(self, edge_id: UUID, edit: EdgeEdit) -> ConceptGraphEdge | None:
        edge = self.edges.get(edge_id)
        if edge is None:
            return None
        _raise_if_cycle(self.edges, edit.from_concept_id, edit.to_concept_id, edge_id)
        updated = _replace_edge(
            edge,
            from_concept_id=edit.from_concept_id,
            to_concept_id=edit.to_concept_id,
            review_status=GraphReviewStatus.EDITED,
            instructor_revision=_edge_edit_json(edit),
            approved_at="now",
            dismissed_at=None,
        )
        self.edges[edge_id] = updated
        return updated

    async def accept_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        edge = self.edges.get(edge_id)
        if edge is None:
            return None
        updated = _replace_edge(edge, review_status=GraphReviewStatus.ACCEPTED, approved_at="now")
        self.edges[edge_id] = updated
        return updated

    async def dismiss_edge(self, edge_id: UUID) -> ConceptGraphEdge | None:
        edge = self.edges.get(edge_id)
        if edge is None:
            return None
        updated = _replace_edge(
            edge,
            review_status=GraphReviewStatus.DISMISSED,
            dismissed_at="now",
        )
        self.edges[edge_id] = updated
        return updated


class MemoryTopicRepository(TopicRepository):
    def __init__(self, transcript: VideoTranscript | None = None) -> None:
        self.transcript = transcript or VideoTranscript(
            video_id=uuid4(),
            course_id=uuid4(),
            text="",
            words=(),
        )
        self.topics: dict[UUID, Topic] = {}
        self.concept_links: dict[UUID, set[UUID]] = {}

    async def get_video_transcript(self, video_id: UUID) -> VideoTranscript | None:
        if video_id != self.transcript.video_id:
            return None
        return self.transcript

    async def replace_ai_proposals(
        self,
        video_id: UUID,
        course_id: UUID,
        proposals: tuple[TopicProposal, ...],
    ) -> tuple[Topic, ...]:
        self.topics = {
            topic_id: topic
            for topic_id, topic in self.topics.items()
            if not (
                topic.video_id == video_id and topic.review_status == TopicReviewStatus.PROPOSED
            )
        }
        created = tuple(
            self._topic_from_proposal(video_id, course_id, proposal) for proposal in proposals
        )
        for topic in created:
            self.topics[topic.id] = topic
        return created

    async def list_topics(self, video_id: UUID) -> tuple[Topic, ...]:
        return tuple(
            sorted(
                (
                    topic
                    for topic in self.topics.values()
                    if topic.video_id == video_id
                    and topic.review_status != TopicReviewStatus.DISMISSED
                ),
                key=lambda topic: topic.start_seconds,
            )
        )

    async def get_topic(self, topic_id: UUID) -> Topic | None:
        return self.topics.get(topic_id)

    async def edit_topic(self, topic_id: UUID, edit: TopicEdit) -> Topic | None:
        topic = self.topics.get(topic_id)
        if topic is None:
            return None
        updated = _replace_topic(
            topic,
            title=edit.title,
            summary=edit.summary,
            start_seconds=edit.start_seconds,
            end_seconds=edit.end_seconds,
            review_status=TopicReviewStatus.EDITED,
            instructor_revision=_edit_json(edit),
            approved_at="now",
            dismissed_at=None,
        )
        self.topics[topic_id] = updated
        return updated

    async def accept_topic(self, topic_id: UUID) -> Topic | None:
        topic = self.topics.get(topic_id)
        if topic is None:
            return None
        updated = _replace_topic(
            topic,
            review_status=TopicReviewStatus.ACCEPTED,
            approved_at="now",
            dismissed_at=None,
        )
        self.topics[topic_id] = updated
        return updated

    async def dismiss_topic(self, topic_id: UUID) -> Topic | None:
        topic = self.topics.get(topic_id)
        if topic is None:
            return None
        updated = _replace_topic(
            topic,
            review_status=TopicReviewStatus.DISMISSED,
            dismissed_at="now",
        )
        self.topics[topic_id] = updated
        return updated

    async def add_manual_topic(
        self,
        video_id: UUID,
        course_id: UUID,
        edit: TopicEdit,
    ) -> Topic:
        topic = Topic(
            id=uuid4(),
            course_id=course_id,
            video_id=video_id,
            title=edit.title,
            summary=edit.summary,
            start_seconds=edit.start_seconds,
            end_seconds=edit.end_seconds,
            review_status=TopicReviewStatus.EDITED,
            ai_proposal=None,
            instructor_revision=_edit_json(edit),
            approved_at="now",
            dismissed_at=None,
        )
        self.topics[topic.id] = topic
        return topic

    async def remap_concept_links(
        self,
        source_topic_ids: tuple[UUID, ...],
        target_topic_ids: tuple[UUID, ...],
    ) -> None:
        source_ids = set(source_topic_ids)
        for topic_ids in self.concept_links.values():
            if topic_ids & source_ids:
                topic_ids.difference_update(source_ids)
                topic_ids.update(target_topic_ids)

    def _topic_from_proposal(
        self,
        video_id: UUID,
        course_id: UUID,
        proposal: TopicProposal,
    ) -> Topic:
        return Topic(
            id=uuid4(),
            course_id=course_id,
            video_id=video_id,
            title=proposal.title,
            summary=proposal.summary,
            start_seconds=proposal.start_seconds,
            end_seconds=proposal.end_seconds,
            review_status=TopicReviewStatus.PROPOSED,
            ai_proposal={
                "title": proposal.title,
                "summary": proposal.summary,
                "start_seconds": proposal.start_seconds,
                "end_seconds": proposal.end_seconds,
                "evidence": proposal.evidence,
                "confidence": proposal.confidence,
            },
            instructor_revision=None,
            approved_at=None,
            dismissed_at=None,
        )


def _replace_job(
    job: IngestionJob,
    status: IngestionJobStatus,
    progress: float,
    error_message: str | None,
) -> IngestionJob:
    return IngestionJob(
        id=job.id,
        video_id=job.video_id,
        course_id=job.course_id,
        source_kind=job.source_kind,
        source_uri=job.source_uri,
        status=status,
        progress=progress,
        error_message=error_message,
    )


def _replace_topic(
    topic: Topic,
    *,
    title: str | None = None,
    summary: str | None = None,
    start_seconds: float | None = None,
    end_seconds: float | None = None,
    review_status: TopicReviewStatus | None = None,
    instructor_revision: dict[str, object] | None = None,
    approved_at: str | None = None,
    dismissed_at: str | None = None,
) -> Topic:
    return Topic(
        id=topic.id,
        course_id=topic.course_id,
        video_id=topic.video_id,
        title=topic.title if title is None else title,
        summary=topic.summary if summary is None else summary,
        start_seconds=topic.start_seconds if start_seconds is None else start_seconds,
        end_seconds=topic.end_seconds if end_seconds is None else end_seconds,
        review_status=topic.review_status if review_status is None else review_status,
        ai_proposal=topic.ai_proposal,
        instructor_revision=(
            topic.instructor_revision if instructor_revision is None else instructor_revision
        ),
        approved_at=topic.approved_at if approved_at is None else approved_at,
        dismissed_at=topic.dismissed_at if dismissed_at is None else dismissed_at,
    )


def _replace_concept(
    concept: Concept,
    *,
    name: str | None = None,
    description: str | None = None,
    review_status: GraphReviewStatus | None = None,
    instructor_revision: dict[str, object] | None = None,
    approved_at: str | None = None,
    dismissed_at: str | None = None,
    merged_into_concept_id: UUID | None = None,
) -> Concept:
    return Concept(
        id=concept.id,
        course_id=concept.course_id,
        name=concept.name if name is None else name,
        description=concept.description if description is None else description,
        review_status=concept.review_status if review_status is None else review_status,
        ai_proposal=concept.ai_proposal,
        instructor_revision=(
            concept.instructor_revision if instructor_revision is None else instructor_revision
        ),
        approved_at=concept.approved_at if approved_at is None else approved_at,
        dismissed_at=concept.dismissed_at if dismissed_at is None else dismissed_at,
        merged_into_concept_id=(
            concept.merged_into_concept_id
            if merged_into_concept_id is None
            else merged_into_concept_id
        ),
    )


def _replace_edge(
    edge: ConceptGraphEdge,
    *,
    from_concept_id: UUID | None = None,
    to_concept_id: UUID | None = None,
    review_status: GraphReviewStatus | None = None,
    instructor_revision: dict[str, object] | None = None,
    approved_at: str | None = None,
    dismissed_at: str | None = None,
) -> ConceptGraphEdge:
    return ConceptGraphEdge(
        id=edge.id,
        from_concept_id=edge.from_concept_id if from_concept_id is None else from_concept_id,
        to_concept_id=edge.to_concept_id if to_concept_id is None else to_concept_id,
        relationship=edge.relationship,
        review_status=edge.review_status if review_status is None else review_status,
        ai_proposal=edge.ai_proposal,
        instructor_revision=(
            edge.instructor_revision if instructor_revision is None else instructor_revision
        ),
        approved_at=edge.approved_at if approved_at is None else approved_at,
        dismissed_at=edge.dismissed_at if dismissed_at is None else dismissed_at,
    )


def _edge_edit_json(edit: EdgeEdit) -> dict[str, object]:
    return {
        "from_concept_id": str(edit.from_concept_id),
        "to_concept_id": str(edit.to_concept_id),
        "rationale": edit.rationale,
        "action": edit.action,
    }


def _active_edge_pairs(
    edges: dict[UUID, ConceptGraphEdge],
    ignore_edge_id: UUID | None = None,
) -> set[tuple[UUID, UUID]]:
    return {
        (edge.from_concept_id, edge.to_concept_id)
        for edge_id, edge in edges.items()
        if edge.review_status != GraphReviewStatus.DISMISSED and edge_id != ignore_edge_id
    }


def _raise_if_cycle(
    edges: dict[UUID, ConceptGraphEdge],
    from_id: UUID,
    to_id: UUID,
    ignore_edge_id: UUID | None = None,
) -> None:
    try:
        validate_no_cycle(_active_edge_pairs(edges, ignore_edge_id) | {(from_id, to_id)})
    except GraphValidationError as exc:
        raise ValueError(str(exc)) from exc


def _edit_json(edit: TopicEdit) -> dict[str, object]:
    return {
        "title": edit.title,
        "summary": edit.summary,
        "start_seconds": edit.start_seconds,
        "end_seconds": edit.end_seconds,
        "action": edit.action,
    }


def segmentation_words(duration_minutes: int = 36) -> tuple[SegmentationTranscriptWord, ...]:
    words: list[SegmentationTranscriptWord] = []
    for minute in range(duration_minutes):
        prefix = "Now" if minute in {0, 12, 24} else "detail"
        for index, text in enumerate([prefix, "linear", "algebra", "concepts"]):
            start = minute * 60 + index
            words.append(
                SegmentationTranscriptWord(
                    text=text,
                    start_seconds=float(start),
                    end_seconds=float(start + 0.5),
                )
            )
    return tuple(words)
