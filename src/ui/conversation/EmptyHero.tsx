import { useT } from "../../i18n";
import { TESTID } from "../testids";

/** The empty conversation: one centered muted line inviting the first message. */
export function EmptyHero() {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 pt-6 pb-14" data-testid={TESTID.emptyHero}>
      <p className="m-0 text-center text-sm leading-5 break-keep text-muted-foreground">{t("conversation.empty")}</p>
    </div>
  );
}
