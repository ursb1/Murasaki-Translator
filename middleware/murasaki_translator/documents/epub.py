"""EPUB Document Handler - HTML-Aware Container Mapping."""

import zipfile
import re
import io
import warnings
from bs4 import BeautifulSoup, NavigableString, XMLParsedAsHTMLWarning
from typing import List, Dict, Any, Optional
from .base import BaseDocument
from murasaki_translator.core.chunker import TextBlock

# Silence XML warnings
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

class EpubDocument(BaseDocument):
    # Atomic translatable containers
    CONTAINERS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "dt", "dd", "caption", "th")

    def __init__(self, path: str):
        super().__init__(path)

    def _get_parser(self, content: str = ""):
        """Pick the most robust parser for EPUB XHTML/XML."""
        is_xml = "<?xml" in content or "http://www.w3.org/1999/xhtml" in content
        try:
            import lxml
            return "xml" if is_xml else "lxml"
        except ImportError:
            return "xml" if is_xml else "html.parser"

    def _is_topmost_container(self, node):
        """Check if node is a target container and not nested inside another target container."""
        if node.name not in self.CONTAINERS:
            return False
        # If any parent is also in CONTAINERS, this is NOT the topmost one
        for parent in node.parents:
            if parent.name in self.CONTAINERS:
                return False
        return True

    def _cleanup_styles(self, dom):
        """Standardize styles (remove vertical writing)."""
        v_tokens = r'v-?rtl|v-?ltr|vertical-rl|vertical-lr'
        if dom.has_attr('class'):
            classes = dom.get('class', [])
            if isinstance(classes, list):
                new_classes = [c for c in classes if not re.search(v_tokens, c, re.IGNORECASE)]
                dom['class'] = new_classes if new_classes else []
            elif isinstance(classes, str):
                dom['class'] = re.sub(v_tokens, '', classes, flags=re.IGNORECASE).strip()

        if dom.has_attr('style'):
            style = dom['style']
            new_style = re.sub(r'writing-mode\s*:\s*[^;]+;?', '', style, flags=re.IGNORECASE)
            dom['style'] = new_style.strip()

    def _fix_svg_attributes(self, soup: BeautifulSoup):
        """Preserve case-sensitivity for SVG icons."""
        attr_fixes = {
            "viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio",
            "pathlength": "pathLength", "gradientunits": "gradientUnits",
            "gradienttransform": "gradientTransform", "spreadmethod": "spreadMethod",
            "maskcontentunits": "maskContentUnits", "maskunits": "maskUnits",
            "patterncontentunits": "patternContentUnits", "patternunits": "patternUnits",
            "patterntransform": "patternTransform",
        }
        for svg in soup.find_all("svg"):
            for attr_lower, attr_correct in attr_fixes.items():
                if attr_lower in svg.attrs:
                    svg.attrs[attr_correct] = svg.attrs.pop(attr_lower)
            for child in svg.find_all():
                for attr_lower, attr_correct in attr_fixes.items():
                    if attr_lower in child.attrs:
                        child.attrs[attr_correct] = child.attrs.pop(attr_lower)

    def load(self) -> List[Dict[str, Any]]:
        """Extract topmost containers while preserving inner HTML for tag protection."""
        items = []
        uid = 0
        try:
            with zipfile.ZipFile(self.path, 'r') as z:
                # Deterministic sort for zip paths
                for zip_path in sorted(z.namelist()):
                    lower_path = zip_path.lower()
                    if lower_path.endswith(('.htm', '.html', '.xhtml')):
                        try:
                            content = z.read(zip_path).decode('utf-8-sig', errors='ignore')
                            soup = BeautifulSoup(content, self._get_parser(content))
                            
                            # Preprocess Ruby (RT tags are not for translation)
                            for ruby in soup.find_all('ruby'):
                                for tag in ruby.find_all(['rt', 'rp']): tag.decompose()

                            # Extract topmost containers
                            for node in soup.find_all(self.CONTAINERS):
                                if self._is_topmost_container(node):
                                    # Use decode_contents to include internal tags (<a>, <b>, etc.)
                                    # These tags will be protected by TextProtector in main.py
                                    inner_html = node.decode_contents().strip()
                                    if inner_html:
                                        items.append({
                                            'text': f"@id={uid}@\n{inner_html}\n@end={uid}@\n",
                                            'meta': {
                                                'item_name': zip_path,
                                                'uid': uid
                                            }
                                        })
                                        uid += 1
                        except Exception as e:
                            pass  # Skip malformed files silently (logged in debug if needed)
                    elif lower_path.endswith('.ncx'):
                        try:
                            content = z.read(zip_path).decode('utf-8-sig', errors='ignore')
                            soup = BeautifulSoup(content, 'xml')
                            for node in soup.find_all('text'):
                                t = node.get_text(strip=True)
                                if t:
                                    items.append({
                                        'text': f"@id={uid}@\n{t}\n@end={uid}@\n",
                                        'meta': {'item_name': zip_path, 'uid': uid}
                                    })
                                    uid += 1
                        except: pass
        except Exception as e: print(f"[Error] load: {e}")
        return items

    def save(self, output_path: str, blocks: List[TextBlock]):
        """Point-to-Point Container Mapping."""
        id_to_text = {}
        anchor_re = re.compile(r"@id=(\d+)@([\s\S]*?)@end=\1@", re.MULTILINE)
        
        for block in blocks:
            content = getattr(block, 'prompt_text', '') or ''
            for uid_str, tag_content in anchor_re.findall(content):
                try: id_to_text[int(uid_str)] = tag_content.strip()
                except: pass

        try:
            with zipfile.ZipFile(self.path, 'r') as in_zip, \
                 zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_DEFLATED) as out_zip:
                
                # ENFORCE EPUB STANDARD: mimetype must be first and uncompressed
                if 'mimetype' in in_zip.namelist():
                    out_zip.writestr('mimetype', in_zip.read('mimetype'), compress_type=zipfile.ZIP_STORED)
                
                uid = 0
                for zip_path in sorted(in_zip.namelist()):
                    if zip_path == 'mimetype': continue
                    info = in_zip.getinfo(zip_path)
                    lower_path = zip_path.lower()
                    
                    if lower_path.endswith(('.htm', '.html', '.xhtml')):
                        raw_bytes = in_zip.read(info)
                        content = raw_bytes.decode('utf-8-sig', errors='ignore')
                        soup = BeautifulSoup(content, self._get_parser(content))
                        
                        # Match preprocessing
                        for ruby in soup.find_all('ruby'):
                            for tag in ruby.find_all(['rt', 'rp']): tag.decompose()
                        
                        # Re-traverse in SAME order
                        for node in soup.find_all(self.CONTAINERS):
                            if self._is_topmost_container(node):
                                if uid in id_to_text:
                                    # REPLACEMENT: Clear and inject translated inner HTML
                                    # Note: BeautifulSoup(text, 'html.parser') handles tag snippets correctly
                                    node.clear()
                                    new_content = BeautifulSoup(id_to_text[uid], 'html.parser')
                                    node.extend(new_content.contents)
                                uid += 1
                        
                        # Post-processing
                        for body in soup.find_all('body'): self._cleanup_styles(body)
                        for p in soup.find_all('p'): self._cleanup_styles(p)

                        if soup.head:
                            m = soup.head.find('meta', attrs={'charset': True})
                            if m: m['charset'] = 'utf-8'
                            else: soup.head.insert(0, soup.new_tag('meta', charset='utf-8'))
                        
                        self._fix_svg_attributes(soup)
                        
                        # XML COMPLIANCE
                        content_bytes = soup.encode('utf-8').lstrip()
                        if not content_bytes.startswith(b"<?xml"):
                            content_bytes = b'<?xml version="1.0" encoding="utf-8"?>\n' + content_bytes
                        out_zip.writestr(zip_path, content_bytes)
                        
                    elif lower_path.endswith('.ncx'):
                        content = in_zip.read(info).decode('utf-8-sig', errors='ignore')
                        soup = BeautifulSoup(content, 'xml')
                        for node in soup.find_all('text'):
                            if node.get_text(strip=True):
                                if uid in id_to_text:
                                    node.string = id_to_text[uid]
                                uid += 1
                        out_zip.writestr(zip_path, str(soup).encode('utf-8'))
                    else:
                        out_zip.writestr(info, in_zip.read(info))
            print("[Success] EPUB Surgery (HTML-Aware Container) complete.")
        except Exception as e:
            print(f"[Error] EPUB Surgery failed: {e}")
            raise e
