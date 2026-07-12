from collections import defaultdict, deque
from uuid import UUID


class GraphValidationError(ValueError):
    pass


def validate_no_cycle(edges: set[tuple[UUID, UUID]]) -> None:
    indegree: dict[UUID, int] = defaultdict(int)
    outgoing: dict[UUID, set[UUID]] = defaultdict(set)
    nodes: set[UUID] = set()

    for source, target in edges:
        if source == target:
            raise GraphValidationError("Concept edge cannot point to itself.")
        nodes.update((source, target))
        if target not in outgoing[source]:
            outgoing[source].add(target)
            indegree[target] += 1
            indegree.setdefault(source, indegree[source])

    queue = deque(node for node in nodes if indegree[node] == 0)
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for target in outgoing[node]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if visited != len(nodes):
        raise GraphValidationError("Concept graph must be acyclic.")


def edge_would_create_cycle(
    existing_edges: set[tuple[UUID, UUID]],
    candidate: tuple[UUID, UUID],
) -> bool:
    try:
        validate_no_cycle(existing_edges | {candidate})
    except GraphValidationError:
        return True
    return False
