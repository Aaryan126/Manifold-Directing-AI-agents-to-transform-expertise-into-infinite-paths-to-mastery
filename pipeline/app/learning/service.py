from datetime import UTC, datetime
from uuid import UUID

from app.assessments.service import AssessmentService, AssessmentValidationError
from app.learning.models import (
    ClipTranscript,
    HelpRequest,
    LearnerRevision,
    LearningMode,
    MasteryReview,
    Orientation,
    PlacementCheck,
    StudySession,
)
from app.learning.postgres_repository import PostgresLearningRepository
from app.routing.models import AttemptSubmission, LearnerPath, LearnerPathItem, RouteDecision
from app.routing.service import RoutingService, RoutingValidationError


class LearningValidationError(ValueError):
    pass


class LearningService:
    def __init__(
        self,
        repository: PostgresLearningRepository,
        routing: RoutingService,
        assessments: AssessmentService,
    ) -> None:
        self._repository = repository
        self._routing = routing
        self._assessments = assessments

    async def context(self, learner_id: UUID, course_id: UUID) -> LearnerRevision:
        context = await self._repository.learner_revision(learner_id, course_id)
        if context is None:
            raise LearningValidationError(
                "This learner is not enrolled in the active published course revision.",
            )
        return context

    async def workspace(self, learner_id: UUID, course_id: UUID) -> dict[str, object]:
        context = await self.context(learner_id, course_id)
        path = await self._path(learner_id, course_id)
        orientation = await self._repository.orientation(context)
        session = await self._repository.active_session(context)
        placement = await self._repository.placement(context)
        mastery = await self._repository.mastery_review(context, _path_rows(path))
        modes = self._mode_options(path, mastery, session)
        guide_actions = list(self._guide_actions(path, session))
        active_step = (
            next((step for step in session.steps if step.status == "active"), None)
            if session
            else None
        )
        if (
            session
            and active_step
            and active_step.kind == "question"
            and await self._repository.has_approved_hint(
                context,
                session.id,
                active_step.id,
            )
        ):
            guide_actions.append("approved_hint")
        return {
            "revision_id": context.revision_id,
            "orientation": orientation,
            "modes": modes,
            "session": session,
            "placement": placement,
            "mastery": mastery,
            "guide_actions": tuple(guide_actions),
            "content_message": (
                None
                if path.current_concept_id
                else (
                    "No eligible concept currently has both reviewed teaching "
                    "and assessment coverage."
                )
            ),
        }

    async def complete_orientation(
        self,
        learner_id: UUID,
        course_id: UUID,
        *,
        entry_choice: str,
    ) -> Orientation:
        if entry_choice not in {"recommended", "placement", "foundations"}:
            raise LearningValidationError("Choose recommended, placement, or foundations.")
        context = await self.context(learner_id, course_id)
        return await self._repository.complete_orientation(
            context,
            entry_choice=entry_choice,
        )

    async def create_session(
        self,
        learner_id: UUID,
        course_id: UUID,
        *,
        mode: str,
        idempotency_key: str,
        concept_id: UUID | None = None,
    ) -> StudySession:
        self._validate_mode(mode)
        if not idempotency_key.strip():
            raise LearningValidationError("An idempotency key is required.")
        context = await self.context(learner_id, course_id)
        path = await self._path(learner_id, course_id)
        mastery = await self._repository.mastery_review(context, _path_rows(path))
        steps = await self._plan(
            context,
            path,
            mastery,
            mode=mode,
            preferred_concept_id=concept_id,
        )
        if not steps:
            raise LearningValidationError(
                "That learning mode is unavailable because no eligible concept has "
                "the required reviewed evidence and content.",
            )
        return await self._repository.create_session(
            context,
            mode=mode,
            idempotency_key=idempotency_key.strip(),
            steps=steps,
        )

    async def start_session(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
    ) -> StudySession:
        context = await self.context(learner_id, course_id)
        session = await self._repository.start_session(context, session_id)
        if session is None:
            raise LearningValidationError("Study session was not found or cannot be started.")
        return session

    async def adjust_session(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
        *,
        mode: str | None = None,
        concept_id: UUID | None = None,
    ) -> StudySession:
        context = await self.context(learner_id, course_id)
        path = await self._path(learner_id, course_id)
        mastery = await self._repository.mastery_review(context, _path_rows(path))
        current = await self._repository.active_session(context)
        if current is None or current.id != session_id:
            raise LearningValidationError("Active study session was not found.")
        selected_mode = mode or current.mode
        self._validate_mode(selected_mode)
        steps = await self._plan(
            context,
            path,
            mastery,
            mode=selected_mode,
            preferred_concept_id=concept_id,
        )
        if not steps:
            raise LearningValidationError(
                "That learning mode is unavailable for the current reviewed evidence.",
            )
        updated = await self._repository.replace_pending_steps(
            context,
            session_id,
            mode=selected_mode,
            steps=steps,
        )
        if updated is None:
            raise LearningValidationError("Study session could not be adjusted.")
        return updated

    async def finish_session(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
    ) -> StudySession:
        context = await self.context(learner_id, course_id)
        current = await self._repository.active_session(context)
        if current is None or current.id != session_id:
            raise LearningValidationError("Active study session was not found.")
        if current.status == "reflecting":
            return current
        concept_id = next(
            (
                step.concept_id
                for step in current.steps
                if step.status in {"active", "completed"} and step.concept_id is not None
            ),
            None,
        )
        path = await self._path(learner_id, course_id)
        target = next((item for item in path.items if item.concept_id == concept_id), None)
        if target is None:
            raise LearningValidationError("The current session focus is no longer available.")
        updated = await self._repository.replace_pending_steps(
            context,
            session_id,
            mode=current.mode,
            steps=(_step("reflect", "reflect", target, "session_reflection"),),
            finish_requested=True,
        )
        if updated is None:
            raise LearningValidationError("The study session could not be finished.")
        return updated

    async def complete_watch(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
        step_id: UUID,
    ) -> StudySession:
        context = await self.context(learner_id, course_id)
        step = await self._repository.session_step(context, session_id, step_id)
        if step is None or str(step["kind"]) != "watch":
            raise LearningValidationError("The active reviewed clip step was not found.")
        session = await self._repository.complete_step(context, session_id, step_id)
        if session is None:
            raise LearningValidationError("The clip step could not be completed.")
        return session

    async def answer_step(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
        step_id: UUID,
        *,
        answer: str,
        confidence: int,
    ) -> tuple[StudySession, RouteDecision, bool, str]:
        if not answer.strip():
            raise LearningValidationError("Answer is required.")
        if not 1 <= confidence <= 4:
            raise LearningValidationError("Confidence must be between 1 and 4.")
        context = await self.context(learner_id, course_id)
        step = await self._repository.session_step(context, session_id, step_id)
        if step is None or str(step["kind"]) != "question" or not step["question_id"]:
            raise LearningValidationError("The active approved question step was not found.")
        question_id = UUID(str(step["question_id"]))
        try:
            grade = await self._assessments.grade_answer(question_id, answer.strip())
        except AssessmentValidationError as exc:
            raise LearningValidationError(str(exc)) from exc
        if grade is None:
            raise LearningValidationError("The approved question is no longer available.")
        purpose = "review" if str(step["purpose"]) == "review" else "lesson"
        try:
            decision = await self._routing.submit_attempt(
                AttemptSubmission(
                    learner_id=learner_id,
                    question_id=question_id,
                    answer={"answer": answer.strip()},
                    correctness=grade.is_correct,
                    confidence=confidence,
                    wrong_answer_pattern=grade.wrong_answer_pattern,
                    purpose=purpose,
                    study_session_id=session_id,
                ),
            )
        except RoutingValidationError as exc:
            raise LearningValidationError(str(exc)) from exc
        concept_id = UUID(str(step["concept_id"]))
        policy = (await self._routing.list_policies(course_id)).get(concept_id)
        if policy is None:
            policy = (await self._routing.list_policies(course_id)).get(None)
        threshold = policy.confidence_threshold if policy else 3
        await self._repository.schedule_review(
            context,
            concept_id,
            correctness=grade.is_correct,
            confidence=confidence,
            confidence_threshold=threshold,
            purpose=purpose,
            attempt_id=None,
        )
        session = await self._repository.complete_step(
            context,
            session_id,
            step_id,
            route_event_id=decision.route_event_id,
        )
        if session is None:
            raise LearningValidationError(
                "The answer was recorded but the session could not advance."
            )
        session = await self._adapt_after_answer(context, session, decision, concept_id)
        return session, decision, grade.is_correct, grade.feedback

    async def reflect(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
        *,
        self_report: str,
        note: str | None,
        concept_id: UUID | None,
    ) -> StudySession:
        if self_report not in {"can_explain", "with_example", "still_unsure"}:
            raise LearningValidationError("Choose one of the available reflection responses.")
        context = await self.context(learner_id, course_id)
        session = await self._repository.record_reflection(
            context,
            session_id,
            self_report=self_report,
            note=_clean_note(note),
            concept_id=concept_id,
        )
        if session is None:
            raise LearningValidationError("The active session could not be completed.")
        return session

    async def create_placement(
        self,
        learner_id: UUID,
        course_id: UUID,
        *,
        idempotency_key: str,
    ) -> PlacementCheck:
        context = await self.context(learner_id, course_id)
        path = await self._path(learner_id, course_id)
        policies = await self._routing.list_policies(course_id)
        candidates: list[tuple[UUID, UUID]] = []
        concept_policies: dict[str, object] = {}
        snapshot: dict[str, object] = {"concepts": concept_policies}
        for item in path.items:
            if not item.actionable or not item.question_ids:
                continue
            policy = policies.get(item.concept_id) or policies.get(None)
            threshold = policy.confidence_threshold if policy else 3
            required = policy.correct_attempts_for_mastery if policy else 1
            candidates.append((item.concept_id, item.question_ids[0]))
            concept_policies[str(item.concept_id)] = {
                "confidence_threshold": threshold,
                "required_correct": required,
            }
            if len(candidates) == 8:
                break
        unavailable = None
        if len(candidates) < 2:
            unavailable = (
                "There are not enough instructor-reviewed, concept-linked questions "
                "to create a trustworthy placement check. Your reviewed course path is unchanged."
            )
            candidates = []
        return await self._repository.create_placement(
            context,
            idempotency_key=idempotency_key,
            policy_snapshot=snapshot,
            candidates=tuple(candidates),
            unavailable_reason=unavailable,
        )

    async def answer_placement(
        self,
        learner_id: UUID,
        course_id: UUID,
        check_id: UUID,
        item_id: UUID,
        *,
        answer: str,
        confidence: int,
    ) -> PlacementCheck:
        context = await self.context(learner_id, course_id)
        item = await self._repository.placement_item(context, check_id, item_id)
        if item is None:
            raise LearningValidationError("Placement item was not found or is already complete.")
        question_id = UUID(str(item["question_id"]))
        try:
            grade = await self._assessments.grade_answer(question_id, answer.strip())
        except AssessmentValidationError as exc:
            raise LearningValidationError(str(exc)) from exc
        if grade is None:
            raise LearningValidationError("The reviewed placement question is unavailable.")
        policies = await self._routing.list_policies(course_id)
        concept_id = UUID(str(item["concept_id"]))
        policy = policies.get(concept_id) or policies.get(None)
        result = await self._repository.record_placement_answer(
            context,
            check_id,
            item_id,
            answer=answer.strip(),
            correctness=grade.is_correct,
            confidence=confidence,
            wrong_answer_pattern=grade.wrong_answer_pattern,
            confidence_threshold=policy.confidence_threshold if policy else 3,
            required_correct=policy.correct_attempts_for_mastery if policy else 1,
        )
        if result is None:
            raise LearningValidationError("Placement answer could not be recorded.")
        return result

    async def transcript(
        self,
        learner_id: UUID,
        course_id: UUID,
        clip_id: UUID,
    ) -> ClipTranscript:
        context = await self.context(learner_id, course_id)
        transcript = await self._repository.clip_transcript(context, clip_id)
        if transcript is None:
            raise LearningValidationError("Reviewed clip transcript was not found.")
        return transcript

    async def next_hint(
        self,
        learner_id: UUID,
        course_id: UUID,
        session_id: UUID,
        step_id: UUID,
    ) -> str:
        context = await self.context(learner_id, course_id)
        hint = await self._repository.next_hint(context, session_id, step_id)
        if hint is None:
            raise LearningValidationError("No further instructor-approved hint is available.")
        return hint

    async def help_preview(
        self,
        learner_id: UUID,
        course_id: UUID,
        *,
        session_id: UUID | None,
        concept_id: UUID | None,
    ) -> dict[str, object]:
        context = await self.context(learner_id, course_id)
        return await self._repository.help_preview(
            context,
            session_id=session_id,
            concept_id=concept_id,
        )

    async def create_help_request(
        self,
        learner_id: UUID,
        course_id: UUID,
        *,
        session_id: UUID | None,
        concept_id: UUID | None,
        learner_note: str | None,
    ) -> HelpRequest:
        context = await self.context(learner_id, course_id)
        evidence = await self._repository.help_preview(
            context,
            session_id=session_id,
            concept_id=concept_id,
        )
        topic_id = None
        if concept_id is not None:
            path = await self._path(learner_id, course_id)
            concept = next(
                (item for item in path.items if item.concept_id == concept_id),
                None,
            )
            topic_id = concept.topic_id if concept else None
        return await self._repository.create_help_request(
            context,
            session_id=session_id,
            concept_id=concept_id,
            topic_id=topic_id,
            learner_note=_clean_note(learner_note),
            evidence=evidence,
        )

    async def instructor_help_requests(
        self,
        instructor_id: UUID,
        course_id: UUID,
    ) -> tuple[HelpRequest, ...]:
        requests = await self._repository.instructor_help_requests(instructor_id, course_id)
        if requests is None:
            raise LearningValidationError("Instructor course access was not found.")
        return requests

    async def update_help_request(
        self,
        instructor_id: UUID,
        course_id: UUID,
        request_id: UUID,
        status: str,
    ) -> HelpRequest:
        if status not in {"acknowledged", "resolved"}:
            raise LearningValidationError("Help requests can be acknowledged or resolved.")
        request = await self._repository.update_help_request(
            instructor_id,
            course_id,
            request_id,
            status,
        )
        if request is None:
            raise LearningValidationError("Instructor help request was not found.")
        return request

    async def instructor_hint_ladder(
        self,
        instructor_id: UUID,
        question_id: UUID,
    ) -> dict[str, object]:
        ladder = await self._repository.instructor_hint_ladder(
            instructor_id,
            question_id,
        )
        if ladder is None:
            raise LearningValidationError("Instructor hint ladder was not found.")
        return ladder

    async def review_hint_ladder(
        self,
        instructor_id: UUID,
        question_id: UUID,
        *,
        action: str,
        hints: tuple[str, ...] | None = None,
    ) -> dict[str, object]:
        status = {
            "accept": "accepted",
            "edit": "edited",
            "dismiss": "dismissed",
        }.get(action)
        if status is None:
            raise LearningValidationError("Hint action must be accept, edit, or dismiss.")
        cleaned = None
        if hints is not None:
            cleaned = tuple(value.strip() for value in hints if value.strip())
            if not cleaned:
                raise LearningValidationError("An edited hint ladder cannot be empty.")
            if any(len(value) > 1000 for value in cleaned):
                raise LearningValidationError("Each approved hint must be 1000 characters or less.")
        if status == "edited" and cleaned is None:
            raise LearningValidationError("Edited hint text is required.")
        ladder = await self._repository.review_hint_ladder(
            instructor_id,
            question_id,
            status=status,
            hints=cleaned,
        )
        if ladder is None:
            raise LearningValidationError("Instructor hint ladder was not found.")
        return ladder

    async def mastery(
        self,
        learner_id: UUID,
        course_id: UUID,
    ) -> MasteryReview:
        context = await self.context(learner_id, course_id)
        path = await self._path(learner_id, course_id)
        return await self._repository.mastery_review(context, _path_rows(path))

    async def guide_action(
        self,
        learner_id: UUID,
        course_id: UUID,
        action: str,
    ) -> dict[str, object]:
        path = await self._path(learner_id, course_id)
        if action == "change_mode":
            return {"kind": "modes", "title": "Choose a learning mode"}
        current = next((item for item in path.items if item.current), None)
        if current is None:
            raise LearningValidationError("There is no actionable current concept.")
        if action == "why_next":
            return {
                "kind": "evidence",
                "title": "Why this lesson?",
                "message": path.last_route_why
                or (
                    f"{current.name} is ready because its prerequisites are mastered "
                    "and it has reviewed teaching and assessment coverage."
                ),
            }
        if action == "replay":
            return {
                "kind": "clip",
                "clip_id": current.clip_ids[0],
                "concept_id": current.concept_id,
            }
        if action == "approved_source" and current.aids:
            aid = current.aids[0]
            return {
                "kind": "source",
                "source_id": aid.source_id,
                "title": aid.title,
                "page_number": aid.page_number,
                "excerpt": aid.excerpt,
            }
        if action == "quiz":
            return {
                "kind": "question",
                "question_id": current.question_ids[0],
                "concept_id": current.concept_id,
            }
        if action == "finish_session":
            return {"kind": "session_control", "action": "finish"}
        if action == "prerequisite" and current.prerequisite_ids:
            prerequisite = next(
                (item for item in path.items if item.concept_id == current.prerequisite_ids[-1]),
                None,
            )
            if prerequisite:
                return {
                    "kind": "concept",
                    "concept_id": prerequisite.concept_id,
                    "title": prerequisite.name,
                    "eligible": prerequisite.eligible and prerequisite.actionable,
                }
        raise LearningValidationError("That Learning Guide action is unavailable in this context.")

    async def _path(self, learner_id: UUID, course_id: UUID) -> LearnerPath:
        try:
            return await self._routing.learner_path(learner_id, course_id)
        except RoutingValidationError as exc:
            raise LearningValidationError(str(exc)) from exc

    async def _plan(
        self,
        context: LearnerRevision,
        path: LearnerPath,
        mastery: MasteryReview,
        *,
        mode: str,
        preferred_concept_id: UUID | None = None,
    ) -> tuple[dict[str, object], ...]:
        candidate = self._select_candidate(path, mastery, mode, preferred_concept_id)
        if candidate is None:
            return ()
        artifacts = await self._repository.concept_artifacts(context, (candidate.concept_id,))
        artifact = artifacts.get(candidate.concept_id)
        if not artifact or not artifact["clip_id"] or not artifact["question_id"]:
            return ()
        if mode == "review_learned":
            return (
                _step(
                    "question",
                    "review",
                    candidate,
                    "review_retrieval",
                    question_id=artifact["question_id"],
                ),
                _step("reflect", "reflect", candidate, "session_reflection"),
            )
        reason = {
            "continue_path": "recommended_current",
            "learn_new": "learn_new",
            "strengthen_weak_areas": "strengthen_weak_area",
        }[mode]
        purpose = {
            "continue_path": "learn",
            "learn_new": "learn",
            "strengthen_weak_areas": "reinforcement",
        }[mode]
        return (
            _step("watch", purpose, candidate, reason, clip_id=artifact["clip_id"]),
            _step(
                "question",
                "practice" if mode != "strengthen_weak_areas" else "reinforcement",
                candidate,
                "practice_after_watch",
                question_id=artifact["question_id"],
            ),
            _step("reflect", "reflect", candidate, "session_reflection"),
        )

    def _select_candidate(
        self,
        path: LearnerPath,
        mastery: MasteryReview,
        mode: str,
        preferred_concept_id: UUID | None = None,
    ) -> LearnerPathItem | None:
        actionable = [item for item in path.items if item.eligible and item.actionable]
        mastery_by_id = {item.concept_id: item for item in mastery.concepts}
        if preferred_concept_id is not None:
            preferred = next(
                (item for item in actionable if item.concept_id == preferred_concept_id),
                None,
            )
            if preferred is None or (
                mode != "review_learned" and preferred.state.value == "mastered"
            ):
                raise LearningValidationError(
                    "That concept is blocked or does not have complete reviewed content.",
                )
            return preferred
        if mode == "learn_new":
            return next((item for item in actionable if item.state.value == "not_started"), None)
        if mode == "strengthen_weak_areas":
            return next(
                (
                    item
                    for item in actionable
                    if item.state.value == "struggling"
                    or mastery_by_id.get(item.concept_id, None)
                    and mastery_by_id[item.concept_id].mismatch is not None
                ),
                None,
            )
        if mode == "review_learned":
            due: list[LearnerPathItem] = []
            for item in actionable:
                review = mastery_by_id.get(item.concept_id)
                if (
                    review is not None
                    and review.due_at is not None
                    and review.due_at <= datetime.now(UTC)
                ):
                    due.append(item)
            if due:
                return due[0]
            return next(
                (
                    item
                    for item in actionable
                    if item.state.value in {"practiced", "mastered", "struggling"}
                ),
                None,
            )
        forward = [item for item in actionable if item.state.value != "mastered"]
        return next((item for item in forward if item.current), forward[0] if forward else None)

    def _mode_options(
        self,
        path: LearnerPath,
        mastery: MasteryReview,
        session: StudySession | None,
    ) -> tuple[LearningMode, ...]:
        definitions = (
            (
                "continue_path",
                "Continue my path",
                "Resume Manifold’s strongest reviewed next step.",
            ),
            (
                "learn_new",
                "Learn something new",
                "Begin an eligible concept you have not studied yet.",
            ),
            (
                "strengthen_weak_areas",
                "Strengthen weak areas",
                "Repair uncertainty, a confidence mismatch, or recent difficulty.",
            ),
            (
                "review_learned",
                "Review what I learned",
                "Retrieve practiced material and reinforce what should be revisited.",
            ),
        )
        candidates = {
            key: self._select_candidate(path, mastery, key)
            for key, _, _ in definitions
        }
        due_review = any(
            item.due_at is not None and item.due_at <= datetime.now(UTC)
            for item in mastery.concepts
        )
        if session:
            recommended = session.mode
            recommendation_reason = "Resume the learning loop already in progress."
        elif candidates["strengthen_weak_areas"] is not None:
            recommended = "strengthen_weak_areas"
            recommendation_reason = (
                "Recent correctness, confidence, or routing evidence shows uncertainty."
            )
        elif due_review and candidates["review_learned"] is not None:
            recommended = "review_learned"
            recommendation_reason = "A practiced concept is due for evidence-based review."
        elif candidates["continue_path"] is not None:
            recommended = "continue_path"
            recommendation_reason = "This is the strongest reviewed next step in your path."
        else:
            recommended = "learn_new"
            recommendation_reason = "An eligible new concept is ready."
        disabled = {
            "continue_path": "No routed concept currently has complete reviewed coverage.",
            "learn_new": "No new prerequisite-ready concept has complete reviewed coverage.",
            "strengthen_weak_areas": (
                "This becomes available when attempts show difficulty or a confidence mismatch."
            ),
            "review_learned": (
                "This becomes available after you have practiced reviewed course material."
            ),
        }
        return tuple(
            LearningMode(
                key=key,
                title=title,
                description=description,
                available=(
                    candidates[key] is not None
                    or (session is not None and session.mode == key)
                ),
                recommended=key == recommended,
                reason=recommendation_reason if key == recommended else None,
                disabled_reason=None if candidates[key] is not None else disabled[key],
            )
            for key, title, description in definitions
        )

    @staticmethod
    def _validate_mode(mode: str) -> None:
        if mode not in {
            "continue_path",
            "learn_new",
            "strengthen_weak_areas",
            "review_learned",
        }:
            raise LearningValidationError("Unsupported learning mode.")

    async def _adapt_after_answer(
        self,
        context: LearnerRevision,
        session: StudySession,
        decision: RouteDecision,
        answered_concept_id: UUID,
    ) -> StudySession:
        path = await self._path(context.learner_id, context.course_id)
        target_id = decision.target_concept_id
        target = next((item for item in path.items if item.concept_id == target_id), None)
        if (
            decision.action.value in {"reinforce", "remediate"}
            and target
            and target.eligible
            and target.actionable
        ):
            artifacts = await self._repository.concept_artifacts(context, (target.concept_id,))
            artifact = artifacts.get(target.concept_id)
            if artifact and artifact["clip_id"] and artifact["question_id"]:
                purpose = {
                    "reinforce": "reinforcement",
                    "remediate": "remediation",
                }[decision.action.value]
                reason = {
                    "reinforce": "reinforce_confidence",
                    "remediate": "repair_prerequisite",
                }[decision.action.value]
                steps = (
                    _step("watch", purpose, target, reason, clip_id=artifact["clip_id"]),
                    _step(
                        "question",
                        purpose,
                        target,
                        "practice_after_watch",
                        question_id=artifact["question_id"],
                    ),
                    _step("reflect", "reflect", target, "session_reflection"),
                )
                adjusted = await self._repository.replace_pending_steps(
                    context,
                    session.id,
                    mode=session.mode,
                    steps=steps,
                )
                if adjusted:
                    return adjusted
        reflection_target = next(
            (item for item in path.items if item.concept_id == answered_concept_id),
            None,
        )
        if reflection_target:
            adjusted = await self._repository.replace_pending_steps(
                context,
                session.id,
                mode=session.mode,
                steps=(_step("reflect", "reflect", reflection_target, "session_reflection"),),
            )
            if adjusted:
                return adjusted
        return session

    def _guide_actions(
        self,
        path: LearnerPath,
        session: StudySession | None,
    ) -> tuple[str, ...]:
        current = next((item for item in path.items if item.current), None)
        if current is None:
            return ()
        actions = ["why_next", "replay", "quiz", "stuck", "change_mode"]
        if session is not None:
            actions.append("finish_session")
        if current.prerequisite_ids:
            actions.append("prerequisite")
        if current.aids:
            actions.append("approved_source")
        return tuple(actions)


def _step(
    kind: str,
    purpose: str,
    item: LearnerPathItem,
    reason_code: str,
    *,
    clip_id: object | None = None,
    question_id: object | None = None,
) -> dict[str, object]:
    return {
        "kind": kind,
        "purpose": purpose,
        "concept_id": item.concept_id,
        "clip_id": clip_id,
        "question_id": question_id,
        "reason_code": reason_code,
        "evidence_snapshot": {
            "concept_name": item.name,
            "prerequisite_ids": [str(value) for value in item.prerequisite_ids],
            "coverage_state": item.coverage_state,
        },
    }


def _path_rows(path: LearnerPath) -> tuple[dict[str, object], ...]:
    return tuple(
        {
            "concept_id": item.concept_id,
            "name": item.name,
            "state": item.state.value,
            "eligible": item.eligible,
            "actionable": item.actionable,
            "coverage_state": item.coverage_state,
        }
        for item in path.items
    )


def _clean_note(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned[:1000] if cleaned else None
