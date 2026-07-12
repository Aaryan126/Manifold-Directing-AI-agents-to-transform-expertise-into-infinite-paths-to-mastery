from app.assessments.agent import AssessmentAgent
from app.assessments.local_agent import LocalAssessmentAgent
from app.assessments.openai_agent import OpenAIAssessmentAgent
from app.config import Settings


def build_assessment_agent(settings: Settings) -> AssessmentAgent:
    if settings.assessment_agent_provider == "local" or not settings.openai_api_key:
        return LocalAssessmentAgent()
    if settings.assessment_agent_provider == "openai":
        return OpenAIAssessmentAgent(settings.openai_api_key, settings.llm_model)
    raise ValueError(f"Unsupported assessment agent provider: {settings.assessment_agent_provider}")
