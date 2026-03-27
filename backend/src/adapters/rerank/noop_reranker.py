from __future__ import annotations

from src.domain.models.types import RerankResult, RetrievalResult
from src.domain.ports.services import RerankerPort


class NoopReranker(RerankerPort):
    async def rerank(self, query: str, candidates: list[RetrievalResult]) -> list[RerankResult]:
        _ = query
        return [RerankResult(chunk=row.chunk, score=row.score) for row in candidates]
