/**
 * XML escaping utilities for safe XML/HTML content injection
 */

const XML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
}

/**
 * Escape a string for safe use in XML/HTML content.
 * Replaces: & < > " '
 */
export function escape(str: string): string {
  if (!str) return ""
  return str.replace(/[&<>"']/g, (char) => XML_ESCAPE_MAP[char] || char)
}

/**
 * Wrap content in CDATA section for safe XML inclusion.
 * Escapes nested ]]> by using the standard CDATA escape sequence.
 */
export function cdata(str: string): string {
  if (!str) return "<![CDATA[]]>"

  // Escape any ]]> sequences by splitting them: ]]> becomes ]]]]><![CDATA[>
  const escaped = str.replace(/]]>/g, "]]]]><![CDATA[>")

  return `<![CDATA[${escaped}]]>`
}
