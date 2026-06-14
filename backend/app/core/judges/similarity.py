from __future__ import annotations
import logging
import math
from typing import Optional

import numpy as np
import pandas as pd

from core.judges.base import BaseJudge
from core.utils import validate_required_columns

logger = logging.getLogger(__name__)

# ── Module-level singletons (lazy, cached) ────────────────────────────────────

_semantic_model = None
_perplexity_model = None
_perplexity_tokenizer = None


def _get_semantic_model():
    global _semantic_model
    if _semantic_model is None:
        from sentence_transformers import SentenceTransformer
        _semantic_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _semantic_model


def _get_perplexity_model():
    global _perplexity_model, _perplexity_tokenizer
    if _perplexity_model is None:
        try:
            import torch
            from transformers import GPT2LMHeadModel, GPT2TokenizerFast
            _perplexity_tokenizer = GPT2TokenizerFast.from_pretrained("gpt2")
            _perplexity_model = GPT2LMHeadModel.from_pretrained("gpt2")
            _perplexity_model.eval()
        except ImportError:
            logger.warning(
                "torch/transformers not installed; perplexity will be None. "
                "Install with: pip install torch transformers"
            )
    return _perplexity_model, _perplexity_tokenizer


# ── Per-metric helpers ─────────────────────────────────────────────────────────

def _bleu(reference: str, hypothesis: str) -> float:
    from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
    ref_tok = reference.lower().split()
    hyp_tok = hypothesis.lower().split()
    return float(sentence_bleu([ref_tok], hyp_tok, smoothing_function=SmoothingFunction().method1))


def _rouge_l(reference: str, hypothesis: str) -> float:
    from rouge_score import rouge_scorer as rs
    scorer = rs.RougeScorer(["rougeL"], use_stemmer=False)
    return float(scorer.score(reference, hypothesis)["rougeL"].fmeasure)


def _cer(reference: str, hypothesis: str) -> float:
    """Character Error Rate = Levenshtein(ref, hyp) / max(len(ref), 1)."""
    r, h = list(reference), list(hypothesis)
    n, m = len(r), len(h)
    # Use two-row DP to save memory
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        curr = [i] + [0] * m
        for j in range(1, m + 1):
            cost = 0 if r[i - 1] == h[j - 1] else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[m] / max(n, 1)


def _semantic_similarity(reference: str, hypothesis: str) -> float:
    model = _get_semantic_model()
    embs = model.encode([reference, hypothesis], normalize_embeddings=True)
    return float(np.dot(embs[0], embs[1]))


def _perplexity(text: str) -> Optional[float]:
    model, tokenizer = _get_perplexity_model()
    if model is None:
        return None
    try:
        import torch
        enc = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
        if enc["input_ids"].shape[1] < 2:
            return None
        with torch.no_grad():
            loss = model(**enc, labels=enc["input_ids"]).loss
        ppl = float(math.exp(loss.item()))
        return ppl if math.isfinite(ppl) else None
    except Exception as exc:
        logger.warning("Perplexity computation failed: %s", exc)
        return None


# ── Judge class ────────────────────────────────────────────────────────────────

class SimilarityJudge(BaseJudge):
    """Computes BLEU, ROUGE-L, CER, Semantic Similarity, and Perplexity."""

    def check_single_answer(self, model_answer: str, true_answer: str) -> dict:
        ref = str(true_answer).strip()
        hyp = str(model_answer).strip()

        result: dict[str, Optional[float]] = {
            "bleu": None,
            "rouge_l": None,
            "cer": None,
            "semantic_similarity": None,
            "perplexity": None,
        }

        try:
            result["bleu"] = _bleu(ref, hyp)
        except Exception as exc:
            logger.warning("BLEU failed: %s", exc)

        try:
            result["rouge_l"] = _rouge_l(ref, hyp)
        except Exception as exc:
            logger.warning("ROUGE-L failed: %s", exc)

        try:
            result["cer"] = _cer(ref, hyp)
        except Exception as exc:
            logger.warning("CER failed: %s", exc)

        try:
            result["semantic_similarity"] = _semantic_similarity(ref, hyp)
        except Exception as exc:
            logger.warning("Semantic similarity failed: %s", exc)

        try:
            result["perplexity"] = _perplexity(hyp)
        except Exception as exc:
            logger.warning("Perplexity failed: %s", exc)

        return result

    def check_answers(self, df: pd.DataFrame) -> pd.DataFrame:
        validate_required_columns(df, ["model_answer", "true_answer"])
        rows = [
            self.check_single_answer(r["model_answer"], r["true_answer"])
            for _, r in df.iterrows()
        ]
        for key in ("bleu", "rouge_l", "cer", "semantic_similarity", "perplexity"):
            df[key] = [r[key] for r in rows]
        return df
