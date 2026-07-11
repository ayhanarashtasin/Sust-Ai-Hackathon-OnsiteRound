import numpy as np
import pandas as pd
import pytest

from ml.sust_ml.data import make_chronological_split


def test_timestamp_split_is_chronological_and_deterministic():
    frame = pd.DataFrame(
        {
            "timestamp": [
                "2026-01-05T00:00:00Z",
                "2026-01-01T00:00:00Z",
                "2026-01-03T00:00:00Z",
                "2026-01-02T00:00:00Z",
                "2026-01-10T00:00:00Z",
                "2026-01-04T00:00:00Z",
                "2026-01-09T00:00:00Z",
                "2026-01-08T00:00:00Z",
                "2026-01-06T00:00:00Z",
                "2026-01-07T00:00:00Z",
            ]
        }
    )

    first = make_chronological_split(frame, chronological_column="timestamp")
    second = make_chronological_split(frame, chronological_column="timestamp")

    assert first["train"].tolist() == [1, 3, 2, 5, 0, 8]
    assert first["validation"].tolist() == [9, 7]
    assert first["test"].tolist() == [6, 4]
    for name in first:
        np.testing.assert_array_equal(first[name], second[name])


def test_preassigned_split_aliases_are_supported():
    frame = pd.DataFrame(
        {
            "split": ["training", "train", "train", "val", "validation", "test"],
            "timestamp": pd.date_range("2026-01-01", periods=6, tz="UTC"),
        }
    )
    result = make_chronological_split(frame, "timestamp", "split")
    assert result["train"].tolist() == [0, 1, 2]
    assert result["validation"].tolist() == [3, 4]
    assert result["test"].tolist() == [5]


def test_preassigned_split_rejects_non_chronological_assignment():
    frame = pd.DataFrame({"split": ["train", "validation", "train", "test", "test"]})
    with pytest.raises(ValueError, match="not chronological"):
        make_chronological_split(frame, split_column="split")
