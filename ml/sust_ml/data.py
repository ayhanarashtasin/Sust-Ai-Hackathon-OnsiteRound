from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np
import pandas as pd
from pandas.api.types import is_bool_dtype, is_numeric_dtype


TARGET_CANDIDATES = (
    "label",
    "target",
    "y",
    "is_fraud",
    "is_anomaly",
    "fraud_label",
)
ID_CANDIDATES = (
    "transaction_id",
    "transactionid",
    "txn_id",
    "txnid",
    "record_id",
    "row_id",
    "id",
)
TIME_CANDIDATES = (
    "timestamp",
    "event_timestamp",
    "event_time",
    "created_at",
    "datetime",
    "date",
    "time",
)
SPLIT_CANDIDATES = ("split", "dataset_split", "data_split")


@dataclass(frozen=True)
class LoadedDataset:
    features: pd.DataFrame
    labels: np.ndarray
    feature_order: list[str]
    feature_dtypes: dict[str, str]
    split_indices: dict[str, np.ndarray]
    target_column: str
    id_column: str | None
    chronological_column: str | None
    split_column: str | None
    alignment: str


def _normalized(value: str) -> str:
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def _column_lookup(columns: Sequence[str]) -> dict[str, str]:
    return {_normalized(column): column for column in columns}


def _find_column(columns: Sequence[str], candidates: Sequence[str]) -> str | None:
    lookup = _column_lookup(columns)
    return next((lookup[name] for name in candidates if name in lookup), None)


def _read_csv(path: Path, kind: str) -> pd.DataFrame:
    if not path.is_file():
        raise ValueError(f"{kind} CSV does not exist: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        header = next(csv.reader(handle), None)
    if not header:
        raise ValueError(f"{kind} CSV has no header: {path}")
    normalized_header = [_normalized(column) for column in header]
    duplicates = sorted({name for name in normalized_header if normalized_header.count(name) > 1})
    if duplicates:
        raise ValueError(f"{kind} CSV has duplicate columns: {', '.join(duplicates)}")
    frame = pd.read_csv(path)
    if frame.empty:
        raise ValueError(f"{kind} CSV has no rows: {path}")
    return frame


def _binary_labels(series: pd.Series) -> np.ndarray:
    if series.isna().any():
        raise ValueError("Label column contains missing values")
    if is_bool_dtype(series):
        result = series.astype(np.int8).to_numpy()
    elif is_numeric_dtype(series):
        values = set(series.astype(float).unique().tolist())
        if not values.issubset({0.0, 1.0}):
            raise ValueError(f"Labels must be binary 0/1; found {sorted(values)}")
        result = series.astype(np.int8).to_numpy()
    else:
        true_values = {"1", "true", "yes", "positive", "fraud", "anomaly"}
        false_values = {"0", "false", "no", "negative", "legitimate", "normal"}
        normalized = series.astype(str).str.strip().str.lower()
        unknown = sorted(set(normalized) - true_values - false_values)
        if unknown:
            raise ValueError(f"Labels must be binary; unknown values: {unknown}")
        result = normalized.isin(true_values).astype(np.int8).to_numpy()
    return result


def validate_feature_schema(frame: pd.DataFrame, feature_order: Sequence[str]) -> dict[str, str]:
    if not feature_order:
        raise ValueError("No model features remain after excluding ID, time, and split columns")
    missing = [column for column in feature_order if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing feature columns: {missing}")
    invalid = [
        column
        for column in feature_order
        if not (is_numeric_dtype(frame[column]) or is_bool_dtype(frame[column]))
    ]
    if invalid:
        raise ValueError(
            "All model features must be numeric for a stable ONNX contract; "
            f"non-numeric columns: {invalid}"
        )
    return {column: str(frame[column].dtype) for column in feature_order}


def _sortable_time(series: pd.Series, column: str) -> pd.Series:
    if series.isna().any():
        raise ValueError(f"Chronological column '{column}' contains missing values")
    if is_numeric_dtype(series):
        return series
    try:
        return pd.to_datetime(series, utc=True, errors="raise")
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Chronological column '{column}' is not parseable as time") from exc


def make_chronological_split(
    frame: pd.DataFrame,
    chronological_column: str | None = None,
    split_column: str | None = None,
) -> dict[str, np.ndarray]:
    """Return stable positional indices for train, validation, and test sets."""
    if len(frame) < 5:
        raise ValueError("At least 5 rows are required for train/validation/test splitting")
    positions = pd.DataFrame({"_position": np.arange(len(frame), dtype=np.int64)})
    if chronological_column:
        positions["_time"] = _sortable_time(frame[chronological_column], chronological_column).to_numpy()
        positions = positions.sort_values(["_time", "_position"], kind="mergesort")

    if split_column:
        aliases = {
            "train": "train",
            "training": "train",
            "val": "validation",
            "valid": "validation",
            "validation": "validation",
            "test": "test",
            "testing": "test",
        }
        raw = frame[split_column].astype(str).str.strip().str.lower()
        unknown = sorted(set(raw) - set(aliases))
        if unknown:
            raise ValueError(f"Split column '{split_column}' has unknown values: {unknown}")
        normalized = raw.map(aliases)
        positions["_split"] = normalized.iloc[positions["_position"]].to_numpy()
        rank = positions["_split"].map({"train": 0, "validation": 1, "test": 2}).to_numpy()
        if np.any(rank[1:] < rank[:-1]):
            order_basis = chronological_column or "input row order"
            raise ValueError(f"Split column '{split_column}' is not chronological by {order_basis}")
        result = {
            name: positions.loc[positions["_split"] == name, "_position"].to_numpy(dtype=np.int64)
            for name in ("train", "validation", "test")
        }
        empty = [name for name, indices in result.items() if len(indices) == 0]
        if empty:
            raise ValueError(f"Split column '{split_column}' is missing sets: {empty}")
        return result

    if not chronological_column:
        raise ValueError(
            "Features CSV needs a split column or a chronological column such as 'timestamp'"
        )
    count = len(frame)
    train_end = max(1, min(count - 2, int(count * 0.60)))
    validation_end = max(train_end + 1, min(count - 1, int(count * 0.80)))
    ordered = positions["_position"].to_numpy(dtype=np.int64)
    return {
        "train": ordered[:train_end],
        "validation": ordered[train_end:validation_end],
        "test": ordered[validation_end:],
    }


def load_dataset(features_path: Path, labels_path: Path) -> LoadedDataset:
    feature_frame = _read_csv(features_path, "Features")
    label_frame = _read_csv(labels_path, "Labels")

    target_column = _find_column(label_frame.columns.tolist(), TARGET_CANDIDATES)
    if target_column is None and len(label_frame.columns) == 1:
        target_column = str(label_frame.columns[0])
    if target_column is None:
        raise ValueError(
            "Could not identify label column; use one of: " + ", ".join(TARGET_CANDIDATES)
        )

    feature_ids = _column_lookup(feature_frame.columns.tolist())
    label_ids = _column_lookup(label_frame.columns.tolist())
    shared_id_name = next(
        (candidate for candidate in ID_CANDIDATES if candidate in feature_ids and candidate in label_ids),
        None,
    )
    id_column = feature_ids[shared_id_name] if shared_id_name else _find_column(
        feature_frame.columns.tolist(), ID_CANDIDATES
    )

    if shared_id_name:
        feature_id = feature_ids[shared_id_name]
        label_id = label_ids[shared_id_name]
        if feature_frame[feature_id].isna().any() or label_frame[label_id].isna().any():
            raise ValueError(f"Shared ID column '{feature_id}' contains missing values")
        if feature_frame[feature_id].duplicated().any() or label_frame[label_id].duplicated().any():
            raise ValueError(f"Shared ID column '{feature_id}' must be unique in both CSVs")
        feature_keys = pd.Index(feature_frame[feature_id])
        label_keys = pd.Index(label_frame[label_id])
        missing_labels = feature_keys.difference(label_keys)
        extra_labels = label_keys.difference(feature_keys)
        if len(missing_labels) or len(extra_labels):
            raise ValueError(
                f"Feature/label ID mismatch: {len(missing_labels)} missing and "
                f"{len(extra_labels)} extra labels"
            )
        aligned_labels = label_frame.set_index(label_id).loc[feature_keys, target_column].reset_index(drop=True)
        alignment = f"id:{feature_id}"
    else:
        if len(feature_frame) != len(label_frame):
            raise ValueError(
                "Without a shared ID column, feature and label CSVs must have the same row count"
            )
        aligned_labels = label_frame[target_column].reset_index(drop=True)
        alignment = "row_order"

    split_column = _find_column(feature_frame.columns.tolist(), SPLIT_CANDIDATES)
    chronological_column = _find_column(feature_frame.columns.tolist(), TIME_CANDIDATES)
    split_indices = make_chronological_split(
        feature_frame,
        chronological_column=chronological_column,
        split_column=split_column,
    )

    excluded = {column for column in (id_column, split_column, chronological_column) if column}
    feature_order = [str(column) for column in feature_frame.columns if column not in excluded]
    feature_dtypes = validate_feature_schema(feature_frame, feature_order)
    model_features = feature_frame.loc[:, feature_order].astype(np.float32)
    model_features = model_features.replace([np.inf, -np.inf], np.nan)

    labels = _binary_labels(aligned_labels)
    for split_name in ("train", "validation"):
        classes = np.unique(labels[split_indices[split_name]])
        if len(classes) != 2:
            raise ValueError(f"{split_name} split must contain both label classes; found {classes.tolist()}")

    return LoadedDataset(
        features=model_features,
        labels=labels,
        feature_order=feature_order,
        feature_dtypes=feature_dtypes,
        split_indices=split_indices,
        target_column=target_column,
        id_column=id_column,
        chronological_column=chronological_column,
        split_column=split_column,
        alignment=alignment,
    )
