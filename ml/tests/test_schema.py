import pandas as pd
import pytest

from ml.sust_ml.data import validate_feature_schema


def test_schema_preserves_requested_feature_order():
    frame = pd.DataFrame({"amount": [1.0], "velocity": [2], "flag": [True]})
    order = ["velocity", "amount", "flag"]
    result = validate_feature_schema(frame, order)
    assert list(result) == order
    assert result["velocity"].startswith("int")


def test_schema_rejects_non_numeric_features():
    frame = pd.DataFrame({"amount": [1.0], "provider": ["bKash"]})
    with pytest.raises(ValueError, match="non-numeric.*provider"):
        validate_feature_schema(frame, ["amount", "provider"])


def test_schema_rejects_missing_columns():
    frame = pd.DataFrame({"amount": [1.0]})
    with pytest.raises(ValueError, match="velocity"):
        validate_feature_schema(frame, ["amount", "velocity"])
