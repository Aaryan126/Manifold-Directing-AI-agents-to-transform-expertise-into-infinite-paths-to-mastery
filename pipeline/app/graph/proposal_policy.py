import math
import re
from difflib import SequenceMatcher
from uuid import UUID

from app.graph.models import (
    ConceptGraphProposal,
    ConceptProposal,
    CourseGraphContext,
    EdgeProposal,
)

MAX_CONCEPTS_PER_TOPIC = 3
MAX_PREREQUISITES_PER_CONCEPT = 2
MIN_EDGE_CONFIDENCE = 0.65
MAX_EDGES_PER_CONCEPT = 1.5


def normalize_graph_proposal(
    context: CourseGraphContext,
    proposal: ConceptGraphProposal,
) -> ConceptGraphProposal:
    topic_ids = {topic.id for topic in context.topics}
    candidates = _deduplicate_concepts(proposal.concepts, topic_ids)
    selected = _select_concepts(context, candidates)
    selected_keys = {concept.key for concept in selected}
    edges = _select_edges(proposal.edges, selected_keys, len(selected))
    return ConceptGraphProposal(concepts=tuple(selected), edges=tuple(edges))


def concept_names_match(first: str, second: str) -> bool:
    first_normalized = _normalized_name(first)
    second_normalized = _normalized_name(second)
    if not first_normalized or not second_normalized:
        return False
    return (
        first_normalized == second_normalized
        or SequenceMatcher(
            None,
            first_normalized,
            second_normalized,
        ).ratio()
        >= 0.9
    )


def _deduplicate_concepts(
    concepts: tuple[ConceptProposal, ...],
    valid_topic_ids: set[UUID],
) -> list[ConceptProposal]:
    best_by_name: dict[str, ConceptProposal] = {}
    seen_keys: set[str] = set()
    for concept in sorted(concepts, key=lambda item: item.confidence, reverse=True):
        topic_ids = tuple(
            dict.fromkeys(topic_id for topic_id in concept.topic_ids if topic_id in valid_topic_ids)
        )
        normalized_name = _normalized_name(concept.name)
        if (
            not concept.key.strip()
            or concept.key in seen_keys
            or not normalized_name
            or not topic_ids
        ):
            continue
        if any(
            concept_names_match(concept.name, existing.name) for existing in best_by_name.values()
        ):
            continue
        seen_keys.add(concept.key)
        best_by_name[normalized_name] = ConceptProposal(
            key=concept.key,
            name=concept.name.strip(),
            description=concept.description.strip(),
            topic_ids=topic_ids,
            evidence=concept.evidence.strip(),
            confidence=concept.confidence,
        )
    return list(best_by_name.values())


def _select_concepts(
    context: CourseGraphContext,
    candidates: list[ConceptProposal],
) -> list[ConceptProposal]:
    selected: list[ConceptProposal] = []
    selected_keys: set[str] = set()
    counts = {topic.id: 0 for topic in context.topics}

    def can_add(concept: ConceptProposal) -> bool:
        return all(counts[topic_id] < MAX_CONCEPTS_PER_TOPIC for topic_id in concept.topic_ids)

    def add(concept: ConceptProposal) -> None:
        if concept.key in selected_keys:
            return
        selected.append(concept)
        selected_keys.add(concept.key)
        for topic_id in concept.topic_ids:
            counts[topic_id] += 1

    ranked = sorted(candidates, key=lambda item: item.confidence, reverse=True)
    for topic in context.topics:
        if counts[topic.id] > 0:
            continue
        candidate = next(
            (concept for concept in ranked if topic.id in concept.topic_ids and can_add(concept)),
            None,
        )
        if candidate is None:
            raise ValueError(f'Graph proposal has no usable concept for topic "{topic.title}".')
        add(candidate)

    for concept in ranked:
        if concept.key not in selected_keys and can_add(concept):
            add(concept)
    return selected


def _select_edges(
    edges: tuple[EdgeProposal, ...],
    selected_keys: set[str],
    concept_count: int,
) -> list[EdgeProposal]:
    selected: list[EdgeProposal] = []
    pairs: set[tuple[str, str]] = set()
    incoming: dict[str, int] = {}
    max_edges = math.ceil(concept_count * MAX_EDGES_PER_CONCEPT)
    for edge in sorted(edges, key=lambda item: item.confidence, reverse=True):
        pair = (edge.from_key, edge.to_key)
        if (
            len(selected) >= max_edges
            or edge.confidence < MIN_EDGE_CONFIDENCE
            or edge.from_key not in selected_keys
            or edge.to_key not in selected_keys
            or edge.from_key == edge.to_key
            or pair in pairs
            or incoming.get(edge.to_key, 0) >= MAX_PREREQUISITES_PER_CONCEPT
            or _would_create_cycle(pairs, pair)
        ):
            continue
        selected.append(edge)
        pairs.add(pair)
        incoming[edge.to_key] = incoming.get(edge.to_key, 0) + 1
    return selected


def _would_create_cycle(
    pairs: set[tuple[str, str]],
    candidate: tuple[str, str],
) -> bool:
    source, target = candidate
    adjacency: dict[str, set[str]] = {}
    for from_key, to_key in pairs | {candidate}:
        adjacency.setdefault(from_key, set()).add(to_key)
    pending = [target]
    visited: set[str] = set()
    while pending:
        current = pending.pop()
        if current == source:
            return True
        if current in visited:
            continue
        visited.add(current)
        pending.extend(adjacency.get(current, ()))
    return False


def _normalized_name(value: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", value.lower())
    singularized = [
        token[:-1] if len(token) > 4 and token.endswith("s") else token for token in tokens
    ]
    return " ".join(singularized)
