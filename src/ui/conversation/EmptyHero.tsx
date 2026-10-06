import { useT } from "../../i18n";
import { TESTID } from "../testids";
import css from "./EmptyHero.module.css";

/** The empty conversation: one centered muted line inviting the first message. */
export function EmptyHero() {
  const t = useT();
  return (
    <div className={css.hero} data-testid={TESTID.emptyHero}>
      <p className={css.text}>{t("conversation.empty")}</p>
    </div>
  );
}
