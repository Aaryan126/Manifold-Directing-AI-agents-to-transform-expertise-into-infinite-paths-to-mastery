from app.clips.agent import ClipExtractionAgent
from app.clips.models import ClipContext, ClipProposal, ClipType


class LocalClipExtractionAgent(ClipExtractionAgent):
    async def propose_clips(
        self,
        context: ClipContext,
        instructor_notes: str | None = None,
    ) -> tuple[ClipProposal, ...]:
        del instructor_notes
        if not context.concepts:
            return ()
        duration = context.topic.end_seconds - context.topic.start_seconds
        target_count = max(1, min(4, round(duration / 240)))
        segment = duration / target_count
        proposals: list[ClipProposal] = []
        for index in range(target_count):
            start = context.topic.start_seconds + index * segment
            end = context.topic.end_seconds if index == target_count - 1 else start + segment
            concept = context.concepts[index % len(context.concepts)]
            proposals.append(
                ClipProposal(
                    title=f"{context.topic.title} clip {index + 1}",
                    start_seconds=start,
                    end_seconds=end,
                    type=ClipType.EXPLANATION if index else ClipType.DEFINITION,
                    difficulty="introductory" if index == 0 else "standard",
                    concept_ids=(concept.id,),
                    rationale="Local deterministic extraction from reviewed topic range.",
                    confidence=0.7,
                )
            )
        return tuple(proposals)
