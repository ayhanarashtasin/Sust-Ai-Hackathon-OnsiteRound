from __future__ import annotations

import argparse
from pathlib import Path

if __package__:
    from .sust_ml.pipeline import train
else:  # Supports direct execution as: python ml/train.py
    from sust_ml.pipeline import train


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train and export an offline binary risk model")
    parser.add_argument("--features", required=True, type=Path, help="Node-produced feature CSV")
    parser.add_argument("--labels", required=True, type=Path, help="Node-produced label CSV")
    parser.add_argument("--out", required=True, type=Path, help="Artifact output directory")
    parser.add_argument(
        "--model-type",
        choices=("auto", "lightgbm", "xgboost"),
        default="auto",
        help="auto trains LightGBM and compares XGBoost when installed",
    )
    return parser


def main() -> int:
    parser = build_parser()
    arguments = parser.parse_args()
    try:
        manifest = train(arguments.features, arguments.labels, arguments.out, arguments.model_type)
    except (OSError, ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    model = manifest["model"]
    onnx_status = manifest["artifacts"]["onnx_model"]["status"]
    print(
        f"Champion: {model['type']} | threshold={model['threshold']:.10g} | "
        f"ONNX={onnx_status} | artifacts={arguments.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
