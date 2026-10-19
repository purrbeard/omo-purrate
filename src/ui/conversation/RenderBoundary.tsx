import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../../i18n";

function RenderFailed() {
  const t = useT();
  return (
    <div className="py-0.5 text-sm leading-5 text-muted-foreground" role="status">
      {t("conversation.item.renderError")}
    </div>
  );
}

interface RenderBoundaryProps {
  /** Names the failed subtree in the console report. */
  label: string;
  /** A new value clears a previous failure, so an item that streams into a valid state renders again. */
  resetKey: unknown;
  children: ReactNode;
}

/** Contains a render failure to one item or card, so a malformed wire value cannot blank the conversation. */
export class RenderBoundary extends Component<RenderBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`Could not render ${this.props.label}`, error, info.componentStack);
  }

  override componentDidUpdate(previous: RenderBoundaryProps): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? <RenderFailed /> : this.props.children;
  }
}
