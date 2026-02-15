"""Pipeline V2 entrypoint."""

from __future__ import annotations

import argparse
import os
import sys

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.pipelines.runner import PipelineRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Murasaki Flow V2")
    parser.add_argument("--file", required=True, help="Input file path")
    parser.add_argument("--pipeline", required=True, help="Pipeline profile id or path")
    parser.add_argument("--profiles-dir", required=True, help="Base directory for profiles")
    parser.add_argument("--output", help="Custom output path")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"[Error] Input file not found: {args.file}")
        return 1

    store = ProfileStore(args.profiles_dir)
    pipeline_profile = store.load_profile("pipeline", args.pipeline)

    print(f"[FlowV2] Provider: {pipeline_profile.get('provider')}")
    print(f"[FlowV2] Prompt: {pipeline_profile.get('prompt')}")
    print(f"[FlowV2] Parser: {pipeline_profile.get('parser')}")
    print(f"[FlowV2] LinePolicy: {pipeline_profile.get('line_policy')}")
    print(f"[FlowV2] ChunkPolicy: {pipeline_profile.get('chunk_policy')}")

    runner = PipelineRunner(store, pipeline_profile)
    output_path = runner.run(args.file, output_path=args.output)
    print(f"[FlowV2] Output saved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
