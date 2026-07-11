"""Reproducible fraud-risk model training utilities."""

import sys


if sys.version_info < (3, 11):
    raise RuntimeError("sust_ml requires Python 3.11 or newer")

__version__ = "1.0.0"
