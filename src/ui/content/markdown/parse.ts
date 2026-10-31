/**
 * The markdown renderer's two mdast grammars, one per rendering arm. Each
 * arm is internally consistent - incremental, one-shot and plain-text parses
 * agree, with math enabled only after settlement.
 */

import type { Root } from 'mdast'
import { recoverLocalImages } from './local-image-syntax.ts'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { asciiPunctuation } from 'micromark-util-character'
import { cjkFriendlyStrong } from './cjk-friendly-strong.ts'
import { mathCompatibility } from './math-compatibility.ts'
import type { Extension, State, Tokenizer } from 'micromark-util-types'

// Only a separator inside a drive-qualified path bypasses CommonMark's
// character escape. Ordinary prose escapes and surrounding markup still use
// the normal grammar, and code never enters this construct.
const windowsPathEscape: Tokenizer = function (effects, ok, nok) {
  const first = this.events[0]?.[1];
  const prefix = first === undefined ? '' : this.sliceSerialize({ start: first.start, end: this.now() });
  const inPath = /(?:^|["'\u201c\u2018])[A-Za-z]:(?:[\\/][^"'`\u201c\u201d\u2018\u2019\r\n]*)?$|(?:^|[\s(])[A-Za-z]:(?:[\\/][^\s"'`<>]*)?$/u.test(prefix);
  return start;
  function start(code: number | null): State | undefined {
    if (!inPath) return nok(code);
    effects.enter('data');
    effects.consume(code);
    return escaped;
  }
  function escaped(code: number | null): State | undefined {
    if (!asciiPunctuation(code)) return nok(code);
    effects.consume(code);
    effects.exit('data');
    return ok;
  }
}
const pathEscapes = { 92: { tokenize: windowsPathEscape } };
const windowsPaths: Extension = { text: pathEscapes, string: pathEscapes };

/** Parse streaming GFM, leaving incomplete TeX literal. */
export function parseGfm(text: string): Root {
  return recoverLocalImages(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), windowsPaths],
    mdastExtensions: [gfmFromMarkdown()],
  }), text)
}

/** Parse settled GFM plus compatible TeX delimiters. */
export function parseGfmWithMath(text: string): Root {
  return recoverLocalImages(fromMarkdown(text, {
    extensions: [gfm(), cjkFriendlyStrong(), windowsPaths, mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }), text)
}
