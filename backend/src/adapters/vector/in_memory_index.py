from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

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

    def try_load_embedding_cache(
        self,
        path: Path,
        chunks: list[DocumentChunk],
        *,
        expected_model: str,
        chunk_size: int,
        chunk_overlap: int,
        documents_sha256: str,
        scenario_id: str,
    ) -> bool:
        """Load precomputed embeddings if the file matches this scenario and corpus. Returns False on any mismatch."""
        if not path.is_file():
            return False
        try:
            raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeError):
            return False
        if raw.get("version") != 1:
            return False
        if (
            raw.get("embedding_model") != expected_model
            or int(raw.get("chunk_size", -1)) != chunk_size
            or int(raw.get("chunk_overlap", -1)) != chunk_overlap
            or raw.get("documents_sha256") != documents_sha256
            or raw.get("scenario_id") != scenario_id
        ):
            return False
        entries = raw.get("entries")
        if not isinstance(entries, list) or len(entries) != len(chunks):
            return False
        rows: list[tuple[DocumentChunk, list[float]]] = []
        for chunk, entry in zip(chunks, entries, strict=True):
            if not isinstance(entry, dict):
                return False
            if entry.get("id") != chunk.id or entry.get("text") != chunk.text:
                return False
            emb = entry.get("embedding")
            if not isinstance(emb, list) or not emb or not all(isinstance(x, (int, float)) for x in emb):
                return False
            vec = [float(x) for x in emb]
            rows.append((chunk, vec))
        self._rows = rows
        return True

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
