from __future__ import annotations

import hashlib
import importlib
import json
import platform
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

from . import __version__
from .data import LoadedDataset, load_dataset
from .metrics import classification_metrics, select_f1_threshold


RANDOM_SEED = 20260711


@dataclass
class Candidate:
    name: str
    estimator: Any
    validation_probabilities: np.ndarray
    validation_metrics: dict[str, Any]
    parameters: dict[str, Any]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _module_version(name: str) -> str | None:
    try:
        return str(importlib.import_module(name).__version__)
    except (ImportError, AttributeError):
        return None


def _class_weight(labels: np.ndarray) -> float:
    positives = int(np.sum(labels == 1))
    negatives = int(np.sum(labels == 0))
    if positives == 0 or negatives == 0:
        raise ValueError("Training split must contain both classes")
    return negatives / positives


def _fit_lightgbm(x_train: Any, y_train: np.ndarray, x_validation: Any) -> tuple[Any, np.ndarray, dict[str, Any]]:
    try:
        from lightgbm import LGBMClassifier
    except ImportError as exc:
        raise RuntimeError("LightGBM is required; install ml/requirements.txt") from exc

    parameters = {
        "objective": "binary",
        "n_estimators": 300,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "subsample": 1.0,
        "colsample_bytree": 1.0,
        "reg_lambda": 1.0,
        "scale_pos_weight": _class_weight(y_train),
        "random_state": RANDOM_SEED,
        "n_jobs": 1,
        "deterministic": True,
        "force_col_wise": True,
        "verbosity": -1,
    }
    estimator = LGBMClassifier(**parameters)
    estimator.fit(x_train, y_train)
    probabilities = estimator.predict_proba(x_validation)[:, 1]
    return estimator, probabilities, parameters


def _fit_xgboost(x_train: Any, y_train: np.ndarray, x_validation: Any) -> tuple[Any, np.ndarray, dict[str, Any]]:
    try:
        from xgboost import XGBClassifier
    except ImportError as exc:
        raise RuntimeError("XGBoost is not installed") from exc

    parameters = {
        "objective": "binary:logistic",
        "n_estimators": 300,
        "learning_rate": 0.05,
        "max_depth": 6,
        "min_child_weight": 1,
        "subsample": 1.0,
        "colsample_bytree": 1.0,
        "reg_lambda": 1.0,
        "scale_pos_weight": _class_weight(y_train),
        "random_state": RANDOM_SEED,
        "n_jobs": 1,
        "tree_method": "hist",
        "eval_metric": "logloss",
    }
    estimator = XGBClassifier(**parameters)
    estimator.fit(x_train, y_train, verbose=False)
    probabilities = estimator.predict_proba(x_validation)[:, 1]
    return estimator, probabilities, parameters


def _train_candidate(
    name: str,
    x_train: Any,
    y_train: np.ndarray,
    x_validation: Any,
    y_validation: np.ndarray,
) -> Candidate:
    if name == "lightgbm":
        estimator, probabilities, parameters = _fit_lightgbm(x_train, y_train, x_validation)
    elif name == "xgboost":
        estimator, probabilities, parameters = _fit_xgboost(x_train, y_train, x_validation)
    else:
        raise ValueError(f"Unsupported model type: {name}")
    return Candidate(
        name=name,
        estimator=estimator,
        validation_probabilities=probabilities,
        validation_metrics=classification_metrics(y_validation, probabilities, 0.5),
        parameters=parameters,
    )


def _save_native(candidate: Candidate, output_dir: Path) -> Path:
    if candidate.name == "lightgbm":
        path = output_dir / "model.lightgbm.txt"
        candidate.estimator.booster_.save_model(str(path))
    else:
        path = output_dir / "model.xgboost.json"
        candidate.estimator.get_booster().save_model(str(path))
    return path


def _export_onnx(candidate: Candidate, feature_count: int, output_dir: Path) -> dict[str, Any]:
    path = output_dir / "model.onnx"
    if path.exists():
        path.unlink()
    try:
        import onnx
        from onnxmltools import convert_lightgbm, convert_xgboost
        from onnxmltools.convert.common.data_types import FloatTensorType

        initial_types = [("features", FloatTensorType([None, feature_count]))]
        if candidate.name == "lightgbm":
            converted = convert_lightgbm(candidate.estimator, initial_types=initial_types, target_opset=15, zipmap=False)
        else:
            converted = convert_xgboost(candidate.estimator, initial_types=initial_types, target_opset=15)
        onnx.checker.check_model(converted)
        path.write_bytes(converted.SerializeToString())
        return {
            "status": "exported",
            "path": path.name,
            "sha256": _sha256(path),
            "opset": 15,
            "input_name": "features",
            "input_shape": [None, feature_count],
            "input_dtype": "float32",
        }
    except Exception as exc:  # Conversion support varies by converter and dependency version.
        return {
            "status": "skipped",
            "reason": f"{type(exc).__name__}: {exc}",
            "required_packages": ["onnx", "onnxmltools", "skl2onnx"],
        }


def _feature_importance(candidate: Candidate, feature_order: list[str]) -> list[dict[str, Any]]:
    if candidate.name == "lightgbm":
        values = candidate.estimator.booster_.feature_importance(importance_type="gain").astype(float)
    else:
        raw = candidate.estimator.get_booster().get_score(importance_type="gain")
        values = np.array(
            [float(raw.get(name, raw.get(f"f{index}", 0.0))) for index, name in enumerate(feature_order)]
        )
    total = float(values.sum())
    entries = [
        {
            "feature": name,
            "gain": float(values[index]),
            "normalized_gain": float(values[index] / total) if total else 0.0,
        }
        for index, name in enumerate(feature_order)
    ]
    return sorted(entries, key=lambda item: (-item["gain"], feature_order.index(item["feature"])))


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="ascii")


def _write_ascii_text(path: Path, value: str) -> None:
    path.write_text(value.encode("ascii", errors="backslashreplace").decode("ascii"), encoding="ascii")


def _split_metadata(dataset: LoadedDataset) -> dict[str, Any]:
    result: dict[str, Any] = {
        "method": "preassigned" if dataset.split_column else "chronological_60_20_20",
        "split_column": dataset.split_column,
        "chronological_column": dataset.chronological_column,
        "counts": {name: int(len(indices)) for name, indices in dataset.split_indices.items()},
    }
    return result


def _model_card(
    champion: Candidate,
    threshold: float,
    evaluation: dict[str, Any],
    dataset: LoadedDataset,
    onnx_result: dict[str, Any],
) -> str:
    validation = evaluation["champion"]["validation"]
    test = evaluation["champion"]["test"]
    candidates = "\n".join(
        f"| {name} | {details.get('status', 'trained')} | {details.get('validation_pr_auc', 'n/a')} |"
        for name, details in evaluation["candidates"].items()
    )
    return f"""# Model Card

## Overview

- Package version: {__version__}
- Champion: {champion.name}
- Selection rule: highest validation PR-AUC, with LightGBM winning exact ties
- Decision threshold: {threshold:.10g} (maximum validation F1)
- Random seed: {RANDOM_SEED}
- Intended use: offline hackathon liquidity or unusual-activity decision support

## Data Contract

- Target column: `{dataset.target_column}`
- Alignment: `{dataset.alignment}`
- Split method: `{_split_metadata(dataset)['method']}`
- Chronological column: `{dataset.chronological_column or 'not supplied'}`
- Feature count: {len(dataset.feature_order)}
- Feature order: {', '.join(f'`{name}`' for name in dataset.feature_order)}
- Missing numeric values are passed to the tree model; positive and negative infinity are converted to missing values.

## Candidate Selection

| Model | Status | Validation PR-AUC |
| --- | --- | ---: |
{candidates}

## Champion Metrics

| Split | Precision | Recall | F1 | PR-AUC | FPR | FNR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Validation | {validation['precision']:.6f} | {validation['recall']:.6f} | {validation['f1']:.6f} | {validation['pr_auc']:.6f} | {validation['fpr']:.6f} | {validation['fnr']:.6f} |
| Test | {test['precision']:.6f} | {test['recall']:.6f} | {test['f1']:.6f} | {test['pr_auc'] if test['pr_auc'] is not None else 'n/a'} | {test['fpr'] if test['fpr'] is not None else 'n/a'} | {test['fnr'] if test['fnr'] is not None else 'n/a'} |

PR-AUC is sklearn average precision. FPR is FP / (FP + TN), and FNR is FN / (FN + TP).

## Artifacts

- Native model: always exported
- ONNX: {onnx_result['status']}{f" ({onnx_result.get('reason')})" if onnx_result['status'] != 'exported' else ''}
- Use `manifest.json` as the authoritative inference schema and checksum record.

## Limitations

- Validation and test performance depends on the supplied chronological period and label quality.
- Numeric features only; categorical values must be encoded by the Node feature producer using a stable contract.
- Class imbalance is handled with training-set `scale_pos_weight`; predicted probabilities may not be calibrated.
- The threshold is optimized for validation F1 and should be reviewed against operational false-positive costs.
"""


def train(features_path: Path, labels_path: Path, output_dir: Path, model_type: str) -> dict[str, Any]:
    if model_type not in {"auto", "lightgbm", "xgboost"}:
        raise ValueError("model_type must be auto, lightgbm, or xgboost")
    dataset = load_dataset(features_path, labels_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    for stale_name in ("model.lightgbm.txt", "model.xgboost.json", "model.onnx"):
        stale_path = output_dir / stale_name
        if stale_path.exists():
            stale_path.unlink()

    train_indices = dataset.split_indices["train"]
    validation_indices = dataset.split_indices["validation"]
    test_indices = dataset.split_indices["test"]
    x_train = dataset.features.iloc[train_indices]
    y_train = dataset.labels[train_indices]
    x_validation = dataset.features.iloc[validation_indices]
    y_validation = dataset.labels[validation_indices]

    requested = [model_type] if model_type != "auto" else ["lightgbm", "xgboost"]
    candidates: list[Candidate] = []
    candidate_results: dict[str, Any] = {}
    for name in requested:
        try:
            candidate = _train_candidate(name, x_train, y_train, x_validation, y_validation)
            candidates.append(candidate)
            candidate_results[name] = {
                "status": "trained",
                "validation_pr_auc": candidate.validation_metrics["pr_auc"],
                "metrics_at_0_5": candidate.validation_metrics,
                "parameters": candidate.parameters,
            }
        except RuntimeError as exc:
            if model_type != "auto" or name == "lightgbm":
                raise
            candidate_results[name] = {"status": "unavailable", "reason": str(exc)}

    champion = max(
        candidates,
        key=lambda item: (float(item.validation_metrics["pr_auc"]), item.name == "lightgbm"),
    )
    threshold = select_f1_threshold(y_validation, champion.validation_probabilities)
    validation_metrics = classification_metrics(y_validation, champion.validation_probabilities, threshold)
    test_probabilities = champion.estimator.predict_proba(dataset.features.iloc[test_indices])[:, 1]
    test_metrics = classification_metrics(dataset.labels[test_indices], test_probabilities, threshold)

    native_path = _save_native(champion, output_dir)
    onnx_result = _export_onnx(champion, len(dataset.feature_order), output_dir)
    importance = {
        "model_type": champion.name,
        "importance_type": "gain",
        "features": _feature_importance(champion, dataset.feature_order),
    }
    evaluation = {
        "metric_definition": {
            "pr_auc": "sklearn average_precision_score",
            "fpr": "FP / (FP + TN)",
            "fnr": "FN / (FN + TP)",
        },
        "selection": "maximum validation PR-AUC; LightGBM wins exact ties",
        "threshold_selection": "maximum validation F1; ties use recall, precision, then lower threshold",
        "candidates": candidate_results,
        "champion": {
            "model_type": champion.name,
            "threshold": threshold,
            "validation": validation_metrics,
            "test": test_metrics,
        },
    }
    evaluation_path = output_dir / "evaluation.json"
    importance_path = output_dir / "feature_importance.json"
    model_card_path = output_dir / "MODEL_CARD.md"
    _write_json(evaluation_path, evaluation)
    _write_json(importance_path, importance)
    _write_ascii_text(
        model_card_path,
        _model_card(champion, threshold, evaluation, dataset, onnx_result),
    )
    artifacts: dict[str, Any] = {
        "native_model": {"path": native_path.name, "sha256": _sha256(native_path)},
        "onnx_model": onnx_result,
        "evaluation": {"path": evaluation_path.name, "sha256": _sha256(evaluation_path)},
        "feature_importance": {"path": importance_path.name, "sha256": _sha256(importance_path)},
        "model_card": {"path": model_card_path.name, "sha256": _sha256(model_card_path)},
    }
    manifest = {
        "manifest_version": "1.0",
        "package_version": __version__,
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "python_version": platform.python_version(),
        "random_seed": RANDOM_SEED,
        "model": {
            "type": champion.name,
            "native_format": "LightGBM text" if champion.name == "lightgbm" else "XGBoost JSON",
            "parameters": champion.parameters,
            "selection_metric": "validation_pr_auc",
            "threshold": threshold,
            "positive_class": 1,
            "class_imbalance": {
                "method": "scale_pos_weight",
                "value": _class_weight(y_train),
            },
        },
        "schema": {
            "input_tensor_dtype": "float32",
            "feature_order": dataset.feature_order,
            "source_feature_dtypes": dataset.feature_dtypes,
            "target_column": dataset.target_column,
            "id_column": dataset.id_column,
            "alignment": dataset.alignment,
        },
        "split": _split_metadata(dataset),
        "inputs": {
            "features": {"path": str(features_path), "sha256": _sha256(features_path)},
            "labels": {"path": str(labels_path), "sha256": _sha256(labels_path)},
        },
        "libraries": {
            "numpy": _module_version("numpy"),
            "pandas": _module_version("pandas"),
            "scikit_learn": _module_version("sklearn"),
            "lightgbm": _module_version("lightgbm"),
            "xgboost": _module_version("xgboost"),
            "onnx": _module_version("onnx"),
            "onnxmltools": _module_version("onnxmltools"),
        },
        "artifacts": artifacts,
    }

    _write_json(output_dir / "manifest.json", manifest)
    return manifest
