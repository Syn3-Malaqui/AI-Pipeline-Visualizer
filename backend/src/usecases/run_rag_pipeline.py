from __future__ import annotations

import math
import re
import time
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from src.domain.chunking import chunks_from_scenario, documents_fingerprint
from src.domain.models.types import DocumentChunk, PipelineEvent, RetrievalResult, RerankResult, Scenario
from src.domain.ports.services import (
    ChatModelPort,
    EmbeddingModelPort,
    RerankerPort,
    ScenarioRepositoryPort,
    TfIdfIndexPort,
    VectorIndexPort,
)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


# First matching rule wins (put specific phrases before generic ones).
_CATALOG_CLASS_QUERY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("beta_blocker", re.compile(r"\b(?:beta[- ]?blockers?|β[- ]?blockers?)\b", re.I)),
    ("ace_inhibitor", re.compile(r"\b(?:ace[- ]?inhibitors?)\b", re.I)),
    ("arb", re.compile(r"\b(?:angiotensin\s+(?:ii\s+)?receptor\s+blockers?|arbs?)\b", re.I)),
    ("nsaid", re.compile(r"\b(?:nsaids?|non[- ]?steroidal\s+anti[- ]?inflammatorys?)\b", re.I)),
    ("statin", re.compile(r"\b(?:statins?|hmg[- ]?coa)\b", re.I)),
    ("benzodiazepine", re.compile(r"\b(?:benzodiazepines?|benzos?)\b", re.I)),
    ("ssri", re.compile(r"\b(?:ssris?|selective\s+serotonin\s+reuptake)\b", re.I)),
    ("snri", re.compile(r"\b(?:snris?|serotonin[- ]?norepinephrine\s+reuptake)\b", re.I)),
    ("opioid", re.compile(r"\b(?:opioids?|opiates?)\b", re.I)),
    (
        "antihistamine",
        re.compile(
            r"\b(?:anti[- ]?histamines?|antihistamines?|h1[- ]?antihistamines?|h2[- ]?antihistamines?)\b",
            re.I,
        ),
    ),
]

# Match only the catalog **Drug class** line — not mechanism/sample questions (avoids “beta” noise on benzos).
_CATALOG_CLASS_LINE_PATTERNS: dict[str, re.Pattern[str]] = {
    "beta_blocker": re.compile(r"\b(?:beta[- ]?blocker|β[- ]?blocker)\b", re.I),
    "ace_inhibitor": re.compile(r"\bace\s+inhibitor\b", re.I),
    "arb": re.compile(r"\b(?:angiotensin\s+ii\s+receptor\s+blocker|\barb\b)", re.I),
    "nsaid": re.compile(r"\bnsaid\b|non[- ]?steroidal", re.I),
    "statin": re.compile(r"\bstatin\b|hmg[- ]?coa", re.I),
    "benzodiazepine": re.compile(r"benzodiazepine", re.I),
    "ssri": re.compile(r"\bssri\b", re.I),
    "snri": re.compile(r"\bsnri\b", re.I),
    "opioid": re.compile(r"\bopioid\b", re.I),
    # Corpus uses "H1-antihistamine, …"; match **Drug class** line only (not "histamine" in mechanisms).
    "antihistamine": re.compile(
        r"\b(?:h1[- ]?antihistamine|h2[- ]?antihistamine|antihistamine)\b",
        re.I,
    ),
}

_DRUG_CLASS_LINE_RE = re.compile(r"(?m)^\s*-\s*\*\*Drug class[^:]*:\*\*\s*(.+)$")
_MED_SECTION_HEAD_RE = re.compile(r"(?m)^##\s+([^(]+)\(\s*`(med-\d+)`\s*\)\s*$")


def _drug_class_value_from_chunk(chunk_text: str) -> str:
    m = _DRUG_CLASS_LINE_RE.search(chunk_text)
    if m:
        return m.group(1).strip()
    m2 = re.search(r"(?mi)^\s*\*\*Drug class[^:]*:\*\*\s*(.+)$", chunk_text)
    return m2.group(1).strip() if m2 else ""


def _iter_med_section_drug_classes(chunk_text: str):
    """Each `## Name (`med-NNN`)` block may have its own **Drug class** line (chunks often span multiple drugs)."""
    for m in _MED_SECTION_HEAD_RE.finditer(chunk_text):
        start = m.end()
        nxt = re.search(r"(?m)^##\s+", chunk_text[start:])
        end = start + nxt.start() if nxt else len(chunk_text)
        section = chunk_text[start:end]
        mid = m.group(2).lower()
        dcm = _DRUG_CLASS_LINE_RE.search(section)
        if dcm:
            yield mid, dcm.group(1).strip()


def _detect_catalog_class_query(query: str) -> str | None:
    q = (query or "").strip()
    if not q:
        return None
    for key, pat in _CATALOG_CLASS_QUERY_RULES:
        if pat.search(q):
            return key
    return None


def _chunk_drug_class_matches_key(chunk_text: str, class_key: str) -> bool:
    pat = _CATALOG_CLASS_LINE_PATTERNS.get(class_key)
    if not pat:
        return False
    sections = list(_iter_med_section_drug_classes(chunk_text))
    if sections:
        return any(pat.search(dclass) for _, dclass in sections)
    line = _drug_class_value_from_chunk(chunk_text)
    return bool(line and pat.search(line))


def _narrow_candidates_by_catalog_drug_class(
    query: str, candidates: list[RetrievalResult]
) -> list[RetrievalResult]:
    """When the query names a therapeutic class, keep only chunks whose **Drug class** line matches.

    Uses the structured Drug class field only so unrelated hits (e.g. benzodiazepines that mention
    “beta” in sample questions) are dropped before/after the LLM filter.
    """
    key = _detect_catalog_class_query(query)
    if not key:
        return candidates
    matched = [r for r in candidates if _chunk_drug_class_matches_key(r.chunk.text, key)]
    return matched if matched else candidates


_HH_STOPWORDS = frozenset(
    {
        "compare",
        "comparing",
        "versus",
        "and",
        "or",
        "the",
        "all",
        "each",
        "both",
        "between",
        "with",
        "for",
        "in",
        "to",
        "of",
        "on",
        "at",
        "is",
        "are",
        "was",
        "what",
        "which",
        "how",
        "when",
        "why",
    }
)

_CHUNK_HEADING_RE = re.compile(r"^##\s+([^(]+)\s*\(\s*`(med-\d+)`\s*\)", re.MULTILINE)


def _chunk_heading_title_and_med_id(chunk_text: str) -> tuple[str, str | None]:
    m = _CHUNK_HEADING_RE.search(chunk_text)
    if not m:
        return "", None
    return m.group(1).strip(), m.group(2).lower()


def _head_to_head_comparison_tokens(query: str) -> list[str] | None:
    """If the query pits specific drugs (e.g. 'A vs B' or 'A vs B vs C vs D'), return names or med ids.

    Returns None when this is not a head-to-head drug comparison (class-wide compares use other paths).
    """
    q = (query or "").strip()
    if not q:
        return None
    has_vs = bool(re.search(r"\bvs\.?\b|\bversus\b", q, re.I))

    if has_vs:
        ids = list(dict.fromkeys(re.findall(r"\b(med-\d+)\b", q, re.I)))
        if len(ids) >= 2:
            return [x.lower() for x in ids]

    if has_vs:
        parts = re.split(r"\s+vs\.?\s+|\s+versus\s+", q, flags=re.I)
        names: list[str] = []
        for i, part in enumerate(parts):
            part = part.strip()
            if not part:
                continue
            if i == 0:
                part = re.sub(r"^(compare|comparing)\s+", "", part, flags=re.I).strip()
            found = re.findall(r"\b([A-Za-z][A-Za-z0-9\-]{2,})\b", part)
            if not found:
                continue
            name = found[-1]
            if name.lower() not in _HH_STOPWORDS:
                names.append(name)
        if len(names) >= 2:
            out: list[str] = []
            seen: set[str] = set()
            for n in names:
                k = n.casefold()
                if k not in seen:
                    seen.add(k)
                    out.append(n)
            return out

    m = re.search(
        r"\bcompare\s+([A-Za-z][A-Za-z0-9\-]{2,})\s+and\s+([A-Za-z][A-Za-z0-9\-]{2,})\b",
        q,
        re.I,
    )
    if m:
        a, b = m.group(1), m.group(2)
        if (
            a.lower() not in _HH_STOPWORDS
            and b.lower() not in _HH_STOPWORDS
            and len(a) >= 4
            and len(b) >= 4
        ):
            return [a, b]
    return None


def _chunk_matches_head_to_head_tokens(chunk_text: str, tokens: list[str]) -> bool:
    """True if any catalog section in the chunk matches one of the requested names or med ids."""
    token_ids = {t.lower() for t in tokens if re.fullmatch(r"med-\d+", t.strip(), re.I)}
    token_names = {t.strip().casefold() for t in tokens if not re.fullmatch(r"med-\d+", t.strip(), re.I)}
    for m in _MED_SECTION_HEAD_RE.finditer(chunk_text):
        mid = m.group(2).lower()
        title = m.group(1).strip()
        if mid in token_ids:
            return True
        if title.casefold() in token_names:
            return True
    title, med_id = _chunk_heading_title_and_med_id(chunk_text)
    if med_id and med_id in token_ids:
        return True
    if title and title.casefold() in token_names:
        return True
    return False


def _narrow_candidates_by_head_to_head(
    query: str, candidates: list[RetrievalResult]
) -> list[RetrievalResult] | None:
    """Keep only chunks for the named drugs in a vs-chain. Returns None if the query is not head-to-head."""
    tokens = _head_to_head_comparison_tokens(query)
    if not tokens or len(tokens) < 2:
        return None
    matched = [r for r in candidates if _chunk_matches_head_to_head_tokens(r.chunk.text, tokens)]
    return matched


def _guidance(node_id: str) -> str:
    explanations = {
        "ingest": "We capture your question and create a new run context.",
        "preprocess": "We clean and normalize your query to improve retrieval quality.",
        "embed": "We convert text into vectors so semantic similarity can be measured.",
        "retrieve": "We fetch the most semantically relevant document chunks using embedding cosine similarity.",
        "tfidf_retrieve": "We fetch relevant document chunks using TF-IDF term-frequency scoring — no embeddings needed.",
        "rerank": "We reorder retrieved chunks to prioritize the strongest evidence.",
        "filter": "We discard chunks that don't match the query topic before the response generator runs.",
        "generate": "We synthesize the final answer grounded in retrieved context.",
        "diagnose": "We generate a formal answer from retrieved chunks: comparison table, single-drug details, or a numbered list.",
        "standardize": "We wrap the tightened draft with a fixed greeting and a closing that includes "
        "‘have a great day’ (deterministic template, no extra model call).",
    }
    return explanations.get(node_id, "This node transforms data for the next stage.")


# Model-only: grounded on reference text; avoid meta “demo / simulation” monologues in user-facing text.
_MEDICINE_STYLE_INTERNAL = (
    "Internal rules: Use ONLY the provided reference text (fictional catalog entries for a UI demo). "
    "Somewhat formal, professional tone. Do not mention demos, simulations, synthetic data, algorithms, or "
    "training tools. No reality-check sections or long disclaimer lectures.\n"
    "When listing two or more medications or distinct drug profiles from the context, use a numbered list "
    "(1. item 2. item 3. item), not bullet points—EXCEPT for comparison-style questions (see below).\n"
    "Comparison queries: If the user compares, contrasts, or pits medications against each other—including "
    "class-wide asks such as 'compare all NSAIDs' or 'all pain medications'—do NOT use a numbered list. "
    "Output exactly one GitHub-flavored Markdown table: header row, then a separator row of dashes (|---|---|), "
    "then one row per medication from the context that answers the query. "
    "Use columns such as: Medication (cell must contain **DrugName** and the exact `med-NNN` id copied from that drug's "
    "reference line, e.g. `med-017`), Drug class, Indications, Mechanism, Cautions—only facts from the reference text; "
    "keep cells concise.\n"
    "The context is markdown catalog source. NEVER copy these into your answer: the heading or label "
    "'Sample user questions' (or similar), any example question lists beneath it, repeated 'Sample user "
    "questions:' blocks, raw 'Symptoms / use cases' section headers as filler, or other file template "
    "scaffolding. Those exist for search indexing only. Summarize only useful facts: drug names, class, "
    "role, mechanism, cautions—never dump the example Q&A lists.\n"
    "Topic discipline: Match what the user asked for. If they specify a therapeutic angle (e.g. pain killers, "
    "analgesics, NSAIDs, allergy), include ONLY entries from the context whose class, indications, or "
    "symptom keywords fit that topic. Omit unrelated drugs that merely appeared in the same chunks (e.g. do "
    "not list ARBs, statins, or antihypertensives when the user only asked for pain medications).\n"
    "Count discipline: If the user gives a number (two, 2, three, 3, a couple, a few with a clear cap), output "
    "exactly that many matching items when the context supports it—never more. If fewer matches exist, give "
    "only those and briefly note the shortfall; do not pad with off-topic drugs.\n"
    "Formatting: Always respond in Markdown. Every medication entry MUST include the real catalog id from the context: "
    "**DrugName** (`med-NNN`) where NNN are the actual digits shown for that drug in the reference (never output the "
    "literal letters XXX or a made-up id). "
    "You may ONLY cite `med-NNN` ids that appear in the context blocks for this request—never invent an id or pull in a "
    "drug from memory that is not in that context. "
    "The drug name must always be **bold**, and the med ID must always be `backtick-quoted` exactly as in the chunk. "
    "Use a numbered list when two or more medications are listed (unless the user asked for a comparison table). "
    "Never omit the med ID. Never return a wall of plain text.\n"
    "Single-medication detail queries (what is X, describe X, tell me about X): give one focused answer for that "
    "drug—copy **DrugName** and (`med-NNN`) from the matching catalog section, then state class, indications, mechanism, "
    "and cautions using the same facts as in the context—not a multi-item numbered list and not a comparison table "
    "unless the user asked to compare.\n\n"
)

_MEDICINE_STANDARD_GREETING = "Hello,"
_MEDICINE_STANDARD_CLOSING = "Thank you for your inquiry, and have a great day."


def _diagnose_response_mode(query: str) -> str:
    """Return payload value for formal-response formatting: table, details, or numbered list."""
    if _is_comparison_query(query):
        return "comparison_table"
    if _is_detail_query(query):
        return "details"
    return "numbered_list"


def _is_detail_query(query: str) -> bool:
    """True when the user asks about one medication's profile (name, mechanism, etc.), not a list or table."""
    raw = (query or "").strip()
    if not raw:
        return False
    low = raw.lower()
    # Multi-drug / catalog asks: prefer numbered list
    if re.search(r"\b(list|enumerate|name all|name every)\b", low):
        return False
    if re.search(r"\bwhat are\b", low) and re.search(
        r"\b(nsaids?|opioids?|ssris?|snris?|arbs?|ace\s*inhibitors?|statins?|beta[- ]?blockers?|benzodiazepines?)\b",
        low,
        re.I,
    ):
        return False
    if re.search(r"\b(all|every|each)\s+(the\s+)?(nsaids?|opioids?|medications?|drugs?)\b", low):
        return False
    if re.search(r"\bwhat\s+is\s+the\s+difference\b", low):
        return False
    triggers = (
        r"\bwhat\s+is\s+",
        r"\bwhat's\s+",
        r"\bwhat\s+was\s+",
        r"\btell me about\s+",
        r"\bdescribe\s+",
        r"\bexplain\s+",
        r"\bdetails?\s+(on|about|for)\s+",
        r"\binformation\s+about\s+",
        r"\bwho\s+is\s+",
    )
    return any(re.search(p, raw, re.I) for p in triggers)


def _is_comparison_query(query: str) -> bool:
    """True when the user wants a side-by-side / tabular answer, not a numbered list."""
    raw = (query or "").strip()
    if not raw:
        return False
    if re.search(r"\b(what|which)\s+is\s+better\b", raw, re.I):
        return True
    q = f" {raw.lower().replace(chr(10), ' ')} "
    needles = (
        " vs ",
        " versus ",
        " v.s. ",
        " compare ",
        " comparison ",
        "difference between",
        " contrast ",
        "which one ",
        "which is better",
        " or better ",
        " side by side ",
        " in a table",
        " as a table",
        "tabular",
    )
    if any(n in q for n in needles):
        return True
    if re.search(r"\b(compare|comparing|compared)\b", raw, re.I):
        return True
    # Class-wide compare: "compare all NSAIDs", "comparison of all pain medications", etc.
    if re.search(r"\ball\b", raw, re.I) and re.search(
        r"\b(compare|comparing|compared|comparison|contrast|versus|vs\.?|table|tabular|side\s+by\s+side)\b",
        raw,
        re.I,
    ):
        if re.search(
            r"\b(medications?|drugs?|nsaids?|analgesics?|opioids?|agents?|options?)\b",
            raw,
            re.I,
        ):
            return True
    return False


def _strip_leading_greeting_lines(text: str) -> str:
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if s == "":
            i += 1
            continue
        low = s.lower().rstrip(",.")
        if low == "hello" or low.startswith("hello,") or low == "good day" or low.startswith("good day,"):
            i += 1
            continue
        break
    return "\n".join(lines[i:]).strip()


def _strip_trailing_closing_paragraph(text: str) -> str:
    t = text.rstrip()
    lower = t.lower()
    if "have a great day" not in lower:
        return t
    last_nn = t.rfind("\n\n")
    if last_nn < 0:
        return "" if "have a great day" in lower else t
    tail = t[last_nn + 2 :]
    if "have a great day" in tail.lower():
        return t[:last_nn].rstrip()
    return t


def _med_ids_from_retrieval(retrieval_results: list[RetrievalResult]) -> set[str]:
    """Catalog ids present in retrieved chunk text (only these may be cited after filtering)."""
    found: set[str] = set()
    for r in retrieval_results:
        for m in re.findall(r"`(med-\d+)`", r.chunk.text):
            found.add(m)
        for m in re.findall(r"\b(med-\d+)\b", r.chunk.text, re.I):
            found.add(m)
    return found


def _med_ids_from_retrieval_for_class(
    retrieval_results: list[RetrievalResult], class_key: str | None
) -> set[str]:
    """Med ids whose **Drug class** line in that `##` section matches the query's catalog class.

    Avoids mixed chunks (e.g. SSRI + NSAID in one blob) polluting the allowlist with unrelated ids.
    """
    if not class_key:
        return _med_ids_from_retrieval(retrieval_results)
    pat = _CATALOG_CLASS_LINE_PATTERNS.get(class_key)
    if not pat:
        return _med_ids_from_retrieval(retrieval_results)
    found: set[str] = set()
    for r in retrieval_results:
        for mid, dclass in _iter_med_section_drug_classes(r.chunk.text):
            if pat.search(dclass):
                found.add(mid)
    return found if found else _med_ids_from_retrieval(retrieval_results)


def _query_asks_list_all(query: str) -> bool:
    q = (query or "").strip().lower()
    if re.search(r"\b(list|enumerate|name|give|show)\s+(\w+\s+){0,4}\b(all|every|each)\b", q):
        return True
    if re.search(r"\bwhat\s+are\s+(\w+\s+){0,3}\b(all|every)\b", q):
        return True
    return False


def _med_ids_in_text(text: str) -> set[str]:
    return set(re.findall(r"\b(med-\d+)\b", text, re.I))


def _example_only_uses_allowed_med_ids(example: str, allowed: set[str]) -> bool:
    if not example.strip():
        return True
    if not allowed:
        return False
    allow = {x.lower() for x in allowed}
    return all(m.lower() in allow for m in _med_ids_in_text(example))


def _sanitize_answer_to_allowed_med_ids(text: str, allowed: set[str]) -> str:
    """Drop lines that cite a med id not present in the relevance-filtered context."""
    if not text or not allowed:
        return text
    allow = {x.lower() for x in allowed}
    out_lines: list[str] = []
    for line in text.splitlines():
        ids = _med_ids_in_text(line)
        if ids and not all(i.lower() in allow for i in ids):
            continue
        out_lines.append(line)
    return "\n".join(out_lines).strip()


def _repair_med_id_placeholder(answer: str, retrieval_results: list[RetrievalResult]) -> str:
    """If the model echoed the template literal med-XXX, substitute the real `med-NNN` from retrieved chunks."""
    if not answer:
        return answer
    out = answer
    if "med-xxx" in out.lower() and retrieval_results:
        for r in retrieval_results:
            for m in re.finditer(r"^##\s+([^(]+)\s*\(\s*`(med-\d+)`\s*\)", r.chunk.text, re.MULTILINE):
                title = m.group(1).strip()
                real_id = m.group(2)
                if title.lower() not in out.lower():
                    continue
                out = re.sub(
                    rf"\*\*{re.escape(title)}\*\*\s*\(\s*`med-XXX`\s*\)",
                    f"**{title}** (`{real_id}`)",
                    out,
                    count=1,
                    flags=re.IGNORECASE,
                )
                out = re.sub(
                    rf"(?i)\b{re.escape(title)}\s*\(\s*`med-XXX`\s*\)",
                    f"{title} (`{real_id}`)",
                    out,
                    count=1,
                )
                out = re.sub(
                    rf"(?i)\b{re.escape(title)}\s*\(\s*med-XXX\s*\)",
                    f"{title} (`{real_id}`)",
                    out,
                    count=1,
                )
        if "med-xxx" in out.lower():
            blob = "\n".join(x.chunk.text for x in retrieval_results)
            unique = list(dict.fromkeys(re.findall(r"`(med-\d+)`", blob)))
            if len(unique) == 1:
                real = unique[0]
                out = re.sub(r"`med-XXX`", f"`{real}`", out, flags=re.IGNORECASE)
                out = re.sub(r"\bmed-XXX\b", real, out, flags=re.IGNORECASE)
    # Normalize (med-NNN) without backticks to (`med-NNN`) for display consistency
    out = re.sub(r"\(\s*(med-\d+)\s*\)", r"(`\1`)", out)
    return out


def _apply_medicine_standard_format(diagnosis_text: str) -> str:
    """Ensure greeting + body + closing with required phrase (no LLM)."""
    t = (diagnosis_text or "").strip()
    t = _strip_trailing_closing_paragraph(t)
    t = _strip_leading_greeting_lines(t)
    core = t.strip()
    if not core:
        core = "We have no additional detail to provide based on the reference material."
    return f"{_MEDICINE_STANDARD_GREETING}\n\n{core}\n\n{_MEDICINE_STANDARD_CLOSING}"


class RunRagPipeline:
    def __init__(
        self,
        scenarios: ScenarioRepositoryPort,
        embeddings: EmbeddingModelPort,
        chat: ChatModelPort,
        vector_index: VectorIndexPort,
        tfidf_index: TfIdfIndexPort,
        reranker: RerankerPort,
        *,
        scenarios_dir: Path,
        embedding_model_name: str,
    ) -> None:
        self._scenarios = scenarios
        self._embeddings = embeddings
        self._chat = chat
        self._vector_index = vector_index
        self._tfidf_index = tfidf_index
        self._reranker = reranker
        self._scenarios_dir = scenarios_dir
        self._embedding_model_name = embedding_model_name

    async def _collect_chat(self, prompt: str, model: str | None) -> str:
        parts: list[str] = []
        async for token in self._chat.stream_generate(prompt, model=model):
            parts.append(token)
        return "".join(parts)

    async def stream(self, scenario_id: str, query: str) -> AsyncIterator[PipelineEvent]:
        scenario = await self._scenarios.get_scenario(scenario_id)
        run_id = str(uuid.uuid4())
        seq = 0
        started = time.perf_counter()
        query_vector: list[float] = []
        retrieval_results: list[RetrievalResult] = []
        final_answer = ""
        diagnosis_text = ""
        has_retrieve_enabled = any(
            n.kind in ("retrieve", "tfidf_retrieve") and n.enabled for n in scenario.pipeline.nodes
        )
        chat_model = str(scenario.config.get("chat_model") or "").strip() or None

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
            diagnose_response_mode = None
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
                cs = int(scenario.config.get("chunk_size", 500))
                co = int(scenario.config.get("chunk_overlap", 50))
                fp = documents_fingerprint(scenario)
                cache_rel = str(scenario.config.get("embedding_cache") or "").strip()
                cache_loaded = False
                if cache_rel:
                    cache_path = (self._scenarios_dir / cache_rel).resolve()
                    try_load = getattr(self._vector_index, "try_load_embedding_cache", None)
                    if callable(try_load):
                        cache_loaded = try_load(
                            cache_path,
                            chunks,
                            expected_model=self._embedding_model_name,
                            chunk_size=cs,
                            chunk_overlap=co,
                            documents_sha256=fp,
                            scenario_id=scenario.id,
                        )
                if not cache_loaded:
                    await self._vector_index.build(chunks)
                top_k = int(node.config.get("top_k", 10))
                display_k = int(node.config.get("display_k", 5))
                candidates = await self._vector_index.search(query_vector, top_k)
                yield event(
                    "node_output",
                    node.id,
                    {
                        "fromEmbeddingCache": cache_loaded,
                        "retrieved": [
                            {
                                "chunkId": r.chunk.id,
                                "text": r.chunk.text,
                                "score": round(r.score, 4),
                                "source": r.chunk.source,
                            }
                            for r in candidates[:display_k]
                        ],
                        "totalFetched": len(candidates),
                    },
                )
                retrieval_results = candidates

            elif node.kind == "tfidf_retrieve":
                chunks = await self._load_chunks(scenario)
                await self._tfidf_index.build(chunks)
                top_k = int(node.config.get("top_k", 10))
                display_k = int(node.config.get("display_k", 5))
                tfidf_candidates = await self._tfidf_index.search(processed_query, top_k)
                # Union with any prior vector-retrieval results: deduplicate by chunk id,
                # keeping the higher score when the same chunk appears in both result sets.
                # Do NOT re-slice to top_k — the purpose of a second retriever is to surface
                # chunks the first retriever missed, so we pass the full union downstream.
                merged: dict[str, RetrievalResult] = {r.chunk.id: r for r in retrieval_results}
                for r in tfidf_candidates:
                    existing = merged.get(r.chunk.id)
                    if existing is None or r.score > existing.score:
                        merged[r.chunk.id] = r
                retrieval_results = sorted(merged.values(), key=lambda r: r.score, reverse=True)
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
                            for r in tfidf_candidates[:display_k]
                        ],
                        "totalFetched": len(tfidf_candidates),
                        "mergedCount": len(retrieval_results),
                    },
                )

            elif node.kind == "rerank":
                retrieval_results = await self._maybe_rerank(scenario, processed_query, retrieval_results)
                yield event(
                    "node_output",
                    node.id,
                    {"reranked": [{"chunkId": r.chunk.id, "score": round(r.score, 4)} for r in retrieval_results]},
                )

            elif node.kind == "filter":
                retrieval_results = await self._filter_chunks(processed_query, retrieval_results, chat_model)
                yield event(
                    "node_output",
                    node.id,
                    {
                        "filtered": [
                            {
                                "chunkId": r.chunk.id,
                                "text": r.chunk.text,
                                "score": round(r.score, 4),
                            }
                            for r in retrieval_results
                        ],
                        "filteredCount": len(retrieval_results),
                    },
                )

            elif node.kind == "generate":
                stage = str(node.config.get("stage") or node.id)
                system_prompt = str(scenario.config.get("system_prompt", "")).strip()

                if stage == "diagnose":
                    diagnose_response_mode = _diagnose_response_mode(processed_query)
                    wants_table = diagnose_response_mode == "comparison_table"
                    wants_details = diagnose_response_mode == "details"
                    if has_retrieve_enabled:
                        context = "\n\n".join(f"[{i+1}] {r.chunk.text}" for i, r in enumerate(retrieval_results))
                        catalog_class = _detect_catalog_class_query(processed_query)
                        allowed_med_ids = _med_ids_from_retrieval_for_class(retrieval_results, catalog_class)
                        allowed_ids_line = (
                            "Allowed medication IDs for this answer (cite ONLY these; do not mention any other drug or "
                            f"`med-NNN`):\n{', '.join(sorted(allowed_med_ids))}\n"
                            if allowed_med_ids
                            else ""
                        )
                        list_all_line = ""
                        if (
                            allowed_med_ids
                            and _query_asks_list_all(processed_query)
                            and not wants_table
                            and not wants_details
                        ):
                            n = len(allowed_med_ids)
                            list_all_line = (
                                f"\nLIST-ALL REQUIREMENT: The user asked for every matching medication. "
                                f"Output exactly {n} numbered items—one per id in the Allowed list above. "
                                "Do not omit, merge, summarize down, or cap the list.\n"
                            )
                        response_example = str(scenario.config.get("response_example", "")).strip()
                        comparison_example = str(scenario.config.get("comparison_table_example", "")).strip()
                        if wants_table and comparison_example and _example_only_uses_allowed_med_ids(
                            comparison_example, allowed_med_ids
                        ):
                            example_block = (
                                "\n\nExample for a drug comparison query — output one Markdown table in this shape "
                                "(populate every cell from the reference context only, not from this sample):\n"
                                f"{comparison_example}"
                            )
                        elif wants_table:
                            example_block = (
                                "\n\nOutput one GitHub-flavored Markdown table (header, |---| separator, one row per "
                                "on-topic medication). Do not use a numbered list for this query."
                            )
                        elif wants_details:
                            example_block = (
                                "\n\nThis query asks for a single medication: on the first line use **DrugName** and the "
                                "exact `med-NNN` id from that drug's section in the context (never the literal letters XXX). "
                                "Then give class, indications, mechanism, and cautions taken from the same context in "
                                "clear Markdown. Do not use a numbered list of multiple drugs or a comparison table."
                            )
                        elif response_example and _example_only_uses_allowed_med_ids(response_example, allowed_med_ids):
                            example_block = (
                                f"\n\nExample of a well-formed answer (use this style and format):\n{response_example}"
                            )
                        else:
                            example_block = ""
                        if wants_details:
                            mode_rules = (
                                "- Focus on the medication(s) the user named or clearly implied in the query; if the "
                                "context has exactly one relevant drug, describe only that drug.\n"
                                "- Ground every fact in the context chunk for that drug: use its **Drug class**, "
                                "**Symptoms / use cases**, **Mechanism**, and **Cautions** lines as written there—do not "
                                "substitute a different class, mechanism, or indication from another medication or from "
                                "general knowledge.\n"
                                "- Use the details / single-profile format from the rules above—not a multi-item "
                                "numbered list.\n"
                            )
                        else:
                            mode_rules = (
                                "- DROP every entry whose drug class, indications, and mechanism do not match the user's topic "
                                "(e.g. drop ARBs, statins, beta-blockers, SSRIs, benzodiazepines, corticosteroids, opioids "
                                "when the user asked for NSAIDs—and vice-versa).\n"
                                "- COUNT: if the user gave an explicit number, output exactly that many on-topic entries. "
                                "If the user said 'all' or gave no number, output EVERY on-topic entry—do NOT cap the list.\n"
                                "- If the query is a drug comparison (including compare-all / class-wide), output one "
                                "Markdown table. Otherwise use a numbered list when two or more entries apply.\n"
                            )
                        prompt = (
                            f"{_MEDICINE_STYLE_INTERNAL}"
                            "Answer using only the context below. Apply topic + count discipline from the rules above:\n"
                            f"{mode_rules}"
                            f"No greeting or sign-off here.{example_block}\n\n"
                            f"Query:\n{processed_query}\n\nContext:\n{context}\n\n"
                            f"{allowed_ids_line}{list_all_line}"
                            "Answer:"
                        )
                    else:
                        prompt = (
                            processed_query
                            if not system_prompt
                            else f"{_MEDICINE_STYLE_INTERNAL}{system_prompt}\n\nUser:\n{processed_query}\n\nAssistant:"
                        )
                    yield event(
                        "node_output",
                        node.id,
                        {
                            "prompt": prompt,
                            "confidence": self._confidence(retrieval_results) if has_retrieve_enabled else 1.0,
                            "responseMode": diagnose_response_mode,
                        },
                    )
                    diagnosis_text = await self._collect_chat(prompt, chat_model)
                    if has_retrieve_enabled and retrieval_results:
                        diagnosis_text = _repair_med_id_placeholder(diagnosis_text, retrieval_results)
                        allowed_after = _med_ids_from_retrieval_for_class(
                            retrieval_results, _detect_catalog_class_query(processed_query)
                        )
                        if allowed_after:
                            diagnosis_text = _sanitize_answer_to_allowed_med_ids(diagnosis_text, allowed_after)
                    yield event(
                        "node_output",
                        node.id,
                        {"finalAnswer": diagnosis_text, "responseMode": diagnose_response_mode},
                    )

                elif stage == "standardize":
                    final_answer = _apply_medicine_standard_format(diagnosis_text)
                    yield event(
                        "node_output",
                        node.id,
                        {
                            "method": "template",
                            "greeting": _MEDICINE_STANDARD_GREETING,
                            "closing": _MEDICINE_STANDARD_CLOSING,
                            "confidence": self._confidence(retrieval_results) if has_retrieve_enabled else 1.0,
                        },
                    )
                    yield event("node_output", node.id, {"finalAnswer": final_answer})

                else:
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
                    async for token in self._chat.stream_generate(prompt, model=chat_model):
                        final_answer += token
                        yield event("token", node.id, {"token": token})
                    if has_retrieve_enabled and retrieval_results:
                        allowed_gen = _med_ids_from_retrieval_for_class(
                            retrieval_results, _detect_catalog_class_query(processed_query)
                        )
                        if allowed_gen:
                            final_answer = _sanitize_answer_to_allowed_med_ids(final_answer, allowed_gen)
                    yield event("node_output", node.id, {"finalAnswer": final_answer})

            completed_payload: dict = {"guidance": _guidance(node.id)}
            if diagnose_response_mode is not None:
                completed_payload["responseMode"] = diagnose_response_mode
            yield event("node_completed", node.id, completed_payload)

        yield event("run_completed", payload={"answer": final_answer})

    async def _filter_chunks(
        self,
        query: str,
        candidates: list[RetrievalResult],
        chat_model: str | None,
    ) -> list[RetrievalResult]:
        """Ask the LLM which chunks are topically relevant to the query.

        A compact index (chunk number + drug class line + first content line) is
        sent in a single call.  The model returns a comma-separated list of the
        relevant numbers; we parse that and keep only those chunks.  If parsing
        fails or the model keeps everything, the original list is returned unchanged.
        """
        if not candidates:
            return candidates

        head_to_head = _narrow_candidates_by_head_to_head(query, candidates)
        if head_to_head is not None:
            return head_to_head

        candidates = _narrow_candidates_by_catalog_drug_class(query, candidates)
        if not candidates:
            return []

        index_lines: list[str] = []
        for i, r in enumerate(candidates, start=1):
            # Extract the most diagnostic line from the chunk: drug class if present,
            # otherwise the first non-empty content line.
            lines = [ln.strip() for ln in r.chunk.text.splitlines() if ln.strip()]
            class_line = next((ln for ln in lines if "drug class" in ln.lower()), None)
            summary = class_line or (lines[0] if lines else r.chunk.id)
            index_lines.append(f"[{i}] {summary}")

        index_block = "\n".join(index_lines)
        prompt = (
            f"User query: {query}\n\n"
            "Below is a numbered list of document chunk summaries. "
            "Return ONLY the numbers (comma-separated, e.g. '1, 3, 7') of chunks whose "
            "drug class, indications, or mechanism directly match the topic the user asked about.\n"
            "Rules:\n"
            "- If the user asked about NSAIDs, keep only NSAID entries.\n"
            "- If the user asked about pain killers / analgesics, keep NSAIDs and opioids.\n"
            "- If the user asked about **beta blockers**, keep ONLY chunks whose summary line shows "
            "**Drug class** as beta blocker (beta-adrenergic antagonist). **Never** keep benzodiazepines, "
            "statins, NSAIDs, or other classes—even if the chunk text mentions the word “beta” in sample "
            "questions or mechanisms.\n"
            "- If the user asked about **antihistamines** (anti-histamines, H1 antihistamines), keep ONLY "
            "chunks whose **Drug class** line describes an antihistamine (e.g. H1-antihistamine). **Never** "
            "keep beta blockers, statins, or other classes just because the mechanism text mentions "
            "“histamine” or “receptors.”\n"
            "- If the user asked about a specific drug by name, keep that drug's chunk.\n"
            "- When the topic is a drug class (e.g. NSAIDs), drop entries from other classes (ARBs, statins, "
            "SSRIs, benzodiazepines, corticosteroids, antidiabetics, etc.).\n"
            "- If the query is general (no specific class), keep all chunks.\n"
            "Return nothing except the comma-separated numbers.\n\n"
            f"Chunks:\n{index_block}\n\n"
            "Relevant numbers:"
        )
        raw = await self._collect_chat(prompt, chat_model)
        found = [int(m) for m in re.findall(r"\b\d+\b", raw) if 1 <= int(m) <= len(candidates)]
        if not found:
            return candidates
        kept = [candidates[i - 1] for i in sorted(set(found))]
        # Fall back to the full list if the model kept everything or kept nothing useful
        result = kept if 0 < len(kept) < len(candidates) else candidates
        class_key = _detect_catalog_class_query(query)
        if class_key:
            return [r for r in result if _chunk_drug_class_matches_key(r.chunk.text, class_key)]
        return result

    async def _load_chunks(self, scenario: Scenario) -> list[DocumentChunk]:
        return chunks_from_scenario(scenario)

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
