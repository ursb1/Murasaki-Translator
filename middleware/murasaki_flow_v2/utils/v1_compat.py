"""Deprecated compatibility wrapper.

This module remains for legacy imports but delegates to the V2 processing
implementation to avoid V1 coupling.
"""

from __future__ import annotations

from murasaki_flow_v2.utils.processing import (  # noqa: F401
    ProcessingOptions as V1CompatOptions,
    ProcessingProcessor as V1CompatProcessor,
    build_protect_patterns,
    load_glossary,
    load_rules,
)

__all__ = [
    "V1CompatOptions",
    "V1CompatProcessor",
    "build_protect_patterns",
    "load_glossary",
    "load_rules",
]
