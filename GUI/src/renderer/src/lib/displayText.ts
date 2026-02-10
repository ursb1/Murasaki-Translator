const SYSTEM_MARKER_TOKEN =
  '(?:@(?:id|end)\\s*=\\s*\\d+@|\\[(?:id|end)\\s*=\\s*\\d+\\]|\\{(?:id|end)\\s*=\\s*\\d+\\}|<(?:id|end)\\s*=\\s*\\d+>)'

const SYSTEM_LEADING_MARKER_RE = new RegExp(`^\\s*(?:${SYSTEM_MARKER_TOKEN}\\s*)+`, 'i')
const SYSTEM_TRAILING_MARKER_RE = new RegExp(`(?:\\s*${SYSTEM_MARKER_TOKEN})+\\s*$`, 'i')

export function stripSystemMarkersForDisplay(text: string) {
  if (!text) return text
  return text
    .split('\n')
    .map(line => line.replace(SYSTEM_LEADING_MARKER_RE, '').replace(SYSTEM_TRAILING_MARKER_RE, ''))
    .join('\n')
}
