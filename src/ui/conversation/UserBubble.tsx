import { memo, useId, useState } from "react";
import chipCss from "@deepseek-ai/dsh-client-ui-primitives/src/user-text.module.css";
import type { UserInput } from "../../../shared/protocol";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import clsx from "clsx";
import { focusRing } from "../kit";
import { projectSkillUserText } from "./skill-text";
import { splitAttachments } from "../composer/attachments";
import { splitContext } from "../composer/context-draft";

export interface UserImage {
  key: string;
  src: string;
}

export const NO_IMAGES: readonly UserImage[] = [];

function fileUrl(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized.slice(0, 2)}${normalized.slice(2).split("/").map(encodeURIComponent).join("/")}`;
  }
  if (normalized.startsWith("//")) return `file:${normalized.split("/").map(encodeURIComponent).join("/")}`;
  return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Joins the text inputs of a user message and collects its images: image inputs and the paths of a trailing
 * attachment block (see `splitAttachments`); skills and mentions are not shown.
 */
export function userMessageParts(content: readonly UserInput[]): { text: string; images: readonly UserImage[] } {
  const texts: string[] = [];
  const images: UserImage[] = [];
  content.forEach((input, index) => {
    if (input.type === "text") {
      const { text, paths } = splitAttachments(input.text);
      texts.push(text);
      paths.forEach((path, position) => images.push({ key: `attachment:${index}:${position}`, src: fileUrl(path) }));
    } else if (input.type === "image") images.push({ key: `image:${index}`, src: input.url });
    else if (input.type === "localImage") images.push({ key: `image:${index}`, src: fileUrl(input.path) });
  });
  return { text: texts.filter((text) => text !== "").join("\n"), images: images.length === 0 ? NO_IMAGES : images };
}

function Thumbnail({ src }: { src: string }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="box-border grid h-[90px] w-[120px] place-items-center rounded-lg border border-solid border-border p-2 text-center text-xs leading-4 text-muted-foreground">{t("conversation.image.failed")}</span>;
  return (
    <img
      className="block h-[90px] w-[120px] rounded-lg border border-solid border-border bg-card object-cover"
      src={src}
      alt={t("conversation.user.image")}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/** DSH user bubble: right-aligned text with image thumbnails above it; `sending` marks an optimistic echo. */
export const UserBubble = memo(function UserBubble({
  text,
  images,
  sending = false,
}: {
  text: string;
  images: readonly UserImage[];
  sending?: boolean;
}) {
  const t = useT();
  const { skills, rest, context } = projectSkillUserText(text);
  const attached = splitContext(rest);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const instructionsId = useId();
  const contextId = useId();
  const contextLabels = {
    "omo-ultrawork-reminder": t("conversation.context.ultrawork"),
    "omo-ulw-loop-pointer": t("conversation.context.loopPointer"),
    "omo-mass-ulw-pointer": t("conversation.context.massPointer"),
    "omo-senpi-ulw-loop": t("conversation.context.loopRun"),
    "system-reminder": t("conversation.context.system"),
  };
  const hasInstructions = skills.some((skill) => skill.body !== null);
  return (
    <div
      className="group/bubble flex min-w-0 flex-col items-end"
      data-testid={TESTID.userMessage}
      data-sending={sending || undefined}
      aria-busy={sending || undefined}
      data-flow="user"
    >
      <div className="flex min-w-0 max-w-[min(32rem,82%)] flex-col items-end gap-2">
        {images.length > 0 && (
          <div className="flex max-w-full flex-wrap justify-end gap-2">
            {images.map((image) => (
              <Thumbnail key={image.key} src={image.src} />
            ))}
          </div>
        )}
        {text !== "" && (
          <div className="box-border max-w-full rounded-2xl bg-message-user px-4 py-2.5 text-sm leading-[22px] break-words whitespace-pre-wrap text-message-user-foreground group-data-[sending]/bubble:opacity-60">
            {skills.length > 0 && (
              <div className="mb-1 flex flex-wrap gap-x-2 gap-y-1">
                {skills.map((skill) => (
                  <span
                    key={skill.name}
                    className={`${chipCss.refChip} ${chipCss.slashChip}`}
                    data-testid={TESTID.skillChip}
                    data-ref-chip="skill"
                    title={skill.location ?? `/skill:${skill.name}`}
                  >
                    {t("conversation.skill.label")} /{skill.name}
                  </span>
                ))}
              </div>
            )}
            {attached.text}
            {attached.context.length > 0 && <div className="mt-2 whitespace-normal">
              {attached.context.map((entry, index) => <details key={index} className="max-w-full rounded-md bg-accent px-2 py-1 text-xs">
                <summary className="cursor-pointer [overflow-wrap:anywhere]">{entry.kind === "terminal" ? "WindowsTerminal" : entry.value.replaceAll("\\", "/").split("/").at(-1) || entry.value}</summary>
                <pre className="m-0 mt-2 max-h-60 overflow-auto font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">{entry.value}</pre>
              </details>)}
            </div>}
            {context.length > 0 && (
              <div className="mt-2 whitespace-normal">
                <button
                  type="button"
                  className={clsx(chipCss.refChip, "m-0! cursor-pointer border-0! bg-transparent! px-0! py-0.5! text-xs! [font-family:inherit]!", focusRing)}
                  data-testid={TESTID.omoContextToggle}
                  aria-expanded={showContext}
                  aria-controls={contextId}
                  onClick={() => setShowContext((shown) => !shown)}
                >
                  {t("conversation.context.label")}{context.length > 1 ? ` (${context.length})` : ""}
                </button>
                <div id={contextId} hidden={!showContext} className="mt-2 border-0 border-t border-solid border-border pt-2 [&>section+section]:mt-3" data-testid={TESTID.omoContext}>
                  {context.map((block, index) => (
                    <section key={`${block.tag}:${index}`}>
                      <div className="font-medium">
                        {Object.hasOwn(contextLabels, block.tag)
                          ? contextLabels[block.tag as keyof typeof contextLabels]
                          : block.tag}
                      </div>
                      <pre className="m-0 mt-2 font-mono text-xs leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap">{block.body}</pre>
                    </section>
                  ))}
                </div>
              </div>
            )}
            {hasInstructions && (
              <div className="mt-2 whitespace-normal">
                <button
                  type="button"
                  className={clsx("m-0 cursor-pointer border-0 bg-transparent p-0 py-0.5 text-left text-xs text-muted-foreground [font-family:inherit] hover:text-foreground", focusRing)}
                  data-testid={TESTID.skillBodyToggle}
                  aria-expanded={showInstructions}
                  aria-controls={instructionsId}
                  onClick={() => setShowInstructions((shown) => !shown)}
                >
                  {t(showInstructions ? "conversation.skill.hideInstructions" : "conversation.skill.showInstructions")}
                </button>
                <div id={instructionsId} hidden={!showInstructions} className="mt-2 border-0 border-t border-solid border-border pt-2 [&>section+section]:mt-3">
                  {skills.filter((skill) => skill.body !== null).map((skill) => (
                    <section key={skill.name} data-testid={TESTID.skillBody}>
                      <div className="font-medium">{skill.name}</div>
                      <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{skill.location}</div>
                      <pre className="m-0 mt-2 font-mono text-xs leading-[18px] [overflow-wrap:anywhere] whitespace-pre-wrap">{skill.body}</pre>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {sending && <span className="sr-only">{t("conversation.user.sending")}</span>}
      </div>
    </div>
  );
});
