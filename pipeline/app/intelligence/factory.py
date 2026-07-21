from app.config import Settings
from app.intelligence.agent import CourseImprovementAgent
from app.intelligence.extractor import (
    DocumentExtractor,
    LocalOcrVisualAnalyzer,
    OpenAIVisualAnalyzer,
)
from app.intelligence.local_agent import LocalCourseImprovementAgent
from app.intelligence.openai_agent import OpenAICourseImprovementAgent


def build_improvement_agent(settings: Settings) -> CourseImprovementAgent:
    if settings.openai_api_key:
        return OpenAICourseImprovementAgent(settings.openai_api_key, settings.llm_model)
    return LocalCourseImprovementAgent()


def build_document_extractor(settings: Settings) -> DocumentExtractor:
    analyzer = (
        OpenAIVisualAnalyzer(settings.openai_api_key, settings.llm_model)
        if settings.openai_api_key
        else LocalOcrVisualAnalyzer()
    )
    return DocumentExtractor(analyzer, max_pages=settings.document_max_pages)
