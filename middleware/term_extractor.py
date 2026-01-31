#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
术语表智能提取器 (Term Extractor) v4.1
基于 fugashi 固有名詞检测 + 片假名人名提取

核心技术:
- fugashi: MeCab 日语分词器
- 固有名詞: 直接检测人名/地名/组织名词性
- 片假名人名: 智能提取带中点的完整人名

安装依赖:
pip install fugashi unidic-lite
"""

import re
import json
import sys
import argparse
import os
import zipfile
from html.parser import HTMLParser
from collections import Counter, defaultdict
from typing import List, Dict, Set, Optional


class EPUBTextExtractor(HTMLParser):
    """Simple HTML parser to extract text from EPUB content files"""
    def __init__(self):
        super().__init__()
        self.text_parts = []
        self._in_body = False
        self._skip_tags = {'script', 'style', 'head', 'meta', 'link', 'title'}
        self._current_tag = None
    
    def handle_starttag(self, tag, attrs):
        self._current_tag = tag.lower()
        if self._current_tag == 'body':
            self._in_body = True
    
    def handle_endtag(self, tag):
        if tag.lower() == 'body':
            self._in_body = False
        # Add newlines for block elements
        if tag.lower() in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'):
            self.text_parts.append('\n')
        self._current_tag = None
    
    def handle_data(self, data):
        if self._current_tag not in self._skip_tags:
            text = data.strip()
            if text:
                self.text_parts.append(text)
    
    def get_text(self) -> str:
        return ' '.join(self.text_parts)


def extract_epub_text(epub_path: str) -> str:
    """Extract text content from EPUB file (ZIP archive with XHTML content)"""
    text_parts = []
    try:
        with zipfile.ZipFile(epub_path, 'r') as zf:
            # Find all HTML/XHTML content files
            content_files = [
                name for name in zf.namelist() 
                if name.endswith(('.html', '.xhtml', '.htm')) 
                and 'META-INF' not in name
            ]
            # Sort to maintain reading order (best effort)
            content_files.sort()
            
            for cf in content_files:
                try:
                    content = zf.read(cf).decode('utf-8', errors='ignore')
                    parser = EPUBTextExtractor()
                    parser.feed(content)
                    text = parser.get_text()
                    if text.strip():
                        text_parts.append(text)
                except Exception as e:
                    print(f"[TermExtractor] Warning: Failed to parse {cf}: {e}", file=sys.stderr)
                    
    except zipfile.BadZipFile:
        print(f"[TermExtractor] Error: Invalid EPUB file (not a valid ZIP archive)", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"[TermExtractor] Error reading EPUB: {e}", file=sys.stderr)
        return ""
    
    return '\n\n'.join(text_parts)


def extract_ass_text(ass_path: str) -> str:
    """Extract only dialogue text from ASS file"""
    lines = []
    try:
        # Try different encodings
        content = ""
        for enc in ['utf-8-sig', 'utf-16', 'gbk', 'utf-8']:
            try:
                with open(ass_path, 'r', encoding=enc) as f:
                    content = f.read()
                if content:
                    print(f"[TermExtractor] Read ASS with encoding: {enc} ({len(content)} chars)", file=sys.stderr)
                    break
            except:
                continue
        
        if not content:
            return ""

        for line in content.splitlines():
            if line.startswith('Dialogue:'):
                parts = line.split(',', 9)
                if len(parts) > 9:
                    text = parts[9]
                    # Strip ASS tags like {\pos(1,2)} or {\k10}
                    text = re.sub(r'\{[^}]+\}', '', text)
                    # Strip ASS newline \N
                    text = text.replace(r'\N', '\n').replace(r'\n', '\n')
                    lines.append(text)
    except Exception as e:
        print(f"[TermExtractor] Error reading ASS: {e}", file=sys.stderr)
    
    return '\n'.join(lines)


def extract_srt_text(srt_path: str) -> str:
    """Extract only text from SRT file"""
    lines = []
    try:
        content = ""
        for enc in ['utf-8-sig', 'utf-16', 'gbk', 'utf-8']:
            try:
                with open(srt_path, 'r', encoding=enc) as f:
                    content = f.read()
                if content:
                    print(f"[TermExtractor] Read SRT with encoding: {enc} ({len(content)} chars)", file=sys.stderr)
                    break
            except:
                continue

        if not content:
            return ""

        # Simple SRT parsing: ignore numbers and timecodes
        blocks = re.split(r'\n\s*\n', content)
        for block in blocks:
            parts = block.strip().splitlines()
            if len(parts) >= 3:
                # Part 0 is index, Part 1 is timecode, Part 2+ is text
                lines.extend(parts[2:])
    except Exception as e:
        print(f"[TermExtractor] Error reading SRT: {e}", file=sys.stderr)
    
    return '\n'.join(lines)


def read_input_file(filepath: str) -> str:
    """Read input file, auto-detecting format (TXT or EPUB)"""
    ext = os.path.splitext(filepath)[1].lower()
    
    if ext == '.epub':
        print("[TermExtractor] Detected EPUB format, extracting text...", file=sys.stderr)
        return extract_epub_text(filepath)
    elif ext == '.ass':
        print("[TermExtractor] Detected ASS format, extracting dialogue...", file=sys.stderr)
        return extract_ass_text(filepath)
    elif ext == '.srt':
        print("[TermExtractor] Detected SRT format, extracting text...", file=sys.stderr)
        return extract_srt_text(filepath)
    else:
        # Default: treat as plain text
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()


# 导入 fugashi
FUGASHI_AVAILABLE = False
try:
    import fugashi
    import unidic_lite
    FUGASHI_AVAILABLE = True
    print(f"[TermExtractor] fugashi loaded (Dictionary: {unidic_lite.DICDIR})", file=sys.stderr)
except ImportError as e:
    print(f"[TermExtractor] ERROR: Dependency missing! {e}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
except Exception as e:
    print(f"[TermExtractor] ERROR: Failed to initialize fugashi/unidic: {e}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)


class TermExtractor:
    """基于 fugashi 固有名詞的术语提取器 v4.0"""
    
    STOPWORDS = {
        # --- 代词 (Pronouns) ---
        "私", "俺", "僕", "彼", "彼女", "あなた", "君", "自分", "奴", "あいつ", "そいつ", 
        "こいつ", "我々", "彼ら", "これ", "それ", "あれ", "どこ", "どちら", "こっち", 
        "そっち", "あっち", "誰", "何", "皆様", "自分自身",

        # --- 身体部位 (Body Parts) ---
        "両手", "右手", "左手", "片手", "手首", "手足", "手のひら", "指先", "拳", "掌",
        "両足", "右足", "左足", "片膝", "両膝", "足首", "太もも", "爪先", "踵",
        "背中", "背筋", "胸元", "下腹", "心臓", "首筋", "喉元", "肩口", "脇腹",
        "頭部", "口元", "目元", "耳元", "片目", "両目", "髪の毛", "黒髪", "銀髪", "金髪",
        "笑み", "半身", "根元", "眉間", "鼻先", "頬", "脳裏", "視界", "鼓動", "五指",

        # --- 形容词/色彩 (Adjectives & Colors) ---
        "白い", "黒い", "赤い", "青い", "黄色い", "緑の", "真っ赤", "漆黒", "白地", "白銀", 
        "黄金", "金色", "透明", "鮮やか", "暗い", "明るい", "深い", "浅い", "凄まじい", 
        "莫大", "巨大", "微か", "詳細", "特殊", "一般的", "純白", "深紅", "蒼い",

        # --- 数量词/时间/程度 (Quantifiers & Time) ---
        "一度", "二度", "一歩", "三人", "四人", "五千人", "六人", "七人", "二隻", "三隻",
        "八つ", "三つ", "四つ", "二名", "両翼", "十年前", "半年前", "数日", "数分", 
        "数秒", "数年", "数回", "何度も", "幾つか", "半分", "全部", "唯一", "一瞬", 
        "瞬間", "同時", "直後", "直前", "毎日", "今回", "前回", "最初", "最後",

        # --- 称谓/职业/身份 (Titles & Roles) ---
        "様", "殿下", "閣下", "卿", "王", "女王", "王子", "王女", "陛下", "聖女", "勇者",
        "騎士", "剣士", "宰相", "貴族", "艦長", "従士", "水兵", "商人", "継承者", "冒険者",
        "水兵たち", "兵たち", "兵士", "将軍", "指揮官", "護衛", "近衛", "配下", "部下",
        "亜人", "善人", "組織", "ギルド", "村長", "宿屋", "執事", "メイド", "魔術師",

        # --- 常见名词 (Common Nouns) ---
        "世界", "時間", "場所", "言葉", "今日", "明日", "人間", "太陽", "月光", "星空",
        "ひとびと", "猫耳", "王族", "決闘", "三日月", "長柄", "八方", "太平", "運命",
        "記憶", "感情", "意志", "理由", "目的", "現実", "真実", "未来", "過去", "状況",
        "景色", "存在", "中心", "表面", "気配", "魔法", "魔力", "能力", "スキル",

        # --- 常见物品 (Katakana Items) ---
        "ナイフ", "ズボン", "ベッド", "ワイン", "テント", "シャツ", "ロープ", "ガラス", 
        "シルク", "グライダー", "ハーネス", "マント", "ベルト", "ドレス", "コート", 
        "タイツ", "ローブ", "リボン", "ボタン", "エプロン", "スカート", "ケーブル", 
        "ランタン", "プロペラ", "エンジン", "ハンマー", "スコップ", "スパナ", "フック", 
        "データ", "イベント", "スペース", "テーブル", "クッション", "ジュース", "ビール", 
        "バター", "ステーキ", "スパイス", "レモン", "イチゴ", "ナッツ", "ピンク", "ガウン",
        "コック", "コップ", "ルール", "ライン", "パーツ", "ケース", "オート", "スプーン", 
        "ウイスキー", "アルコール", "ビスケット", "ブルーベリー", "ネックレス", "アーモンド", 
        "ダイヤモンド", "スラックス", "エール", "スタイル", "タイミング", "バランス", 
        "デメリット", "メリット", "モンスター", "ハープ", "リュート", "ギター", "ピアノ",
        "バッグ", "カメラ", "ボール", "キーボード", "マウス", "スクリーン", "ショップ",

        # --- 拟声词/拟态词 (Onomatopoeia & Mimetic) ---
        "ギィエェェ", "グルルゥゥ", "ギャーギャー", "ゲラゲラ", "トントン", "パキパキ", 
        "ベタベタ", "ジャーン", "キィッ", "シュッ", "イライラ", "オッケー", "チュー", 
        "ガーゼ", "ピンチ", "ワクワク", "ドキドキ", "ニコニコ", "ニヤニヤ", "フラフラ", 
        "ボロボロ", "ピカピカ", "シーン", "ガチャン", "バタバタ", "ゾクゾク", "フワフワ",
    }
    
    # 常见动物/生物
    COMMON_NOUNS = {
        "カラス", "フクロウ", "カエル", "ウズラ", "ミミズ", "ナメクジ", "ハリネズミ", 
        "ロブスター", "スズメバチ", "オオカミ", "ウサギ", "キツネ", "クマ", "ヘビ", 
        "ネズミ", "コウモリ", "チョウ", "トンボ", "クジラ", "イルカ", "ペンギン", 
        "トカゲ", "馬", "鹿", "猪", "猿",
    }
    
    def __init__(self, top_k: int = 500):
        self.top_k = top_k
        self.tagger = None
        
        if FUGASHI_AVAILABLE:
            try:
                # 显式指向 unidic-lite 的字典目录，这对打包后的便携式环境至关重要
                import unidic_lite
                import os
                
                # MeCab 在 Windows 下对路径非常敏感，将反斜杠转换为正斜杠
                raw_dic_dir = unidic_lite.DICDIR
                dic_dir = raw_dic_dir.replace('\\', '/')
                
                print(f"[TermExtractor] Initializing Tagger with dic_dir: {dic_dir}", file=sys.stderr)
                
                # 检查字典文件是否存在
                sys_dic = os.path.join(raw_dic_dir, 'sys.dic')
                if not os.path.exists(sys_dic):
                    print(f"[TermExtractor] ERROR: sys.dic not found in {raw_dic_dir}!", file=sys.stderr)
                
                # 尝试初始化
                try:
                    self.tagger = fugashi.Tagger(f'-d "{dic_dir}"')
                    # 测试运行，确保 MeCab 的 DLL 和字典能正常工作
                    t_token = list(self.tagger("测试"))
                    print(f"[TermExtractor] Tagger initialized (unidic-lite, Test: {len(t_token)} tokens)", file=sys.stderr)
                except Exception as e:
                    print(f"[TermExtractor] MeCab Error during path init: {e}", file=sys.stderr)
                    # 尝试不带引号的路径 (如果路径没有空格)
                    if ' ' not in dic_dir:
                        self.tagger = fugashi.Tagger(f'-d {dic_dir}')
                        print("[TermExtractor] Tagger initialized successfully (no quotes)", file=sys.stderr)
                    else:
                        raise e
            except Exception as e:
                print(f"[TermExtractor] Warning: Failed to initialize Tagger with unidic-lite: {e}", file=sys.stderr)
                print(f"[TermExtractor] Python Path: {sys.path}", file=sys.stderr)
                if FUGASHI_AVAILABLE:
                    print(f"[TermExtractor] fugashi location: {fugashi.__file__}", file=sys.stderr)
                
                import traceback
                traceback.print_exc(file=sys.stderr)
                # Fallback to default
                try:
                    print("[TermExtractor] Falling back to default Tagger...", file=sys.stderr)
                    self.tagger = fugashi.Tagger()
                    # 测试运行
                    t_token = list(self.tagger("测试"))
                    print(f"[TermExtractor] Default Tagger initialized (Test: {len(t_token)} tokens)", file=sys.stderr)
                except Exception as fe:
                    print(f"[TermExtractor] Default Tagger also failed: {fe}", file=sys.stderr)
                    self.tagger = None
        else:
            print("[TermExtractor] fugashi NOT available, skipping dictionary extraction", file=sys.stderr)
    
    def _clean_ruby(self, text: str) -> str:
        """清理注音"""
        text = re.sub(r'([一-龯々]+)《[^》]+》', r'\1', text)
        text = re.sub(r'([一-龯々]+)（[^）]+）', r'\1', text)
        text = re.sub(r'([一-龯々]+)\([^\)]+\)', r'\1', text)
        return text
    
    def _is_valid(self, text: str) -> bool:
        """检查是否有效"""
        if not text or len(text) < 2 or len(text) > 15:
            return False
        if text in self.STOPWORDS or text in self.COMMON_NOUNS:
            return False
        
        # === 1. 注音残留检测 ===
        # 汉字+平假名结尾 (如 遙はる, 仰あお, 丁てい寧)
        if re.match(r'^.*[一-龯々][ぁ-ん]{1,4}$', text):
            return False
        # 平假名开头 (如 ぐ蓮, ぐアルテミシア)
        if re.match(r'^[ぁ-ん]{1,2}[一-龯々ァ-ヶ]', text):
            return False
        # 带空格的注音残留
        if re.search(r'[一-龯]\s+[ぁ-んァ-ン]', text):
            return False
        
        # === 2. 拟声词/拟态词检测 (ABAB 或 AABB 模式) ===
        # 如: ギリギリ, ゴタゴタ, ガンガン, ピカピカ
        if re.match(r'^([ァ-ヶ]{2})\1$', text):  # ABAB
            return False
        if re.match(r'^([ァ-ヶ])\1([ァ-ヶ])\2$', text):  # AABB  
            return False
        # 扩展拟声词: ニョキニョキ, ニコニコ 等
        if re.match(r'^[ァ-ヶ]{2,3}[ァ-ヶ]{2,3}$', text) and text[:len(text)//2] == text[len(text)//2:]:
            return False
        
        # === 3. 明显普通词后缀 (仅最常见的) ===
        # 只过滤非常明确的普通词后缀，保留可能是人名的
        obvious_common = r'(ション|ング|ティー|メント|ライン|ライト|システム|プロセス|メニュー|レベル|グループ|スポーツ|サービス)$'
        if re.search(obvious_common, text) and '・' not in text and len(text) <= 8:
            return False
        
        # === 4. 短词过滤 ===
        # 纯片假名短词 (3字以下容易误判)
        if re.match(r'^[ァ-ヶー]+$', text) and len(text) <= 3 and '・' not in text:
            return False
        # 纯平假名短词
        if re.match(r'^[ぁ-ん]+$', text) and len(text) < 4:
            return False
        
        # === 5. 纯数字 ===
        if re.match(r'^[\d０-９]+$', text):
            return False
        
        # === 6. 度量衡 ===
        if re.search(r'(メートル|センチ|キロ|グラム|リットル)$', text):
            return False
        
        return True
    
    def _is_katakana(self, text: str) -> bool:
        return bool(re.match(r'^[ァ-ヶー・]+$', text)) and len(text) >= 3
    
    def _extract_katakana_names(self, text: str) -> Dict[str, Dict]:
        """提取片假名人名"""
        entities = {}
        text = self._clean_ruby(text)
        
        # 带中点的完整人名 (最高优先级)
        for m in re.finditer(r'([ァ-ヶー]+(?:・[ァ-ヶー]+)+)', text):
            name = m.group(1).strip('・')
            if len(name) >= 4 and self._is_valid(name):
                if name not in entities:
                    entities[name] = {'src': name, 'dst': ' ', 'category': 'Person', 'count': 0}
                entities[name]['count'] += 1
        
        return entities
    
    def _extract_with_fugashi(self, text: str, progress_callback=None) -> Dict[str, Dict]:
        """使用 fugashi 固有名詞提取"""
        if not self.tagger:
            return {}
        
        entities = {}
        text = self._clean_ruby(text)
        lines = text.split('\n')
        total = len(lines)
        
        for idx, line in enumerate(lines):
            if not line.strip():
                continue
            
            try:
                current = []
                current_type = None
                
                for word in self.tagger(line):
                    surface = word.surface
                    pos1 = getattr(word.feature, 'pos1', '')
                    pos2 = getattr(word.feature, 'pos2', '')
                    
                    is_proper = pos2 == '固有名詞'
                    is_person = '人名' in str(word.feature)
                    is_place = '地名' in str(word.feature)
                    is_org = '組織' in str(word.feature)
                    is_katakana = self._is_katakana(surface) and len(surface) >= 3
                    
                    if is_proper or is_person or is_place or is_org or is_katakana:
                        current.append(surface)
                        if is_person:
                            current_type = 'Person'
                        elif is_place:
                            current_type = 'Location'
                        elif is_org:
                            current_type = 'Organization'
                        elif is_katakana:
                            current_type = current_type or 'Name'
                        else:
                            current_type = current_type or 'Name'
                    else:
                        if current:
                            name = ''.join(current)
                            if self._is_valid(name):
                                if name not in entities:
                                    entities[name] = {
                                        'src': name,
                                        'dst': ' ',
                                        'category': current_type or 'Name',
                                        'count': 0
                                    }
                                entities[name]['count'] += 1
                            current = []
                            current_type = None
                
                # 处理行尾
                if current:
                    name = ''.join(current)
                    if self._is_valid(name):
                        if name not in entities:
                            entities[name] = {
                                'src': name,
                                'dst': ' ',
                                'category': current_type or 'Name',
                                'count': 0
                            }
                        entities[name]['count'] += 1
                        
            except Exception:
                continue
            
            if progress_callback and idx % 100 == 0:
                progress_callback(0.1 + idx / total * 0.7)
        
        return entities
    
    def extract(self, text: str, progress_callback=None) -> List[Dict]:
        """主入口"""
        if progress_callback:
            progress_callback(0.05)
        
        all_entities = {}
        
        # 方法1: 片假名人名 (优先)
        katakana_entities = self._extract_katakana_names(text)
        all_entities.update(katakana_entities)
        katakana_count = len(katakana_entities)
        
        if progress_callback:
            progress_callback(0.15)
        
        # 方法2: fugashi 固有名詞
        fugashi_count = 0
        if FUGASHI_AVAILABLE and self.tagger:
            fugashi_entities = self._extract_with_fugashi(text, progress_callback)
            fugashi_count = len(fugashi_entities)
            for name, data in fugashi_entities.items():
                if name not in all_entities:
                    all_entities[name] = data
                else:
                    all_entities[name]['count'] += data['count']
        else:
            reason = "Import failed (Check logs/environment)" if not FUGASHI_AVAILABLE else "Tagger init failed (Check MeCab dictionary path)"
            print(f"\n[TermExtractor] FATAL ERROR: {reason}", file=sys.stderr)
            print("[TermExtractor] Fugashi component is essential for extraction.", file=sys.stderr)
            sys.exit(1) # 强制失败，以便在 GUI 中弹出 AlertModal 显示诊断信息
        
        print(f"[TermExtractor] Stats: Katakana={katakana_count}, Fugashi={fugashi_count}", file=sys.stderr)
        
        if progress_callback:
            progress_callback(0.85)
        
        # 转换为列表并排序
        results = []
        for name, data in all_entities.items():
            results.append({
                'src': data['src'],
                'dst': ' ',
                'category': data['category'],
                'score': data['count'] * 10,
                'freq': data['count'],
            })
        
        # 按频率排序
        results.sort(key=lambda x: (-x['freq'], -len(x['src'])))
        
        # 去重: 移除被更长词包含的短词 (仅当短词频率较低时)
        final = []
        selected = set()
        
        for item in results:
            term = item['src']
            freq = item['freq']
            
            is_substring = False
            for s in selected:
                if term in s and term != s and freq < 5:
                    is_substring = True
                    break
            
            if not is_substring:
                selected.add(term)
                final.append(item)
        
        if progress_callback:
            progress_callback(1.0)
        
        return final[:self.top_k]


def main():
    parser = argparse.ArgumentParser(description='术语表智能提取器 v4.1 (fugashi + EPUB)')
    parser.add_argument('input', help='输入文件 (支持 .txt 和 .epub)')
    parser.add_argument('-k', '--top-k', type=int, default=500)
    parser.add_argument('-o', '--output', help='输出文件')
    parser.add_argument('--simple', action='store_true', help='简化输出')
    args = parser.parse_args()
    
    # Auto-detect file format (TXT/EPUB)
    text = read_input_file(args.input)
    print(f"[TermExtractor] Input content loaded: {len(text)} characters", file=sys.stderr)
    
    if not text.strip():
        print("[TermExtractor] Error: No text content extracted from file", file=sys.stderr)
        print(json.dumps([]))  # Return empty result
        sys.exit(1)
    
    extractor = TermExtractor(top_k=args.top_k)
    
    def progress_cb(p):
        print(f"[PROGRESS] {p:.1%}", file=sys.stderr)
    
    results = extractor.extract(text, progress_callback=progress_cb)
    print(f"[TermExtractor] Extraction success: {len(results)} terms found", file=sys.stderr)
    
    if args.simple:
        output = [{'src': r['src'], 'dst': ' '} for r in results]
    else:
        output = results
    
    json_str = json.dumps(output, ensure_ascii=False, indent=2)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(json_str)
        print(f"[TermExtractor] Saved {len(results)} terms", file=sys.stderr)
    else:
        print(json_str)


if __name__ == '__main__':
    main()
