from __future__ import annotations

import math
import re
import time
import uuid
from collections.abc import AsyncIterator

from src.domain.models.types import DocumentChunk, PipelineEvent, RetrievalResult, RerankResult, Scenario
from src.domain.ports.services import (
    ChatModelPort,
    EmbeddingModelPort,
    RerankerPort,
    ScenarioRepositoryPort,
    VectorIndexPort,
)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


def _chunk_text(text: str, size: int, overlap: int) -> list[str]:
    if size <= 0:
        return [text]
    out: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        out.append(text[start:end])
        if end == len(text):
            break
        start = max(end - overlap, start + 1)
    return out


def _guidance(node_id: str) -> str:
    explanations = {
        "ingest": "We capture your question and create a new run context.",
        "preprocess": "We clean and normalize your query to improve retrieval quality.",
        "embed": "We convert text into vectors so semantic similarity can be measured.",
        "retrieve": "We fetch the most semantically relevant document chunks.",
        "rerank": "We reorder retrieved chunks to prioritize the strongest evidence.",
        "generate": "We synthesize the final answer grounded in retrieved context.",
    }
    return explanations.get(node_id, "This node transforms data for the next stage.")


class RunRagPipeline:
    def __init__(
        self,
        scenarios: ScenarioRepositoryPort,
        embeddings: EmbeddingModelPort,
        chat: ChatModelPort,
        vector_index: VectorIndexPort,
        reranker: RerankerPort,
    ) -> None:
        self._scenarios = scenarios
        self._embeddings = embeddings
        self._chat = chat
        self._vector_index = vector_index
        self._reranker = reranker

    async def stream(self, scenario_id: str, query: str) -> AsyncIterator[PipelineEvent]:
        scenario = await self._scenarios.get_scenario(scenario_id)
        run_id = str(uuid.uuid4())
        seq = 0
        started = time.perf_counter()
        query_vector: list[float] = []
        retrieval_results: list[RetrievalResult] = []
        final_answer = ""
        has_retrieve_enabled = any(n.kind == "retrieve" and n.enabled for n in scenario.pipeline.nodes)

        def event(kind: str, node_id: str | None = None, payload: dict | None = None):
            nonlocal seq
            seq += 1
            return PipelineEvent(
                version="1.0",
                run_id=run_id,
                seq=seq,
                t_ms=int((time.perf_counter() - started) * 1000),
                kind=kind,  # type: ignore[arg-type]
                node_id=node_id,
                payload=payload or {},
            )

        yield event("run_started", payload={"scenarioId": scenario.id, "query": query})

        processed_query = query.strip()
        for node in scenario.pipeline.nodes:
            if not node.enabled:
                continue
            yield event("node_started", node.id, {"label": node.label, "guidance": _guidance(node.id)})

            if node.kind == "ingest":
                yield event("node_output", node.id, {"query": processed_query})

            elif node.kind == "preprocess":
                processed_query = re.sub(r"\s+", " ", processed_query).strip()
                yield event("node_output", node.id, {"processedQuery": processed_query})

            elif node.kind == "embed":
                vectors = await self._embeddings.embed([processed_query])
                yield event("node_output", node.id, {"dimension": len(vectors[0]) if vectors else 0})
                query_vector = vectors[0] if vectors else []

            elif node.kind == "retrieve":
                chunks = await self._load_chunks(scenario)
                await self._vector_index.build(chunks)
                candidates = await self._vector_index.search(query_vector, int(node.config.get("top_k", 3)))
                yield event(
                    "node_output",
                    node.id,
                    {
                        "retrieved": [
                            {
                                "chunkId": r.chunk.id,
                                "text": r.chunk.text,
                                "score": round(r.score, 4),
                                "source": r.chunk.source,
                            }
                            for r in candidates
                        ]
                    },
                )
                retrieval_results = candidates

            elif node.kind == "rerank":
                retrieval_results = await self._maybe_rerank(scenario, processed_query, retrieval_results)
                yield event(
                    "node_output",
                    node.id,
                    {"reranked": [{"chunkId": r.chunk.id, "score": round(r.score, 4)} for r in retrieval_results]},
                )

            elif node.kind == "generate":
                system_prompt = str(scenario.config.get("system_prompt", "")).strip()
                if has_retrieve_enabled:
                    context = "\n\n".join(f"[{i+1}] {r.chunk.text}" for i, r in enumerate(retrieval_results))
                    prompt = (
                        "Answer the user query using the context. "
                        "If context is insufficient, say what is missing.\n\n"
                        f"Query:\n{processed_query}\n\nContext:\n{context}\n\nAnswer:"
                    )
                else:
                    prompt = processed_query if not system_prompt else f"{system_prompt}\n\nUser:\n{processed_query}\n\nAssistant:"

                yield event(
                    "node_output",
                    node.id,
                    {
                        "prompt": prompt,
                        "confidence": self._confidence(retrieval_results) if has_retrieve_enabled else 1.0,
                    },
                )

                final_answer = ""
                async for token in self._chat.stream_generate(prompt):
                    final_answer += token
                    yield event("token", node.id, {"token": token})
                yield event("node_output", node.id, {"finalAnswer": final_answer})

            yield event("node_completed", node.id, {"guidance": _guidance(node.id)})

        yield event("run_completed", payload={"answer": final_answer})

    async def _load_chunks(self, scenario: Scenario) -> list[DocumentChunk]:
        chunk_size = int(scenario.config.get("chunk_size", 500))
        chunk_overlap = int(scenario.config.get("chunk_overlap", 50))
        chunks: list[DocumentChunk] = []
        idx = 0
        for doc in scenario.documents:
            text = doc
            for chunk in _chunk_text(text, chunk_size, chunk_overlap):
                chunks.append(DocumentChunk(id=f"chunk-{idx}", source="scenario", text=chunk))
                idx += 1
        return chunks

    async def _maybe_rerank(
        self, scenario: Scenario, query: str, retrieval_results: list[RetrievalResult]
    ) -> list[RetrievalResult]:
        rerank_node = next((n for n in scenario.pipeline.nodes if n.kind == "rerank"), None)
        if not rerank_node or not rerank_node.enabled:
            return retrieval_results
        reranked: list[RerankResult] = await self._reranker.rerank(query, retrieval_results)
        return [RetrievalResult(chunk=r.chunk, score=r.score) for r in reranked]

    def _confidence(self, retrieval_results: list[RetrievalResult]) -> float:
        if not retrieval_results:
            return 0.0
        return round(sum(r.score for r in retrieval_results) / len(retrieval_results), 4)
