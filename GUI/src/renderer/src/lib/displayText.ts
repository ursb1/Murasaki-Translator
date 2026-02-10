// 仅移除系统结构控制符（显示层），不改动原始数据。
// 支持：@id=1@ / @@id=1@@ / [id=1] / {id=1} / <id=1> 以及同类 key=value 控制符。
// 约束：必须是独立 token（行首/行尾/空白边界），避免误伤普通文本（如邮箱、社交 @提及）。
const SYSTEM_MARKER_TOKEN =
  '(?:@{1,2}[a-zA-Z][\\w-]{0,31}\\s*=\\s*[^@\\s]{1,80}@{1,2}|\\[[a-zA-Z][\\w-]{0,31}\\s*=\\s*[^\\]\\s]{1,80}\\]|\\{[a-zA-Z][\\w-]{0,31}\\s*=\\s*[^\\}\\s]{1,80}\\}|<[a-zA-Z][\\w-]{0,31}\\s*=\\s*[^>\\s]{1,80}>)'

const SYSTEM_LEADING_MARKER_RE = new RegExp(`^\\s*(?:${SYSTEM_MARKER_TOKEN}[\\s\\u3000]*)+`, 'g')
const SYSTEM_TRAILING_MARKER_RE = new RegExp(`(?:[\\s\\u3000]*${SYSTEM_MARKER_TOKEN})+\\s*$`, 'g')
const SYSTEM_INLINE_MARKER_RE = new RegExp(`(^|[\\s\\u3000])(${SYSTEM_MARKER_TOKEN})(?=[\\s\\u3000]|$)`, 'g')

export function stripSystemMarkersForDisplay(text: string) {
  if (!text) return text
  return text
    .split('\n')
    .map(line => line
      .replace(SYSTEM_LEADING_MARKER_RE, '')
      .replace(SYSTEM_TRAILING_MARKER_RE, '')
      .replace(SYSTEM_INLINE_MARKER_RE, '$1')
    )
    .join('\n')
}
