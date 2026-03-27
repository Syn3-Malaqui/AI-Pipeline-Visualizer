from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

NodeKind = Literal["ingest", "preprocess", "embed", "retrieve", "rerank", "generate"]
EventKind = Literal[
    "run_started",
    "node_started",
    "node_output",
    "token",
    "node_completed",
    "run_completed",
    "error",
]


@dataclass(frozen=True)
class DocumentChunk:
    id: str
    source: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RetrievalResult:
    chunk: DocumentChunk
    score: float


@dataclass(frozen=True)
class RerankResult:
    chunk: DocumentChunk
    score: float


@dataclass(frozen=True)
class PipelineNode:
    id: str
    label: str
    kind: NodeKind
    enabled: bool = True
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PipelineEdge:
    source: str
    target: str


@dataclass(frozen=True)
class PipelineSpec:
    nodes: list[PipelineNode]
    edges: list[PipelineEdge]


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    description: str
    pipeline: PipelineSpec
    documents: list[str]
    config: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PipelineEvent:
    version: str
    run_id: str
    seq: int
    t_ms: int
    kind: EventKind
    node_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
