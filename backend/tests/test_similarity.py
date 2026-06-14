"""
Tests for similarity metrics judge.

Covers:
  - _cer            — pure Levenshtein, no external deps
  - _bleu           — requires nltk
  - _rouge_l        — requires rouge-score
  - _semantic_similarity — requires sentence-transformers (mocked for speed)
  - _perplexity     — requires torch + transformers (mocked; skipped if absent)
  - SimilarityJudge.check_single_answer / check_answers

Run with:
    pytest tests/test_similarity.py -v
"""

from __future__ import annotations

import math
import sys
import types
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

# ── stub heavy third-party modules so import doesn't fail without them ─────────

def _stub(name: str, **attrs) -> types.ModuleType:
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    return mod

for _n, _m in [
    ("cryptography",        _stub("cryptography")),
    ("cryptography.fernet", _stub("cryptography.fernet", Fernet=object)),
    ("anthropic",           _stub("anthropic", AuthenticationError=Exception, NotFoundError=Exception, Anthropic=object)),
    ("google",              _stub("google")),
    ("google.genai",        _stub("google.genai", Client=object)),
    ("openai",              _stub("openai", OpenAI=object, APIError=Exception)),
]:
    sys.modules.setdefault(_n, _m)

from core.judges.similarity import (
    SimilarityJudge,
    _bleu,
    _cer,
    _rouge_l,
    _semantic_similarity,
    _perplexity,
)

# ══════════════════════════════════════════════════════════════════════════════
# CER — pure Python, no deps
# ══════════════════════════════════════════════════════════════════════════════

class TestCER:
    def test_identical(self):
        assert _cer("hello", "hello") == 0.0

    def test_completely_different(self):
        # edit distance = len(hypothesis) substitutions, CER = edits / len(ref)
        assert _cer("abc", "xyz") == 1.0

    def test_one_insertion(self):
        # ref="cat" hyp="cats" → 1 insertion → 1/3
        assert _cer("cat", "cats") == pytest.approx(1 / 3)

    def test_one_deletion(self):
        # ref="cats" hyp="cat" → 1 deletion → 1/4
        assert _cer("cats", "cat") == pytest.approx(1 / 4)

    def test_one_substitution(self):
        # ref="cat" hyp="bat" → 1 sub → 1/3
        assert _cer("cat", "bat") == pytest.approx(1 / 3)

    def test_empty_hypothesis(self):
        # deleting every char of ref: edits = len(ref) → CER = 1.0
        assert _cer("hello", "") == 1.0

    def test_empty_reference_denominator_guard(self):
        # max(len(ref), 1) = 1 to avoid division by zero
        result = _cer("", "hello")
        assert result == pytest.approx(5.0)

    def test_lower_is_better(self):
        good = _cer("the cat sat on the mat", "the cat sat on the mat")
        bad  = _cer("the cat sat on the mat", "xxxxxxxxxxxxxxxxxxx")
        assert good < bad


# ══════════════════════════════════════════════════════════════════════════════
# BLEU — requires nltk
# ══════════════════════════════════════════════════════════════════════════════

class TestBLEU:
    def test_perfect_match(self):
        score = _bleu("the cat sat on the mat", "the cat sat on the mat")
        assert score == pytest.approx(1.0)

    def test_zero_for_no_overlap(self):
        score = _bleu("the cat sat on the mat", "dogs swim in blue rivers")
        assert score == 0.0

    def test_partial_overlap(self):
        score = _bleu("the cat sat on the mat", "the cat sat")
        assert 0.0 < score < 1.0

    def test_higher_is_better(self):
        good = _bleu("Paris is the capital of France", "Paris is the capital of France")
        bad  = _bleu("Paris is the capital of France", "Tokyo Japan rice fish")
        assert good > bad

    def test_range(self):
        for ref, hyp in [
            ("hello world", "hello world"),
            ("foo bar baz", "baz bar foo"),
            ("short", "completely different sentence here"),
        ]:
            score = _bleu(ref, hyp)
            assert 0.0 <= score <= 1.0, f"Out of range for ({ref!r}, {hyp!r}): {score}"


# ══════════════════════════════════════════════════════════════════════════════
# ROUGE-L — requires rouge-score
# ══════════════════════════════════════════════════════════════════════════════

class TestROUGEL:
    def test_perfect_match(self):
        score = _rouge_l("the cat sat on the mat", "the cat sat on the mat")
        assert score == pytest.approx(1.0)

    def test_zero_overlap(self):
        score = _rouge_l("the cat sat on the mat", "dogs swim in blue rivers")
        assert score == pytest.approx(0.0)

    def test_partial_overlap(self):
        score = _rouge_l("the cat sat on the mat", "the cat")
        assert 0.0 < score < 1.0

    def test_higher_is_better(self):
        good = _rouge_l("summary of the document", "summary of the document")
        bad  = _rouge_l("summary of the document", "completely unrelated text here")
        assert good > bad

    def test_range(self):
        for ref, hyp in [
            ("hello world", "hello world"),
            ("a b c d e", "e d c b a"),
            ("the quick brown fox", "lazy dog"),
        ]:
            score = _rouge_l(ref, hyp)
            assert 0.0 <= score <= 1.0


# ══════════════════════════════════════════════════════════════════════════════
# Semantic Similarity — mocked (sentence-transformers is heavy)
# ══════════════════════════════════════════════════════════════════════════════

def _unit_vec(n=384) -> np.ndarray:
    v = np.ones(n, dtype=np.float32)
    return v / np.linalg.norm(v)


class TestSemanticSimilarity:
    def test_identical_vectors_give_1(self):
        v = _unit_vec()
        with patch("core.judges.similarity._get_semantic_model") as mock_get:
            mock_get.return_value.encode.return_value = np.stack([v, v])
            score = _semantic_similarity("hello", "hello")
        assert score == pytest.approx(1.0, abs=1e-5)

    def test_orthogonal_vectors_give_0(self):
        a = np.zeros(4, dtype=np.float32); a[0] = 1.0
        b = np.zeros(4, dtype=np.float32); b[1] = 1.0
        with patch("core.judges.similarity._get_semantic_model") as mock_get:
            mock_get.return_value.encode.return_value = np.stack([a, b])
            score = _semantic_similarity("cat", "democracy")
        assert score == pytest.approx(0.0, abs=1e-5)

    def test_similar_returns_high_score(self):
        v1 = _unit_vec()
        v2 = _unit_vec()
        v2[0] += 0.01; v2 /= np.linalg.norm(v2)
        with patch("core.judges.similarity._get_semantic_model") as mock_get:
            mock_get.return_value.encode.return_value = np.stack([v1, v2])
            score = _semantic_similarity("cat", "kitten")
        assert score > 0.9

    def test_range(self):
        v1 = _unit_vec(); v2 = _unit_vec() * 0.8
        v2 /= np.linalg.norm(v2)
        with patch("core.judges.similarity._get_semantic_model") as mock_get:
            mock_get.return_value.encode.return_value = np.stack([v1, v2])
            score = _semantic_similarity("a", "b")
        assert -1.0 <= score <= 1.0


# ══════════════════════════════════════════════════════════════════════════════
# Perplexity — mocked (torch/transformers are heavy)
# ══════════════════════════════════════════════════════════════════════════════

class TestPerplexity:
    def _mock_gpt2(self, loss_value: float):
        """Returns a context manager that patches _get_perplexity_model."""
        import torch as _torch
        mock_model = MagicMock()
        mock_model.return_value.loss = _torch.tensor(loss_value)
        mock_tokenizer = MagicMock()
        mock_tokenizer.return_value = {"input_ids": _torch.zeros(1, 5, dtype=_torch.long)}
        return patch("core.judges.similarity._get_perplexity_model", return_value=(mock_model, mock_tokenizer))

    def test_loss_converts_to_exp(self):
        pytest.importorskip("torch")
        import torch
        loss = 2.3
        mock_model = MagicMock()
        mock_model.return_value.loss = torch.tensor(loss)
        mock_tokenizer = MagicMock()
        mock_tokenizer.return_value = {"input_ids": torch.zeros(1, 5, dtype=torch.long)}
        with patch("core.judges.similarity._get_perplexity_model", return_value=(mock_model, mock_tokenizer)):
            result = _perplexity("hello world")
        assert result == pytest.approx(math.exp(loss), rel=1e-4)

    def test_returns_none_when_model_unavailable(self):
        with patch("core.judges.similarity._get_perplexity_model", return_value=(None, None)):
            assert _perplexity("hello world") is None

    def test_returns_none_on_exception(self):
        mock_model = MagicMock(side_effect=RuntimeError("CUDA OOM"))
        with patch("core.judges.similarity._get_perplexity_model", return_value=(mock_model, MagicMock())):
            assert _perplexity("hello") is None


# ══════════════════════════════════════════════════════════════════════════════
# SimilarityJudge — integration (mocks heavy models, real BLEU/ROUGE/CER)
# ══════════════════════════════════════════════════════════════════════════════

def _patch_heavy(sem_score: float = 0.9):
    """Patch sentence-transformers and GPT-2 so judge tests don't need GPU."""
    v1 = _unit_vec(); v2 = v1 * sem_score; v2 /= np.linalg.norm(v2)
    sem_mock = MagicMock()
    sem_mock.encode.return_value = np.stack([v1, v2])
    return (
        patch("core.judges.similarity._get_semantic_model", return_value=sem_mock),
        patch("core.judges.similarity._get_perplexity_model", return_value=(None, None)),
    )


class TestSimilarityJudge:
    def test_check_single_answer_keys(self):
        p1, p2 = _patch_heavy()
        with p1, p2:
            result = SimilarityJudge().check_single_answer(
                model_answer="The capital of France is Paris.",
                true_answer="Paris is the capital of France.",
            )
        assert set(result.keys()) == {"bleu", "rouge_l", "cer", "semantic_similarity", "perplexity"}

    def test_perfect_answer_high_scores(self):
        text = "the capital of france is paris"
        p1, p2 = _patch_heavy(sem_score=1.0)
        with p1, p2:
            result = SimilarityJudge().check_single_answer(
                model_answer=text, true_answer=text,
            )
        assert result["bleu"]   == pytest.approx(1.0)
        assert result["rouge_l"] == pytest.approx(1.0)
        assert result["cer"]    == pytest.approx(0.0)

    def test_bad_answer_low_scores(self):
        p1, p2 = _patch_heavy(sem_score=0.1)
        with p1, p2:
            result = SimilarityJudge().check_single_answer(
                model_answer="dolphins are mammals",
                true_answer="the capital of france is paris",
            )
        assert result["bleu"]   < 0.3
        assert result["rouge_l"] < 0.3
        assert result["cer"]    > 0.5

    def test_check_answers_adds_columns(self):
        df = pd.DataFrame([
            {"model_answer": "Paris is the capital.",  "true_answer": "Paris is the capital of France."},
            {"model_answer": "Tokyo is in Japan.",     "true_answer": "Tokyo is the capital of Japan."},
        ])
        p1, p2 = _patch_heavy()
        with p1, p2:
            result = SimilarityJudge().check_answers(df)
        for col in ("bleu", "rouge_l", "cer", "semantic_similarity", "perplexity"):
            assert col in result.columns, f"Missing column: {col}"

    def test_check_answers_row_count_preserved(self):
        df = pd.DataFrame([
            {"model_answer": f"answer {i}", "true_answer": f"reference {i}"}
            for i in range(5)
        ])
        p1, p2 = _patch_heavy()
        with p1, p2:
            result = SimilarityJudge().check_answers(df)
        assert len(result) == 5

    def test_check_answers_values_in_range(self):
        df = pd.DataFrame([
            {"model_answer": "the cat sat on the mat", "true_answer": "the cat sat on the mat"},
            {"model_answer": "completely irrelevant",  "true_answer": "the cat sat on the mat"},
        ])
        p1, p2 = _patch_heavy()
        with p1, p2:
            result = SimilarityJudge().check_answers(df)
        for col in ("bleu", "rouge_l"):
            vals = result[col].dropna()
            assert (vals >= 0.0).all() and (vals <= 1.0).all(), f"{col} out of [0,1]"
        cer_vals = result["cer"].dropna()
        assert (cer_vals >= 0.0).all()

    def test_missing_column_raises(self):
        df = pd.DataFrame([{"model_answer": "foo"}])  # no true_answer
        with pytest.raises(Exception):
            SimilarityJudge().check_answers(df)

    def test_perplexity_none_when_model_unavailable(self):
        df = pd.DataFrame([{"model_answer": "hello", "true_answer": "hello"}])
        sem_mock = MagicMock()
        sem_mock.encode.return_value = np.stack([_unit_vec(), _unit_vec()])
        with patch("core.judges.similarity._get_semantic_model", return_value=sem_mock), \
             patch("core.judges.similarity._get_perplexity_model", return_value=(None, None)):
            result = SimilarityJudge().check_answers(df)
        assert result["perplexity"].iloc[0] is None
