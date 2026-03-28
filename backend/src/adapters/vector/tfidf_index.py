from __future__ import annotations

import math
import re

from src.domain.models.types import DocumentChunk, RetrievalResult
from src.domain.ports.services import TfIdfIndexPort


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


class InMemoryTfIdfIndex(TfIdfIndexPort):
    """Pure-Python TF-IDF index with L2-normalised cosine similarity scoring.

    No external dependencies required — computes TF (term frequency) per chunk,
    IDF (inverse document frequency) across the corpus, and retrieves by dot
    product of L2-normalised query and document TF-IDF vectors.
    """

    def __init__(self) -> None:
        self._chunks: list[DocumentChunk] = []
        self._idf: dict[str, float] = {}
        self._doc_vecs: list[dict[str, float]] = []

    async def build(self, chunks: list[DocumentChunk]) -> None:
        self._chunks = chunks
        n = len(chunks)

        tokenized: list[list[str]] = [_tokenize(c.text) for c in chunks]

        # IDF: log((1 + N) / (1 + df)) + 1  (scikit-learn smooth variant)
        df: dict[str, int] = {}
        for tokens in tokenized:
            for term in set(tokens):
                df[term] = df.get(term, 0) + 1
        self._idf = {term: math.log((1 + n) / (1 + count)) + 1.0 for term, count in df.items()}

        self._doc_vecs = []
        for tokens in tokenized:
            raw_tf: dict[str, float] = {}
            for term in tokens:
                raw_tf[term] = raw_tf.get(term, 0.0) + 1.0
            total = len(tokens) or 1.0
            vec = {term: (count / total) * self._idf.get(term, 1.0) for term, count in raw_tf.items()}
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
            self._doc_vecs.append({term: v / norm for term, v in vec.items()})

    async def search(self, query: str, top_k: int) -> list[RetrievalResult]:
        tokens = _tokenize(query)
        if not tokens or not self._chunks:
            return []

        raw_tf: dict[str, float] = {}
        for term in tokens:
            raw_tf[term] = raw_tf.get(term, 0.0) + 1.0
        total = len(tokens)
        q_vec = {term: (count / total) * self._idf.get(term, 1.0) for term, count in raw_tf.items()}
        norm = math.sqrt(sum(v * v for v in q_vec.values())) or 1.0
        q_vec = {term: v / norm for term, v in q_vec.items()}

        scores: list[tuple[int, float]] = []
        for i, doc_vec in enumerate(self._doc_vecs):
            score = sum(q_vec.get(term, 0.0) * dv for term, dv in doc_vec.items())
            scores.append((i, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return [RetrievalResult(chunk=self._chunks[i], score=round(s, 4)) for i, s in scores[:top_k]]
