// Leading current-color category glyph for Markdown links, file links and file mentions.

import { File, FileCode2, FileText, Folder, Globe, Image } from 'lucide-react'

/** Link categories with distinct leading glyphs. */
export type LinkIconKind = 'url' | 'folder' | 'code' | 'image' | 'document' | 'other'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'])
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'cts', 'mts', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte',
  'astro', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'bat', 'cmd', 'py', 'pyi', 'rb', 'rs', 'go', 'java', 'kt', 'kts', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'cs',
  'php', 'swift', 'sql', 'proto', 'graphql', 'gql', 'lua', 'r', 'pl', 'scala', 'clj', 'cljs', 'ex', 'exs', 'erl', 'hs',
  'dart',
])

/**
 * Derive a file path's link-icon category from its extension.
 * @param path - File path in either separator spelling.
 * @returns the glyph category; never `url` or `folder`.
 */
export function classifyLinkPath(path: string): LinkIconKind {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  return 'other'
}

const GLYPH = { url: Globe, folder: Folder, code: FileCode2, image: Image, document: FileText, other: File } as const

/**
 * Render the decorative glyph for one link category.
 * @param props.kind - link category.
 * @returns an aria-hidden lucide icon sized by the caller's class.
 */
export function LinkIcon({ kind, className }: { kind: LinkIconKind; className?: string | undefined }) {
  const Glyph = GLYPH[kind]
  return <Glyph className={className} strokeWidth={1.75} aria-hidden="true" />
}
