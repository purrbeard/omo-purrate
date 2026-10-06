import type {
  CodeToolbarLabels,
  DiffBlockLabels,
  JsonTreeLabels,
  MarkdownLabels,
  TerminalBlockLabels,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { useT, type Translate } from "../../i18n";

export interface ConversationLabels {
  copy: string;
  copied: string;
  toolbar: CodeToolbarLabels;
  markdown: MarkdownLabels;
  terminal: TerminalBlockLabels;
  diff: DiffBlockLabels;
  json: JsonTreeLabels;
}

function buildLabels(t: Translate): ConversationLabels {
  const copy = t("conversation.code.copy");
  const copied = t("conversation.code.copied");
  const toolbar: CodeToolbarLabels = {
    codeLabel: t("conversation.code.title"),
    wrapLabel: t("conversation.code.wrap"),
    unwrapLabel: t("conversation.code.unwrap"),
  };
  const collapse = t("conversation.block.collapse");
  const collapseAria = t("conversation.block.collapseAria");
  const expand = (count: number): string => t("conversation.block.expand", { count });
  const expandAria = (count: number): string => t("conversation.block.expandAria", { count });
  return {
    copy,
    copied,
    toolbar,
    markdown: {
      code: { copyLabel: copy, copiedLabel: copied, toolbarLabels: toolbar },
      footnotes: t("conversation.markdown.footnotes"),
    },
    terminal: {
      signal: (signal) => t("conversation.terminal.signal", { signal }),
      exitCode: (code) => t("conversation.terminal.exitCode", { code }),
      noExitCode: t("conversation.terminal.noExitCode"),
      running: t("conversation.terminal.running"),
      failed: t("conversation.terminal.failed"),
      done: t("conversation.terminal.done"),
      copy,
      copied,
      noOutput: t("conversation.terminal.noOutput"),
      collapseAria,
      collapse,
      expandAria,
      expand,
    },
    diff: { ...toolbar, copy, copied, collapseAria, expandAria, collapse, expand },
    json: {
      copyValue: t("conversation.json.copyValue"),
      copyJson: t("conversation.json.copyJson"),
      copyPath: t("conversation.json.copyPath"),
      copyPrettyJson: t("conversation.json.copyPrettyJson"),
      copyCompactJson: t("conversation.json.copyCompactJson"),
      copied: t("conversation.json.copied"),
      copyFailed: t("conversation.json.copyFailed"),
      collapseNode: t("conversation.json.collapse"),
      expandNode: t("conversation.json.expand"),
      copyButtonTitle: (action) => action,
    },
  };
}

const cache = new WeakMap<Translate, ConversationLabels>();

/** Cached per `t` identity: MarkdownText drops its streaming cache whenever its labels object changes. */
export function useConversationLabels(): ConversationLabels {
  const t = useT();
  let labels = cache.get(t);
  if (labels === undefined) {
    labels = buildLabels(t);
    cache.set(t, labels);
  }
  return labels;
}
