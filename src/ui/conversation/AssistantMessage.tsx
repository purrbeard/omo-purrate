import { memo } from "react";
import { MarkdownText } from "../content/markdown/MarkdownText";
import { TESTID } from "../testids";
import { useConversationLabels } from "./labels";

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
      className="flex min-w-0 flex-col text-sm leading-6 text-message-assistant-foreground"
      data-testid={TESTID.assistantMessage}
      data-item-id={id}
      data-streaming={streaming || undefined}
      data-flow="assistant"
    >
      <MarkdownText text={text} streaming={streaming} labels={labels.markdown} />
    </div>
  );
});
