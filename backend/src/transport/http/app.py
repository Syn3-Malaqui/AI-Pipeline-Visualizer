from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from src.infra.container import Container
from src.transport.http.dto import PipelineEventDto, RunRequestDto, ScenarioSummaryDto

container = Container()
app = FastAPI(title="RAG Visualizer API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/scenarios", response_model=list[ScenarioSummaryDto])
async def list_scenarios():
    scenarios = await container.list_scenarios.execute()
    return [ScenarioSummaryDto(id=s.id, name=s.name, description=s.description) for s in scenarios]


@app.post("/api/runs/stream")
async def stream_run(request: RunRequestDto):
    async def event_stream():
        try:
            async for event in container.run_rag_pipeline.stream(request.scenario_id, request.query):
                dto = PipelineEventDto(
                    version=event.version,
                    runId=event.run_id,
                    seq=event.seq,
                    tMs=event.t_ms,
                    kind=event.kind,
                    nodeId=event.node_id,
                    payload=event.payload,
                )
                yield f"data: {dto.model_dump_json()}\n\n"
        except KeyError as exc:
            yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'error': f'Unhandled error: {exc}'})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
