"""Text Chunker - Splits input text into translation-sized blocks."""

from typing import List
from dataclasses import dataclass

@dataclass
class TextBlock:
    """分块数据类"""
    id: int
    prompt_text: str  # 用于 Prompt 的文本

class Chunker:
    def __init__(self, target_chars: int = 1200, max_chars: int = 2000, mode: str = "doc", 
                 enable_balance: bool = True, balance_threshold: float = 0.6, balance_range: int = 3):
        self.target_chars = target_chars
        self.max_chars = max_chars
        self.mode = mode
        self.enable_balance = enable_balance
        self.balance_threshold = balance_threshold
        self.balance_range = balance_range

    def process(self, lines: List[str]) -> List[TextBlock]:
        if self.mode == "line":
            return self._process_line_by_line(lines)
        else:
            return self._process_rubber_band(lines)

    def _process_line_by_line(self, lines: List[str]) -> List[TextBlock]:
        """
        Mode: Line (Identity Strategy)
        每一行（非空）作为一个独立的 Block。
        """
        blocks = []
        for line in lines:
            text = line.strip()
            if text:
                blocks.append(TextBlock(id=len(blocks)+1, prompt_text=text))
        return blocks

    def _process_rubber_band(self, lines: List[str]) -> List[TextBlock]:
        """
        Mode: Doc (Rubber Band Strategy)
        智能合并多行，通过标点符号寻找最佳切分点。
        """
        blocks = []
        current_chunk = []
        current_char_count = 0
        
        # 安全断句符号
        SAFE_PUNCTUATION = ['。', '！', '？', '……', '”', '」', '\n']

        for line in lines:
            line_stripped = line.strip()
            # 累积
            current_chunk.append(line)
            current_char_count += len(line)
            
            # 检查是否满足切分条件
            # 1. 超过目标长度 (或接近目标长度前30字) 且 遇到标点
            # 2. 超过最大强制长度
            if current_char_count >= (self.target_chars - 30):
                if any(line_stripped.endswith(p) for p in SAFE_PUNCTUATION) or current_char_count >= self.max_chars:
                   self._create_block(blocks, current_chunk)
                   current_chunk = []
                   current_char_count = 0
        
        # 处理剩余内容
        if current_chunk:
             # 创建最后一个块
             self._create_block(blocks, current_chunk)
             
        # 平衡最后几个块 (Tail Balancing)
        if self.enable_balance and len(blocks) >= 2:
            self._balance_tail(blocks)
            
        return blocks
    
    def _create_block(self, blocks: List[TextBlock], lines: List[str]):
        """Helper to create a block"""
        text = "".join(lines)
        if not text.strip():
            return
        blocks.append(TextBlock(id=len(blocks)+1, prompt_text=text))

    def _balance_tail(self, blocks: List[TextBlock]):
        """
        Configurable Tail Balancing
        If the last block is too small (below threshold), merge it with previous N blocks
        and redistribute the content evenly.
        """
        # Determine how many blocks to involve (min of existing blocks and configured range)
        n = min(len(blocks), self.balance_range)
        if n < 2: return

        last = blocks[-1]
        
        # Check if balancing is triggered
        # Trigger if last block size < target * threshold
        if len(last.prompt_text) >= self.target_chars * self.balance_threshold:
            return # No balancing needed

        # debug_print = print  # Replace with logging if available
        # debug_print(f"[Chunker] Balancing triggered. Last block {len(last.prompt_text)} < {self.target_chars * self.balance_threshold}")

        # 1. Merge the last N blocks
        tail_blocks = blocks[-n:]
        combined_text = "".join([b.prompt_text for b in tail_blocks])
        lines = combined_text.splitlines(keepends=True)
        
        total_len = sum(len(l) for l in lines)
        ideal_len_per_block = total_len // n
        
        # 2. Redistribute into N chunks
        new_texts = []
        current_lines = []
        current_len = 0
        
        for line in lines:
            current_lines.append(line)
            current_len += len(line)
            
            # If we reached ideal length (and we are not filling the very last slot yet)
            if len(new_texts) < n - 1:
                # Greedy split: if we reached or exceeded the ideal size
                if current_len >= ideal_len_per_block:
                    # Decide whether to split here or wait (simple greedy is usually fine)
                    new_texts.append("".join(current_lines))
                    current_lines = []
                    current_len = 0
        
        # Add remaining content as the last chunk
        if current_lines:
            new_texts.append("".join(current_lines))
        
        # If logical split resulted in fewer chunks than N (very rare edge case if greedy logic is tight),
        # validation isn't strictly necessary as long as we put content back.
        # But we must ensure we don't change the number of blocks in the list if we can avoid it, 
        # OR we just update the content of the tail blocks.
        
        # 3. Update the blocks in place
        start_idx = len(blocks) - n
        for i in range(n):
             original_idx = start_idx + i
             if i < len(new_texts):
                blocks[original_idx].prompt_text = new_texts[i]
             else:
                # Clear redundant blocks if re-chunking resulted in fewer pieces
                blocks[original_idx].prompt_text = ""
                # Note: We keep the block ID to avoid breaking UI indices, 
                # but empty text won't be sent or processed usually.
                # If we really want to delete them, we'd need to rebuild the list, 
                # but that's risky for concurrent logic waiting on IDs.
