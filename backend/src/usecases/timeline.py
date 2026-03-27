from __future__ import annotations

from src.domain.models.types import PipelineEvent


class BuildRunTimeline:
    def execute(self, events: list[PipelineEvent]) -> list[dict[str, object]]:
        timeline: list[dict[str, object]] = []
        step = 0
        for event in events:
            significant = event.kind in {"node_started", "node_completed", "run_completed"}
            if significant:
                step += 1
            timeline.append(
                {
                    "step": step,
                    "kind": event.kind,
                    "nodeId": event.node_id,
                    "seq": event.seq,
                    "tMs": event.t_ms,
                }
            )
        return timeline
