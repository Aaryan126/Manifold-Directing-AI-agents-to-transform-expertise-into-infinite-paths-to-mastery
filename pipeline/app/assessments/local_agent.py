from app.assessments.agent import AssessmentAgent
from app.assessments.models import (
    AssessmentContext,
    QuestionProposal,
    QuestionType,
    RemediationProposal,
)


class LocalAssessmentAgent(AssessmentAgent):
    async def propose_question(
        self,
        context: AssessmentContext,
        previous_question: str | None = None,
    ) -> QuestionProposal:
        variant = "alternate " if previous_question else ""
        concept = context.concepts[0]
        clip = context.clips[0] if context.clips else None
        return QuestionProposal(
            body=f"Which statement best captures the {variant}role of {concept.name}?",
            type=QuestionType.MCQ,
            correct_answer={
                "answer": f"{concept.name} is a reviewed concept in {context.topic.title}.",
                "choices": [
                    f"{concept.name} is a reviewed concept in {context.topic.title}.",
                    "It is unrelated background material.",
                    "It was dismissed by the instructor.",
                    "It is only a video production artifact.",
                ],
            },
            confidence_prompt="How confident are you in your answer? (1-4)",
            remediation_rules=(
                RemediationProposal(
                    wrong_answer_pattern="confuses concept with unrelated background",
                    target_clip_id=clip.id if clip else None,
                    target_concept_id=concept.id,
                    rationale="Route to the reviewed concept explanation.",
                ),
            ),
            rationale="Local deterministic assessment generated from reviewed topic inputs.",
            confidence=0.7,
        )
