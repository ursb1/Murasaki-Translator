# Line alignment utilities for Pipeline V2.

from __future__ import annotations

from typing import List


def align_lines(src: List[str], dst: List[str]) -> List[str]:
    if not src:
        return list(dst)
    if not dst:
        return [""] * len(src)

    result: List[str] = []
    dst_index = 0
    dst_len = len(dst)

    for line in src:
        if line.strip() == "":
            if dst_index < dst_len and dst[dst_index].strip() == "":
                dst_index += 1
            result.append("")
            continue
        if dst_index < dst_len:
            result.append(dst[dst_index])
            dst_index += 1
        else:
            result.append("")

    # 当 dst 还有剩余行时，将多余内容用空格拼接到最后一个非空结果行
    # 避免注入 \n 导致后续按行分割时行数再次不匹配
    if dst_index < dst_len and result:
        remaining = [r for r in dst[dst_index:] if r.strip()]
        if remaining:
            for i in range(len(result) - 1, -1, -1):
                if result[i].strip():
                    result[i] = result[i] + " " + " ".join(remaining)
                    break

    return result
