import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import { IconCheckOutlineRegular, IconEditOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { UserInputQuestion } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { PendingRequest } from "../../state";
import { useActions } from "../app-context";
import { Button, focusRing } from "../kit";
import { TESTID } from "../testids";

/** Mirror and textarea share one grid cell with identical type, padding and wrapping. */
const fieldCell = "[grid-area:1/1] min-w-0 box-border text-sm leading-6 [font-family:inherit] break-words [overflow-wrap:anywhere] whitespace-pre-wrap";
const fieldInput = clsx(fieldCell, "m-0 resize-none overflow-y-auto border-0 bg-transparent text-foreground caret-foreground outline-none placeholder:text-muted-foreground");
const indicator = "mt-0.5 grid size-5 flex-[0_0_20px] place-items-center";
const numberBadge = clsx(indicator, "rounded-xs bg-muted text-xs font-medium leading-[18px] text-muted-foreground");
function checkboxClass(checked: boolean): string {
  return clsx(
    indicator,
    "before:[grid-area:1/1] before:size-3.5 before:rounded-xs before:border before:border-solid before:content-[''] before:transition-colors motion-reduce:before:transition-none [&>svg]:[grid-area:1/1]",
    checked ? "text-background before:border-foreground before:bg-foreground" : "before:border-input",
  );
}

export type QuestionRequest = Extract<PendingRequest, { kind: "userInput" }>;

interface Draft {
  selected: readonly string[];
  other: string;
}

const EMPTY_DRAFT: Draft = { selected: [], other: "" };

function isAnswered(draft: Draft): boolean {
  return draft.selected.length > 0 || draft.other.trim() !== "";
}

function wireAnswer(draft: Draft): string[] {
  const other = draft.other.trim();
  return other === "" ? [...draft.selected] : [...draft.selected, other];
}

const FIELD_BLOCK = "mx-3 min-h-10 rounded-lg border border-solid border-input bg-background focus-within:border-ring [&>*]:px-3 [&>*]:py-2";

function AnswerField({
  variant,
  value,
  placeholder,
  label,
  disabled,
  onChange,
  onKeyDown,
}: {
  variant: "inline" | "block";
  value: string;
  placeholder: string;
  label: string;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className={clsx("grid min-w-0", variant === "inline" ? "flex-1 [&>*]:p-0" : FIELD_BLOCK)}>
      <div aria-hidden className={clsx(fieldCell, "invisible max-h-36 overflow-hidden")}>{`${value}\n`}</div>
      <textarea
        className={fieldInput}
        data-testid={TESTID.questionOtherInput}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function SecretField({
  value,
  placeholder,
  label,
  disabled,
  onChange,
  onKeyDown,
}: {
  value: string;
  placeholder: string;
  label: string;
  disabled: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className={clsx("grid min-w-0", FIELD_BLOCK)}>
      <input
        className={fieldInput}
        data-testid={TESTID.questionOtherInput}
        type="password"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function QuestionBlock({
  question,
  draft,
  disabled,
  onChoose,
  onOther,
  onSubmitKey,
}: {
  question: UserInputQuestion;
  draft: Draft;
  disabled: boolean;
  onChoose: (label: string) => void;
  onOther: (value: string) => void;
  onSubmitKey: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const multi = question.multiSelect === true;
  const options = question.options ?? [];
  const freeText = question.isOther === true || options.length === 0;
  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmitKey();
  };
  const header = typeof question.header === "string" ? question.header.trim() : "";
  const otherLabel = t("conversation.question.other");
  const placeholder = t(
    question.isSecret === true ? "conversation.question.secretPlaceholder" : "conversation.question.otherPlaceholder",
  );
  const field =
    question.isSecret === true ? (
      <SecretField
        value={draft.other}
        placeholder={placeholder}
        label={otherLabel}
        disabled={disabled}
        onChange={(event) => onOther(event.target.value)}
        onKeyDown={submitOnEnter}
      />
    ) : (
      <AnswerField
        variant={options.length > 0 ? "inline" : "block"}
        value={draft.other}
        placeholder={placeholder}
        label={otherLabel}
        disabled={disabled}
        onChange={(event) => onOther(event.target.value)}
        onKeyDown={submitOnEnter}
      />
    );
  return (
    <div className="[&+&]:mt-2 [&+&]:border-0 [&+&]:border-t [&+&]:border-solid [&+&]:border-border">
      <div className="px-6 pt-5">
        {header !== "" && <div className="mb-1 text-[11px] leading-4 text-muted-foreground">{header}</div>}
        <h2 className="m-0 text-base font-medium leading-[22px] [overflow-wrap:anywhere]" id={titleId}>
          {question.question}
        </h2>
      </div>
      <div className="mt-2 flex flex-col gap-px px-3 py-1" role={multi ? "group" : "radiogroup"} aria-labelledby={titleId}>
        {options.map((option, index) => {
          const selected = draft.selected.includes(option.label);
          return (
            <button
              type="button"
              key={`${option.label}-${index}`}
              className={clsx(
                "flex w-full min-h-10 shrink-0 items-start gap-2 rounded-md border border-solid py-2 pr-3 pl-2 transition-colors duration-150 motion-reduce:transition-none m-0 cursor-pointer bg-transparent text-left text-inherit [font-family:inherit] hover:not-disabled:bg-accent disabled:cursor-default",
                selected ? "border-border bg-accent" : "border-transparent",
                focusRing,
              )}
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              disabled={disabled}
              data-testid={TESTID.questionOption}
              data-label={option.label}
              onClick={() => onChoose(option.label)}
            >
              {multi ? (
                <span className={checkboxClass(selected)} aria-hidden="true">
                  {selected && <IconCheckOutlineRegular size={12} />}
                </span>
              ) : (
                <span className={numberBadge} aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="text-sm font-medium leading-6">{option.label}</span>
                {typeof option.description === "string" && option.description.trim() !== "" && (
                  <span className="text-sm leading-6 text-muted-foreground">{option.description}</span>
                )}
              </span>
            </button>
          );
        })}
        {freeText &&
          (options.length > 0 ? (
            <div className={clsx("flex w-full min-h-10 shrink-0 items-start gap-2 rounded-md border border-solid py-2 pr-3 pl-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-accent focus-within:border-border focus-within:bg-accent", draft.other !== "" ? "border-border bg-accent" : "border-transparent")}>
              {multi ? (
                <span className={checkboxClass(draft.other !== "")} aria-hidden="true">
                  {draft.other !== "" && <IconCheckOutlineRegular size={12} />}
                </span>
              ) : (
                <span className={numberBadge} aria-hidden="true">
                  <IconEditOutlineRegular size={12} />
                </span>
              )}
              {field}
            </div>
          ) : (
            field
          ))}
      </div>
    </div>
  );
}

/** DSH QuestionComposer port showing every question at once; Submit sends each question's selected labels plus its free text. */
export function QuestionCard({ request }: { request: QuestionRequest }) {
  const t = useT();
  const actions = useActions();
  const [drafts, setDrafts] = useState<Readonly<Record<string, Draft>>>({});
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const questions = request.params.questions;
  const draftOf = (id: string): Draft => drafts[id] ?? EMPTY_DRAFT;
  const complete = questions.every((question) => isAnswered(draftOf(question.id)));

  const update = (question: UserInputQuestion, next: (draft: Draft) => Draft): void => {
    setDrafts((current) => ({ ...current, [question.id]: next(current[question.id] ?? EMPTY_DRAFT) }));
  };
  const choose = (question: UserInputQuestion, label: string): void => {
    update(question, (draft) => {
      if (question.multiSelect !== true) return { selected: [label], other: "" };
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((value) => value !== label)
        : [...draft.selected, label];
      return { ...draft, selected };
    });
  };
  const typeOther = (question: UserInputQuestion, value: string): void => {
    update(question, (draft) => ({ selected: question.multiSelect === true ? draft.selected : [], other: value }));
  };
  const submit = (): void => {
    if (!complete || busy) return;
    const answers = Object.fromEntries(questions.map((question) => [question.id, wireAnswer(draftOf(question.id))]));
    setBusy(true);
    void actions.answerUserInput(request.id, answers).finally(() => {
      if (mounted.current) setBusy(false);
    });
  };

  return (
    <div
      className="box-border flex w-full flex-col rounded-2xl border border-solid border-border bg-composer pb-3 text-foreground shadow-md"
      data-testid={TESTID.questionCard}
      data-request-id={String(request.id)}
      role="group"
      aria-label={t("conversation.question.waiting")}
      aria-busy={busy}
    >
      {request.resolved && <p className="m-0 px-6 pt-4 text-[13px] leading-5 text-muted-foreground" role="status">{t("conversation.question.followUp")}</p>}
      {questions.map((question) => (
        <QuestionBlock
          key={question.id}
          question={question}
          draft={draftOf(question.id)}
          disabled={busy}
          onChoose={(label) => choose(question, label)}
          onOther={(value) => typeOther(question, value)}
          onSubmitKey={submit}
        />
      ))}
      <footer className="mt-3 flex items-center justify-end gap-3 pr-4 pl-6">
        <div className="min-h-4 flex-1 text-right text-xs leading-4 text-muted-foreground" role="status">
          {!complete && questions.length > 1 ? t("conversation.question.incomplete") : null}
        </div>
        <Button variant="primary" disabled={busy || !complete} data-testid={TESTID.questionSubmit} onClick={submit}>
          {t(busy ? "conversation.question.submitting" : "conversation.question.submit")}
        </Button>
      </footer>
    </div>
  );
}
