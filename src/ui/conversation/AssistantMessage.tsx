import { memo } from "react";
import { MarkdownText } from "@deepseek-ai/dsh-client-ui-primitives";
import { TESTID } from "../testids";
import { useConversationLabels } from "./labels";
import css from "./AssistantMessage.module.css";

export const AssistantMessage = memo(function AssistantMessage({
  id,
  text,
  streaming,
}: {
  id: string;
  text: string;
  streaming: boolean;
}) {
  const labels = useConversationLabels();
  return (
    <div
      className={css.root}
      data-testid={TESTID.assistantMessage}
      data-item-id={id}
      data-streaming={streaming || undefined}
      data-flow="assistant"
    >
      <MarkdownText text={text} streaming={streaming} labels={labels.markdown} />
    </div>
  );
});
