from typing import Any
from uuid import UUID

from app.intelligence.agent import CourseImprovementAgent
from app.intelligence.models import ImprovementDraft


class LocalCourseImprovementAgent(CourseImprovementAgent):
    async def prepare(
        self,
        *,
        artifact_type: str,
        logical_artifact_id: UUID,
        current_state: dict[str, Any],
        evidence: dict[str, Any],
        instruction: str,
    ) -> ImprovementDraft:
        proposed = dict(current_state)
        proposal_type = f"{artifact_type}_update"
        if artifact_type == "clip":
            start = float(current_state.get("start_seconds", 0))
            end = float(current_state.get("end_seconds", start + 1))
            trim = min(3.0, max(0.0, (end - start) * 0.05))
            if end - start - (trim * 2) >= 5:
                proposed["start_seconds"] = round(start + trim, 3)
                proposed["end_seconds"] = round(end - trim, 3)
            proposal_type = "clip_recut"
        elif artifact_type == "question":
            body = str(current_state.get("body", "")).strip()
            if body and "explain your reasoning" not in body.lower():
                proposed["body"] = f"{body} Explain your reasoning."
            proposal_type = "assessment_edit"
        elif artifact_type == "routing_policy":
            policy = current_state.get("policy")
            parsed_policy = dict(policy) if isinstance(policy, dict) else {}
            parsed_policy["confidence_threshold"] = min(
                4,
                max(1, int(parsed_policy.get("confidence_threshold", 3))),
            )
            proposed["policy"] = parsed_policy
            proposal_type = "routing_policy_update"
        elif artifact_type == "topic":
            summary = str(current_state.get("summary", "")).strip()
            focus = instruction.strip() or "Reinforce the central learning objective."
            proposed["summary"] = (
                f"{summary.rstrip()}\n\nTeaching focus: {focus}"
                if summary
                else f"Teaching focus: {focus}"
            )[:4000]
            proposal_type = "topic_teaching_focus"
        elif artifact_type == "concept":
            description = str(current_state.get("description", "")).strip()
            focus = instruction.strip() or "Clarify this concept before learners advance."
            proposed["description"] = (
                f"{description.rstrip()}\n\nInstructor focus: {focus}"
                if description
                else f"Instructor focus: {focus}"
            )[:4000]
            proposal_type = "concept_clarification"
        rationale = instruction.strip() or (
            "Prepare a focused, reversible improvement from the selected course evidence."
        )
        if evidence:
            rationale = f"{rationale} Evidence snapshot: {evidence}"
        return ImprovementDraft(
            proposal_type=proposal_type,
            artifact_type=artifact_type,
            logical_artifact_id=logical_artifact_id,
            before_state=current_state,
            proposed_state=proposed,
            rationale=rationale[:4000],
        )
