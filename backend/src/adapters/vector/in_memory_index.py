from __future__ import annotations

import math

from src.domain.models.types import DocumentChunk, RetrievalResult
from src.domain.ports.services import EmbeddingModelPort, VectorIndexPort


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


class InMemoryVectorIndex(VectorIndexPort):
    def __init__(self, embeddings: EmbeddingModelPort) -> None:
        self._embeddings = embeddings
        self._rows: list[tuple[DocumentChunk, list[float]]] = []

    async def build(self, chunks: list[DocumentChunk]) -> None:
        vectors = await self._embeddings.embed([chunk.text for chunk in chunks])
        self._rows = list(zip(chunks, vectors))

    async def search(self, query_vector: list[float], top_k: int) -> list[RetrievalResult]:
        ranked = sorted(
            (RetrievalResult(chunk=chunk, score=_cosine(query_vector, vector)) for chunk, vector in self._rows),
            key=lambda row: row.score,
            reverse=True,
        )
        return ranked[:top_k]
