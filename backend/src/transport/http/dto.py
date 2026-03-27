from __future__ import annotations

from pydantic import BaseModel, Field


class ScenarioSummaryDto(BaseModel):
    id: str
    name: str
    description: str


class RunRequestDto(BaseModel):
    scenario_id: str = Field(alias="scenarioId")
    query: str


class PipelineEventDto(BaseModel):
    version: str
    runId: str
    seq: int
    tMs: int
    kind: str
    nodeId: str | None = None
    payload: dict
