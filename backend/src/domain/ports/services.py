from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from src.domain.models.types import DocumentChunk, RetrievalResult, RerankResult, Scenario


class EmbeddingModelPort(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


class ChatModelPort(Protocol):
    async def stream_generate(self, prompt: str, *, model: str | None = None) -> AsyncIterator[str]: ...


class VectorIndexPort(Protocol):
    async def build(self, chunks: list[DocumentChunk]) -> None: ...
    async def search(self, query_vector: list[float], top_k: int) -> list[RetrievalResult]: ...


class TfIdfIndexPort(Protocol):
    async def build(self, chunks: list[DocumentChunk]) -> None: ...
    async def search(self, query: str, top_k: int) -> list[RetrievalResult]: ...


class RerankerPort(Protocol):
    async def rerank(self, query: str, candidates: list[RetrievalResult]) -> list[RerankResult]: ...


class ScenarioRepositoryPort(Protocol):
    async def list_scenarios(self) -> list[Scenario]: ...
    async def get_scenario(self, scenario_id: str) -> Scenario: ...
