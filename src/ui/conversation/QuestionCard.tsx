import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import { Button, IconCheckOutlineRegular, IconEditOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { UserInputQuestion } from "../../../shared/protocol";
import { useT } from "../../i18n";
import type { PendingRequest } from "../../state";
import { useActions } from "../app-context";
import { TESTID } from "../testids";
import css from "./QuestionCard.module.css";

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
    <div className={clsx(css.field, variant === "inline" ? css.fieldInline : css.fieldBlock)}>
      <div aria-hidden className={css.fieldMirror}>{`${value}\n`}</div>
      <textarea
        className={css.fieldInput}
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
    <div className={clsx(css.field, css.fieldBlock)}>
      <input
        className={css.fieldInput}
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
    <div className={css.question}>
      <div className={css.header}>
        {header !== "" && <div className={css.eyebrow}>{header}</div>}
        <h2 className={css.title} id={titleId}>
          {question.question}
        </h2>
      </div>
      <div className={css.options} role={multi ? "group" : "radiogroup"} aria-labelledby={titleId}>
        {options.map((option, index) => {
          const selected = draft.selected.includes(option.label);
          return (
            <button
              type="button"
              key={`${option.label}-${index}`}
              className={clsx(css.option, selected && css.optionSelected)}
              role={multi ? "checkbox" : "radio"}
              aria-checked={selected}
              disabled={disabled}
              data-testid={TESTID.questionOption}
              data-label={option.label}
              onClick={() => onChoose(option.label)}
            >
              {multi ? (
                <span className={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                  {selected && <IconCheckOutlineRegular size={12} />}
                </span>
              ) : (
                <span className={css.number} aria-hidden="true">
                  {index + 1}
                </span>
              )}
              <span className={css.optionLine}>
                <span className={css.optionLabel}>{option.label}</span>
                {typeof option.description === "string" && option.description.trim() !== "" && (
                  <span className={css.description}>{option.description}</span>
                )}
              </span>
            </button>
          );
        })}
        {freeText &&
          (options.length > 0 ? (
            <div className={clsx(css.customRow, draft.other !== "" && css.customRowActive)}>
              {multi ? (
                <span className={clsx(css.checkbox, draft.other !== "" && css.checkboxChecked)} aria-hidden="true">
                  {draft.other !== "" && <IconCheckOutlineRegular size={12} />}
                </span>
              ) : (
                <span className={css.number} aria-hidden="true">
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
      className={css.card}
      data-testid={TESTID.questionCard}
      data-request-id={String(request.id)}
      role="group"
      aria-label={t("conversation.question.waiting")}
      aria-busy={busy}
    >
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
      <footer className={css.footer}>
        <div className={css.feedback} role="status">
          {!complete && questions.length > 1 ? t("conversation.question.incomplete") : null}
        </div>
        <Button variant="primary" disabled={busy || !complete} data-testid={TESTID.questionSubmit} onClick={submit}>
          {t(busy ? "conversation.question.submitting" : "conversation.question.submit")}
        </Button>
      </footer>
    </div>
  );
}
