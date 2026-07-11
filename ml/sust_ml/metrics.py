from __future__ import annotations

from typing import Any

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)


def classification_metrics(
    labels: np.ndarray,
    probabilities: np.ndarray,
    threshold: float,
) -> dict[str, Any]:
    labels = np.asarray(labels, dtype=np.int8)
    probabilities = np.asarray(probabilities, dtype=float)
    if labels.ndim != 1 or probabilities.ndim != 1 or len(labels) != len(probabilities):
        raise ValueError("Labels and probabilities must be one-dimensional arrays of equal length")
    if len(labels) == 0:
        raise ValueError("Metrics require at least one row")
    if not set(np.unique(labels)).issubset({0, 1}):
        raise ValueError("Labels must contain only 0 and 1")
    if not np.isfinite(probabilities).all():
        raise ValueError("Probabilities must be finite")
    if np.any((probabilities < 0.0) | (probabilities > 1.0)):
        raise ValueError("Probabilities must be between 0 and 1")
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("Threshold must be between 0 and 1")

    predictions = (probabilities >= threshold).astype(np.int8)
    tn, fp, fn, tp = confusion_matrix(labels, predictions, labels=[0, 1]).ravel()
    negative_count = int(tn + fp)
    positive_count = int(tp + fn)
    pr_auc = float(average_precision_score(labels, probabilities)) if positive_count else None
    return {
        "threshold": float(threshold),
        "precision": float(precision_score(labels, predictions, zero_division=0)),
        "recall": float(recall_score(labels, predictions, zero_division=0)),
        "f1": float(f1_score(labels, predictions, zero_division=0)),
        "pr_auc": pr_auc,
        "fpr": float(fp / negative_count) if negative_count else None,
        "fnr": float(fn / positive_count) if positive_count else None,
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "support": {"negative": negative_count, "positive": positive_count},
    }


def select_f1_threshold(labels: np.ndarray, probabilities: np.ndarray) -> float:
    """Choose validation F1 threshold, then recall, precision, and lower threshold on ties."""
    labels = np.asarray(labels, dtype=np.int8)
    probabilities = np.asarray(probabilities, dtype=float)
    candidates = np.unique(np.concatenate((probabilities, np.array([0.5]))))
    candidates = candidates[(candidates >= 0.0) & (candidates <= 1.0)]
    if not len(candidates):
        raise ValueError("No valid threshold candidates")

    def score(threshold: float) -> tuple[float, float, float, float]:
        result = classification_metrics(labels, probabilities, float(threshold))
        return (result["f1"], result["recall"], result["precision"], -float(threshold))

    return float(max(candidates, key=score))
