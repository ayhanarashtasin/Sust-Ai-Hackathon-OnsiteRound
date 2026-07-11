import numpy as np
import pytest

from ml.sust_ml.metrics import classification_metrics, select_f1_threshold


def test_metrics_include_required_rates_and_confusion_counts():
    labels = np.array([0, 0, 1, 1])
    probabilities = np.array([0.1, 0.8, 0.9, 0.4])
    result = classification_metrics(labels, probabilities, threshold=0.5)
    assert result["precision"] == pytest.approx(0.5)
    assert result["recall"] == pytest.approx(0.5)
    assert result["f1"] == pytest.approx(0.5)
    assert result["pr_auc"] == pytest.approx(5 / 6)
    assert result["fpr"] == pytest.approx(0.5)
    assert result["fnr"] == pytest.approx(0.5)
    assert result["confusion_matrix"] == {"tn": 1, "fp": 1, "fn": 1, "tp": 1}


def test_threshold_selection_is_deterministic_and_maximizes_f1():
    labels = np.array([0, 0, 1, 1])
    probabilities = np.array([0.1, 0.4, 0.6, 0.9])
    first = select_f1_threshold(labels, probabilities)
    second = select_f1_threshold(labels, probabilities)
    assert first == second == pytest.approx(0.5)
    assert classification_metrics(labels, probabilities, first)["f1"] == pytest.approx(1.0)


def test_metrics_report_undefined_fpr_as_null_equivalent():
    result = classification_metrics(np.array([1, 1]), np.array([0.9, 0.2]), 0.5)
    assert result["fpr"] is None
    assert result["fnr"] == pytest.approx(0.5)
