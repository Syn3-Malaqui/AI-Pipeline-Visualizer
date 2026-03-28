#!/usr/bin/env python3
"""
Generate synthetic medicine-style RAG corpus via local Ollama (default: gemma3:4b).

Pipeline (separate steps):
  1) Names — fictional generic-style names (INN-like), not sci-fi brands
  2) Class — assign each name a drug_class chosen ONLY from a fixed pharmacology list
  3) Enrich — symptoms, queries, mechanism, cautions, dose notes (demo language)

Outputs (gitignored by default):
  - medicines_enriched.json — structured records
  - medicines_corpus.md — markdown for retrieval/chunking

Requires: `ollama pull gemma3:4b` (or pass --model).

By default prints phase/batch progress and streams model tokens to stderr; use `--quiet` to disable stderr tokens.

Each Ollama response is also written token-by-token to `--out-dir` / `.generate_medicine_current_stream.txt`
(truncated at the start of each request, flush per token). After each successful enrich batch,
`medicines_enriched.json` and `medicines_corpus.md` are rewritten with all records so far.

Checkpoint: progress is saved under `--out-dir` as `.generate_medicine_checkpoint.json`.
If a run stops mid-stream (truncated JSON), run again with `--resume` to continue enrich batches.

Requires matching `--model`, `--base-url`, `--total`, and `--batch-size` to the checkpoint.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Conventional pharmacological / therapeutic classes (reuse across entries; no made-up categories).
ALLOWED_DRUG_CLASSES: tuple[str, ...] = (
    "NSAID, nonselective (e.g. propionic acid derivatives)",
    "NSAID, preferential COX-2",
    "Acetaminophen / paracetamol class (antipyretic analgesic)",
    "Opioid agonist, weak (demo schedule)",
    "Opioid agonist, strong (demo schedule)",
    "H1-antihistamine, first-generation",
    "H1-antihistamine, second-generation",
    "Proton pump inhibitor",
    "H2-receptor antagonist",
    "SSRI antidepressant",
    "SNRI antidepressant",
    "Benzodiazepine anxiolytic (short-acting, demo)",
    "Beta blocker, cardioselective",
    "Beta blocker, nonselective",
    "ACE inhibitor",
    "Angiotensin II receptor blocker (ARB)",
    "Dihydropyridine calcium channel blocker",
    "Statin (HMG-CoA reductase inhibitor)",
    "Biguanide antidiabetic",
    "Sulfonylurea insulin secretagogue",
    "GLP-1 receptor agonist (injectable, demo)",
    "Loop diuretic",
    "Thiazide / thiazide-like diuretic",
    "5-HT1B/1D agonist (triptan class, demo)",
    "Topical corticosteroid, mid-potency (demo)",
    "Inhaled beta-2 agonist, short-acting",
    "Inhaled corticosteroid",
    "Macrolide antibiotic (demo)",
    "Penicillin-class beta-lactam antibiotic (demo)",
    "Benzoyl peroxide / topical retinoid (acne demo)",
    "Bisphosphonate (bone, demo)",
    "PPI + antibiotic adjunct (H. pylori demo, fictional combo label)",
)

CHECKPOINT_VERSION = 1
CHECKPOINT_FILENAME = ".generate_medicine_checkpoint.json"
STREAM_BUFFER_FILENAME = ".generate_medicine_current_stream.txt"

EXPECTED_KEYS = (
    "display_name",
    "drug_class",
    "symptoms_or_use_cases",
    "sample_user_queries",
    "mechanism_blurb",
    "cautions_blurb",
    "demo_dose_note",
)


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text.strip())
    return text.strip()


def _extract_json_array(text: str) -> list:
    text = _strip_json_fence(text)
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON array found in model response")
    raw = text[start : end + 1]
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Expected top-level JSON array")
    return data


_ENRICH_ALIASES: dict[str, tuple[str, ...]] = {
    "display_name": ("display_name", "name", "generic_name"),
    "drug_class": ("drug_class", "class", "therapeutic_class"),
    "symptoms_or_use_cases": (
        "symptoms_or_use_cases",
        "symptoms",
        "use_cases",
        "symptoms_and_use_cases",
        "indications",
        "symptom_keywords",
    ),
    "sample_user_queries": (
        "sample_user_queries",
        "user_queries",
        "queries",
        "sample_queries",
        "questions",
    ),
    "mechanism_blurb": ("mechanism_blurb", "mechanism", "mechanism_summary", "mechanism_of_action"),
    "cautions_blurb": ("cautions_blurb", "cautions", "warnings", "warnings_demo"),
    "demo_dose_note": ("demo_dose_note", "dose_note", "dosing_note", "dose_note_demo"),
}


def _pick_value(obj: dict, canonical: str) -> object | None:
    for alias in _ENRICH_ALIASES.get(canonical, (canonical,)):
        if alias in obj:
            return obj[alias]
    lower_map = {str(k).lower().replace(" ", "_").replace("-", "_"): v for k, v in obj.items()}
    for alias in _ENRICH_ALIASES.get(canonical, (canonical,)):
        k = alias.lower().replace(" ", "_").replace("-", "_")
        if k in lower_map:
            return lower_map[k]
    return None


def _coerce_str(val: object, field: str) -> str:
    if val is None:
        return ""
    if isinstance(val, str):
        return val.strip()
    if isinstance(val, (int, float, bool)):
        return str(val)
    if isinstance(val, list) and val and all(isinstance(x, str) for x in val):
        return "; ".join(x.strip() for x in val if x.strip())
    raise ValueError(f"{field}: expected string-like value, got {type(val).__name__}")


def _coerce_str_list(val: object, field: str) -> list[str]:
    if val is None:
        return []
    if isinstance(val, str):
        s = val.strip()
        return [s] if s else []
    if isinstance(val, list):
        out: list[str] = []
        for item in val:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, (int, float, bool)):
                out.append(str(item))
        return out
    raise ValueError(f"{field}: expected array of strings or a string, got {type(val).__name__}")


def _normalize_record(obj: object, *, warn: bool = True) -> dict:
    """Normalize phase-3 enrich objects: aliases, coercion, placeholders for missing keys."""
    if not isinstance(obj, dict):
        raise ValueError("Record must be a JSON object")
    raw = dict(obj)
    out: dict = {}
    used_placeholder: list[str] = []

    for key in EXPECTED_KEYS:
        raw_val = _pick_value(raw, key)
        if raw_val is None:
            used_placeholder.append(key)
            if key in ("symptoms_or_use_cases", "sample_user_queries"):
                out[key] = [f"(demo placeholder — model omitted {key})"]
            elif key == "demo_dose_note":
                out[key] = "Illustrative only, not dosing instruction (auto-filled)."
            else:
                out[key] = f"(demo placeholder — model omitted {key})"
            continue
        try:
            if key in ("symptoms_or_use_cases", "sample_user_queries"):
                lst = _coerce_str_list(raw_val, key)
                if not lst:
                    used_placeholder.append(key)
                    out[key] = [f"(demo placeholder — empty {key})"]
                else:
                    out[key] = lst
            else:
                s = _coerce_str(raw_val, key)
                if not s:
                    used_placeholder.append(key)
                    out[key] = f"(demo placeholder — empty {key})"
                else:
                    out[key] = s
        except ValueError as exc:
            raise ValueError(f"{key}: {exc}") from exc

    if used_placeholder and warn:
        dn = out.get("display_name", "?")
        print(
            f"    warning: filled placeholder field(s) for {dn!r}: {used_placeholder}",
            file=sys.stderr,
            flush=True,
        )
    return out


def _checkpoint_path(out_dir: Path) -> Path:
    return out_dir / CHECKPOINT_FILENAME


def _save_checkpoint(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_checkpoint(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict) or raw.get("version") != CHECKPOINT_VERSION:
        return None
    return raw


def _delete_checkpoint(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _infer_phase1_batches_done(all_names: list[str], name_batches: list[int]) -> int:
    """How many phase-1 batches are fully reflected in all_names (for legacy checkpoints)."""
    if not all_names:
        return 0
    acc = 0
    for i, c in enumerate(name_batches):
        acc += c
        if len(all_names) == acc:
            return i + 1
    return -1


def _normalize_class(choice: str, allowed: tuple[str, ...]) -> str:
    """Map model output to allowlist (exact, then case-insensitive)."""
    c = choice.strip()
    if c in allowed:
        return c
    lower = {a.lower(): a for a in allowed}
    if c.lower() in lower:
        return lower[c.lower()]
    # Substring match: model sometimes shortens
    for a in allowed:
        if a.lower() in c.lower() or c.lower() in a.lower():
            return a
    return allowed[hash(c) % len(allowed)]


def _ollama_generate(
    base_url: str,
    model: str,
    prompt: str,
    *,
    verbose: bool,
    num_predict: int = 16384,
    stream_sink: Path | None = None,
) -> str:
    """Call Ollama /api/generate. Streams when verbose or stream_sink is set.

    If stream_sink is set, each token is appended and flushed to that file immediately
    (file is truncated at the start of the request).
    """
    url = f"{base_url.rstrip('/')}/api/generate"
    use_stream = verbose or stream_sink is not None
    payload: dict = {
        "model": model,
        "prompt": prompt,
        "stream": use_stream,
        "options": {"num_predict": num_predict},
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    sink_fp = None
    try:
        if stream_sink is not None:
            stream_sink.parent.mkdir(parents=True, exist_ok=True)
            sink_fp = stream_sink.open("w", encoding="utf-8")
        with urllib.request.urlopen(req, timeout=600) as resp:
            if not use_stream:
                data = json.loads(resp.read().decode("utf-8"))
                text = data.get("response", "")
            else:
                parts: list[str] = []
                if verbose:
                    print("    stream: ", end="", file=sys.stderr, flush=True)
                while True:
                    raw_line = resp.readline()
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token = chunk.get("response", "")
                    if isinstance(token, str) and token:
                        parts.append(token)
                        if sink_fp is not None:
                            sink_fp.write(token)
                            sink_fp.flush()
                        if verbose:
                            print(token, end="", file=sys.stderr, flush=True)
                    if chunk.get("done") is True:
                        break
                if sink_fp is not None:
                    try:
                        os.fsync(sink_fp.fileno())
                    except OSError:
                        pass
                if verbose:
                    print(file=sys.stderr)
                text = "".join(parts)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Ollama HTTP error: {exc}") from exc
    finally:
        if sink_fp is not None:
            sink_fp.close()
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Empty response from Ollama")
    return text


def _prompt_names_only(count: int, batch_index: int, total_batches: int) -> str:
    return f"""You are generating FICTIONAL generic-style drug names for a software RAG demo. These are NOT real medicines.

Rules for each name:
- Must sound like plausible international nonproprietary (INN) / generic names: common patterns include -azole, -prazole, -dipine, -olol, -statin, -pril, -sartan, -tidine, two or three syllables plus a standard suffix.
- Do NOT use sci-fi, brand hype, or fantasy words (no "Quantum", "Nova", "Aether", "Celestria", etc.).
- Do NOT copy any existing trademark or real product name.
- Latin/Greek-ish roots are fine if they read like pharmacy generics.

Output ONLY a JSON array of exactly {count} strings (the names), no markdown fences, no commentary.
This is batch {batch_index + 1} of {total_batches}; keep names distinct from each other within the full run.

Return the JSON array now."""


def _prompt_assign_classes(names: list[str], batch_index: int, total_batches: int) -> str:
    allowed = json.dumps(list(ALLOWED_DRUG_CLASSES), indent=2)
    names_json = json.dumps(names, indent=2)
    return f"""You assign pharmacological classes for a fictional drug demo (NOT real prescribing).

Allowed drug_class values — you MUST copy one string EXACTLY from this list for each name (character-for-character match to one of the strings):

{allowed}

Names to assign (batch {batch_index + 1} of {total_batches}):
{names_json}

Output ONLY a JSON array of exactly {len(names)} objects. Each object:
{{"display_name": "<exact name from input>", "drug_class": "<EXACTLY one string from the allowed list>"}}

Spread variety across classes within this batch (do not put everything in one class). No markdown fences."""


def _prompt_enrich(pairs: list[tuple[str, str]], batch_index: int, total_batches: int) -> str:
    lines = [f"- {name} → {cls}" for name, cls in pairs]
    joined = "\n".join(lines)
    return f"""You enrich FICTIONAL demo drug entries for software testing. NOT medical advice; NOT real labels.

For each line below, expand into one JSON object with these keys:
- "display_name": exact string from the line
- "drug_class": exact string from the line (same as given)
- "symptoms_or_use_cases": array of 3–6 short plain phrases patients might search (symptoms, situations)
- "sample_user_queries": array of 2–4 natural questions a user might ask (realistic phrasing)
- "mechanism_blurb": 1–2 sentences in textbook style for THAT class (generic mechanism language; say "in demo corpus" if needed)
- "cautions_blurb": 1–2 sentences of typical class-level cautions (demo only; not exhaustive)
- "demo_dose_note": one sentence ending with: illustrative only, not dosing instruction.

Drug lines (batch {batch_index + 1} of {total_batches}):
{joined}

Output ONLY a JSON array of {len(pairs)} objects in the same order as the list. No markdown fences.

Every object MUST include all seven keys spelled exactly as above (use the key name "symptoms_or_use_cases", not "symptoms" alone).

Keep every string field concise (mechanism_blurb and cautions_blurb under ~280 characters each) so the full JSON is complete and valid."""


def _write_corpus_files(out_dir: Path, records: list[dict]) -> None:
    """Write medicines_enriched.json + medicines_corpus.md with stable ids (partial or final)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with_ids: list[dict] = []
    for idx, rec in enumerate(records, start=1):
        row = dict(rec)
        row["id"] = f"med-{idx:03d}"
        with_ids.append(row)
    json_path = out_dir / "medicines_enriched.json"
    md_path = out_dir / "medicines_corpus.md"
    json_text = json.dumps(with_ids, indent=2)
    md_text = render_markdown(with_ids)
    for path, text in ((json_path, json_text), (md_path, md_text)):
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(path)
        try:
            fd = os.open(path, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        except OSError:
            pass


def render_markdown(records: list[dict]) -> str:
    lines: list[str] = [
        "# Synthetic medicine reference (generated demo corpus)\n",
        "\n",
        "This file was produced by `scripts/generate_medicine_corpus.py`. "
        "**Not medical advice.** Fictional entries for RAG pipeline testing only.\n\n",
    ]
    for r in records:
        lines.append(f"## {r['display_name']} (`{r['id']}`)\n\n")
        lines.append(f"- **Drug class (demo):** {r['drug_class']}\n")
        lines.append(f"- **Symptoms / use cases:** {', '.join(r['symptoms_or_use_cases'])}\n")
        lines.append("- **Sample user questions:**\n")
        for q in r["sample_user_queries"]:
            lines.append(f"  - {q}\n")
        lines.append(f"- **Mechanism (demo):** {r['mechanism_blurb']}\n")
        lines.append(f"- **Cautions (demo):** {r['cautions_blurb']}\n")
        lines.append(f"- **Dose note (demo):** {r['demo_dose_note']}\n\n")
    return "".join(lines)


def _run_phase(
    label: str,
    base_url: str,
    model: str,
    prompt: str,
    verbose: bool,
    *,
    num_predict: int = 16384,
    stream_sink: Path | None = None,
) -> str:
    if verbose:
        print(f"\n{label}", file=sys.stderr, flush=True)
    t0 = time.perf_counter()
    raw = _ollama_generate(
        base_url,
        model,
        prompt,
        verbose=verbose,
        num_predict=num_predict,
        stream_sink=stream_sink,
    )
    elapsed = time.perf_counter() - t0
    if verbose:
        print(f"    done in {elapsed:.1f}s, response_len={len(raw)} chars", file=sys.stderr, flush=True)
    return raw


def _parse_json_array_with_retry(
    raw: str,
    *,
    attempts: int,
    label: str,
    base_url: str,
    model: str,
    prompt: str,
    verbose: bool,
    num_predict: int,
    stream_sink: Path | None = None,
) -> list:
    last_exc: Exception | None = None
    suffix = ""
    for attempt in range(attempts):
        text = raw + suffix
        try:
            return _extract_json_array(text)
        except (json.JSONDecodeError, ValueError) as exc:
            last_exc = exc
            if attempt + 1 >= attempts:
                break
            if verbose:
                print(
                    f"    parse failed ({exc}); retry {attempt + 2}/{attempts}…",
                    file=sys.stderr,
                    flush=True,
                )
            retry_prompt = (
                f"{prompt}\n\nIMPORTANT: Your previous output was invalid or truncated JSON. "
                "Reply with ONLY one complete valid JSON array, same schema and count, no markdown."
            )
            raw = _run_phase(
                f"{label} (retry {attempt + 2})",
                base_url,
                model,
                retry_prompt,
                verbose,
                num_predict=num_predict,
                stream_sink=stream_sink,
            )
            suffix = ""
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("parse retry exhausted with no exception")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate synthetic medicine corpus via Ollama (names → class → enrich).",
    )
    parser.add_argument(
        "--base-url",
        default="http://localhost:11434",
        help="Ollama base URL",
    )
    parser.add_argument("--model", default="gemma3:4b", help="Ollama chat model")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "scenarios" / "medicine_rag",
        help="Directory for medicines_enriched.json and medicines_corpus.md",
    )
    parser.add_argument("--total", type=int, default=40, help="Total records to generate")
    parser.add_argument("--batch-size", type=int, default=8, help="Records per Ollama call (names + enrich)")
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help=f"No stderr progress/tokens; Ollama still streams to {STREAM_BUFFER_FILENAME} under --out-dir",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help=f"Continue from {CHECKPOINT_FILENAME} in --out-dir (same model/total/batch-size)",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Delete checkpoint and start from phase 1",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        metavar="N",
        help="JSON parse / length mismatch: full Ollama retries per batch (default: 3)",
    )
    args = parser.parse_args()
    verbose = not args.quiet

    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    ck_path = _checkpoint_path(out_dir)
    stream_path = out_dir / STREAM_BUFFER_FILENAME

    if args.fresh:
        _delete_checkpoint(ck_path)
        if verbose:
            print(f"[generate_medicine_corpus] removed checkpoint {ck_path}", file=sys.stderr)
    elif not args.resume and ck_path.is_file():
        print(
            f"Note: {ck_path} exists. Use --resume to continue that run, or --fresh to discard it.",
            file=sys.stderr,
        )

    name_batches: list[int] = []
    remaining = args.total
    while remaining > 0:
        take = min(args.batch_size, remaining)
        name_batches.append(take)
        remaining -= take

    def checkpoint_payload(
        *,
        phase1_batches_done: int,
        all_names: list[str],
        class_by_name: dict[str, str] | None,
        enrich_batches_done: int,
        all_records: list[dict],
    ) -> dict:
        return {
            "version": CHECKPOINT_VERSION,
            "model": args.model,
            "base_url": args.base_url,
            "total": args.total,
            "batch_size": args.batch_size,
            "name_batches": name_batches,
            "phase1_batches_done": phase1_batches_done,
            "all_names": all_names,
            "class_by_name": class_by_name,
            "enrich_batches_done": enrich_batches_done,
            "all_records": all_records,
        }

    all_names: list[str] = []
    class_by_name: dict[str, str] | None = None
    enrich_batches_done = 0
    phase1_batches_done = 0
    all_records: list[dict] = []

    if args.resume:
        cp = _load_checkpoint(ck_path)
        if cp is None:
            print(f"No valid checkpoint at {ck_path}; run without --resume to start fresh.", file=sys.stderr)
            return 1
        if (
            cp.get("model") != args.model
            or cp.get("base_url") != args.base_url
            or int(cp.get("total", -1)) != args.total
            or int(cp.get("batch_size", -1)) != args.batch_size
            or cp.get("name_batches") != name_batches
        ):
            print(
                "Checkpoint does not match current --model, --base-url, --total, or --batch-size.\n"
                "Use the same flags as the original run, or --fresh to discard the checkpoint.",
                file=sys.stderr,
            )
            return 1
        all_names = list(cp.get("all_names") or [])
        cb = cp.get("class_by_name")
        class_by_name = dict(cb) if isinstance(cb, dict) else None
        enrich_batches_done = int(cp.get("enrich_batches_done") or 0)
        all_records = [dict(r) for r in (cp.get("all_records") or []) if isinstance(r, dict)]
        if all_records:
            _write_corpus_files(out_dir, all_records)
            if verbose:
                print(
                    f"[generate_medicine_corpus] refreshed corpus files from checkpoint ({len(all_records)} records)",
                    file=sys.stderr,
                )
        p1 = cp.get("phase1_batches_done")
        if isinstance(p1, int) and p1 >= 0:
            phase1_batches_done = p1
        else:
            inferred = _infer_phase1_batches_done(all_names, name_batches)
            if inferred < 0:
                print(
                    f"Checkpoint at {ck_path} has {len(all_names)} names but length does not match "
                    "batch boundaries; use --fresh or fix the file.",
                    file=sys.stderr,
                )
                return 1
            phase1_batches_done = inferred
        if verbose:
            print(
                f"[generate_medicine_corpus] resumed: phase1_batches={phase1_batches_done}/"
                f"{len(name_batches)} names={len(all_names)} "
                f"class_map={'yes' if class_by_name else 'no'} "
                f"enrich_batches_done={enrich_batches_done}/{len(name_batches)} "
                f"records={len(all_records)}",
                file=sys.stderr,
            )

    if verbose and not args.resume:
        print(
            f"[generate_medicine_corpus] pipeline: names → drug_class → enrich\n"
            f"  model={args.model!r} base_url={args.base_url!r}\n"
            f"  total_records={args.total} batches={len(name_batches)} out_dir={out_dir}\n"
            f"  stream_capture={stream_path} (live token append + flush each token)\n"
            f"  checkpoint={ck_path} (use --resume after a crash; --fresh to reset)",
            file=sys.stderr,
        )

    retries = max(1, args.retries)

    # --- Phase 1: names only ---
    if phase1_batches_done < len(name_batches):
        for i in range(phase1_batches_done, len(name_batches)):
            count = name_batches[i]
            prompt = _prompt_names_only(count, i, len(name_batches))
            label = f"[phase 1: names] batch {i + 1}/{len(name_batches)} ({count} names)"
            raw = _run_phase(
                label,
                args.base_url,
                args.model,
                prompt,
                verbose,
                num_predict=6144,
                stream_sink=stream_path,
            )
            try:
                parsed = _parse_json_array_with_retry(
                    raw,
                    attempts=retries,
                    label=label,
                    base_url=args.base_url,
                    model=args.model,
                    prompt=prompt,
                    verbose=verbose,
                    num_predict=6144,
                    stream_sink=stream_path,
                )
            except (json.JSONDecodeError, ValueError) as exc:
                print(f"Phase 1 parse failed batch {i + 1}: {exc}", file=sys.stderr)
                print(raw[:2500], file=sys.stderr)
                print(f"Checkpoint kept at {ck_path}; re-run with --resume.", file=sys.stderr)
                return 1
            if len(parsed) != count:
                print(
                    f"Phase 1: expected {count} names, got {len(parsed)}",
                    file=sys.stderr,
                )
                print(f"Checkpoint kept at {ck_path}; re-run with --resume.", file=sys.stderr)
                return 1
            for item in parsed:
                if not isinstance(item, str) or not item.strip():
                    print(f"Phase 1: invalid name entry: {item!r}", file=sys.stderr)
                    return 1
                all_names.append(item.strip())
            phase1_batches_done = i + 1
            _save_checkpoint(
                ck_path,
                checkpoint_payload(
                    phase1_batches_done=phase1_batches_done,
                    all_names=all_names,
                    class_by_name=None,
                    enrich_batches_done=0,
                    all_records=[],
                ),
            )
            if verbose:
                print(f"    checkpoint saved ({len(all_names)} names)", file=sys.stderr, flush=True)

    if verbose:
        print(f"[phase 1] collected {len(all_names)} names", file=sys.stderr, flush=True)

    # --- Phase 2: assign drug_class from allowlist (batched like phase 1) ---
    if class_by_name is None:
        class_by_name = {}
        offset = 0
        for bi, count in enumerate(name_batches):
            chunk_names = all_names[offset : offset + count]
            offset += count
            assign_prompt = _prompt_assign_classes(chunk_names, bi, len(name_batches))
            label = f"[phase 2: drug classes] batch {bi + 1}/{len(name_batches)} ({count} names)"
            raw_assign = _run_phase(
                label,
                args.base_url,
                args.model,
                assign_prompt,
                verbose,
                num_predict=12288,
                stream_sink=stream_path,
            )
            try:
                assigned = _parse_json_array_with_retry(
                    raw_assign,
                    attempts=retries,
                    label=label,
                    base_url=args.base_url,
                    model=args.model,
                    prompt=assign_prompt,
                    verbose=verbose,
                    num_predict=12288,
                    stream_sink=stream_path,
                )
            except (json.JSONDecodeError, ValueError) as exc:
                print(f"Phase 2 parse failed batch {bi + 1}: {exc}", file=sys.stderr)
                print(raw_assign[:4000], file=sys.stderr)
                return 1
            if len(assigned) != count:
                print(
                    f"Phase 2 batch {bi + 1}: expected {count} assignments, got {len(assigned)}",
                    file=sys.stderr,
                )
                return 1
            for row in assigned:
                if not isinstance(row, dict):
                    print(f"Phase 2: expected object, got {type(row)}", file=sys.stderr)
                    return 1
                dn = str(row.get("display_name", "")).strip()
                dc = str(row.get("drug_class", "")).strip()
                chunk_set = set(chunk_names)
                if dn not in chunk_set:
                    print(f"Phase 2: name {dn!r} not in this batch", file=sys.stderr)
                    return 1
                if dn in class_by_name:
                    print(f"Phase 2: duplicate display_name {dn!r}", file=sys.stderr)
                    return 1
                class_by_name[dn] = _normalize_class(dc, ALLOWED_DRUG_CLASSES)

        if set(class_by_name.keys()) != set(all_names):
            missing = set(all_names) - set(class_by_name.keys())
            extra = set(class_by_name.keys()) - set(all_names)
            print(f"Phase 2: name mismatch missing={missing!r} extra={extra!r}", file=sys.stderr)
            return 1

        _save_checkpoint(
            ck_path,
            checkpoint_payload(
                phase1_batches_done=len(name_batches),
                all_names=all_names,
                class_by_name=dict(class_by_name),
                enrich_batches_done=0,
                all_records=[],
            ),
        )
        if verbose:
            print("[phase 2] checkpoint saved (classes assigned)", file=sys.stderr, flush=True)

    pairs: list[tuple[str, str]] = [(n, class_by_name[n]) for n in all_names]

    if verbose:
        print(f"[phase 2] assigned classes for {len(pairs)} drugs", file=sys.stderr, flush=True)

    # --- Phase 3: enrich in batches (same batch boundaries as phase 1) ---
    offset = sum(name_batches[:enrich_batches_done])
    for bi in range(enrich_batches_done, len(name_batches)):
        count = name_batches[bi]
        batch_pairs = pairs[offset : offset + count]
        offset += count
        prompt = _prompt_enrich(batch_pairs, bi, len(name_batches))
        label = f"[phase 3: enrich] batch {bi + 1}/{len(name_batches)} ({count} records)"
        raw = _run_phase(
            label,
            args.base_url,
            args.model,
            prompt,
            verbose,
            num_predict=24576,
            stream_sink=stream_path,
        )
        try:
            parsed = _parse_json_array_with_retry(
                raw,
                attempts=retries,
                label=label,
                base_url=args.base_url,
                model=args.model,
                prompt=prompt,
                verbose=verbose,
                num_predict=24576,
                stream_sink=stream_path,
            )
        except (json.JSONDecodeError, ValueError) as exc:
            print(f"Phase 3 parse failed batch {bi + 1}: {exc}", file=sys.stderr)
            print(raw[:3500], file=sys.stderr)
            print(f"Fix Ollama / try --resume after adjusting; checkpoint kept at {ck_path}", file=sys.stderr)
            return 1
        if len(parsed) != count:
            print(
                f"Phase 3 batch {bi + 1}: expected {count} records, got {len(parsed)}",
                file=sys.stderr,
            )
            print(f"Checkpoint kept at {ck_path}; re-run with --resume after fixing.", file=sys.stderr)
            return 1
        for obj in parsed:
            rec = _normalize_record(obj)
            name = rec["display_name"]
            expected_class = next((c for n, c in batch_pairs if n == name), None)
            if expected_class is None:
                print(f"Phase 3: unexpected display_name {name!r}", file=sys.stderr)
                return 1
            rec["drug_class"] = expected_class
            all_records.append(rec)
        enrich_batches_done = bi + 1
        _save_checkpoint(
            ck_path,
            checkpoint_payload(
                phase1_batches_done=len(name_batches),
                all_names=all_names,
                class_by_name=dict(class_by_name),
                enrich_batches_done=enrich_batches_done,
                all_records=all_records,
            ),
        )
        _write_corpus_files(out_dir, all_records)
        if verbose:
            print(
                f"    cumulative enriched={len(all_records)} (checkpoint + corpus JSON/MD saved)",
                file=sys.stderr,
                flush=True,
            )

    json_path = out_dir / "medicines_enriched.json"
    md_path = out_dir / "medicines_corpus.md"
    _write_corpus_files(out_dir, all_records)
    _delete_checkpoint(ck_path)
    msg = f"Wrote {len(all_records)} records to {json_path} and {md_path}"
    print(msg)
    if verbose:
        print(f"[generate_medicine_corpus] {msg} (checkpoint cleared)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
