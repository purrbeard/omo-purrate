import { useEffect, useRef, useState } from "react";
import type { Model } from "../../../shared/protocol";
import type { ModelProfile, Preferences } from "../../../shared/ipc";
import { useT } from "../../i18n";
import { TESTID } from "../testids";
import { laneAt, PROFILE_LANES, resolveProfile } from "./model-profiles";

const FONT: Record<string, string> = {
  A: "01110/10001/10001/11111/10001/10001/10001",
  B: "11110/10001/10001/11110/10001/10001/11110",
  C: "01111/10000/10000/10000/10000/10000/01111",
  D: "11110/10001/10001/10001/10001/10001/11110",
  E: "11111/10000/10000/11110/10000/10000/11111",
  F: "11111/10000/10000/11110/10000/10000/10000",
  G: "01111/10000/10000/10111/10001/10001/01111",
  H: "10001/10001/10001/11111/10001/10001/10001",
  I: "11111/00100/00100/00100/00100/00100/11111",
  J: "00111/00010/00010/00010/10010/10010/01100",
  K: "10001/10010/10100/11000/10100/10010/10001",
  L: "10000/10000/10000/10000/10000/10000/11111",
  M: "10001/11011/10101/10101/10001/10001/10001",
  N: "10001/11001/10101/10011/10001/10001/10001",
  O: "01110/10001/10001/10001/10001/10001/01110",
  P: "11110/10001/10001/11110/10000/10000/10000",
  Q: "01110/10001/10001/10001/10101/10010/01101",
  R: "11110/10001/10001/11110/10100/10010/10001",
  S: "01111/10000/10000/01110/00001/00001/11110",
  T: "11111/00100/00100/00100/00100/00100/00100",
  U: "10001/10001/10001/10001/10001/10001/01110",
  V: "10001/10001/10001/10001/10001/01010/00100",
  W: "10001/10001/10001/10101/10101/10101/01010",
  X: "10001/10001/01010/00100/01010/10001/10001",
  Y: "10001/10001/01010/00100/00100/00100/00100",
  Z: "11111/00001/00010/00100/01000/10000/11111",
  "5": "11111/10000/10000/11110/00001/00001/11110",
  "6": "01110/10000/10000/11110/10001/10001/01110",
  "1": "00100/01100/00100/00100/00100/00100/01110",
  ".": "00000/00000/00000/00000/00000/00100/00100",
  "-": "00000/00000/00000/11111/00000/00000/00000",
};

const OFF_DOT = "fill-muted";
const LIT_DOT = "fill-(--led-active) drop-shadow-[0_0_1px_var(--led-active)]";
const DIM_DOT = "fill-(--led-active) opacity-30";

/** How long the LED readout scrambles from left to right before it settles on the new text. */
const LED_SCRAMBLE_MS = 140;

function Led({
  name,
  effort,
  profile,
  geeky,
}: {
  name: string;
  effort: string;
  profile: string;
  geeky: boolean;
}) {
  const [phase, setPhase] = useState(1);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase(1);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / LED_SCRAMBLE_MS);
      setPhase(progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    setPhase(0);
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [name, effort, profile]);
  const rows = [
    name.toUpperCase().slice(0, 24),
    `${effort.toUpperCase().padEnd(8)}${profile.toUpperCase()}`.slice(0, 24),
  ];
  return (
    <div
      className="rounded-(--dsw-radius-md) bg-terminal p-3 shadow-[inset_0_2px_8px_color-mix(in_oklch,var(--color-black)_40%,transparent)] [--led-active:var(--warning)] data-[geeky=true]:[--led-active:var(--muted-foreground)]"
      data-geeky={geeky}
      data-testid={TESTID.profileLed}
      role="img"
      aria-label={`${name} · ${effort.toUpperCase()} · ${profile}`}
      data-model={name}
      data-effort={effort.toUpperCase()}
      data-settled={phase === 1}
    >
      <svg className="block w-full" viewBox="0 0 575 67" aria-hidden="true">
        {rows.flatMap((text, line) =>
          Array.from({ length: 24 }, (_, column) => {
            const char =
              phase < 1 && column / 24 > phase
                ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[
                    (column + Math.floor(phase * 30)) % 26
                  ]!
                : (text[column] ?? " ");
            const bitmap = (FONT[char] ?? "").replaceAll("/", "");
            return Array.from({ length: 35 }, (_, pixel) => (
              <circle
                key={`${line}-${column}-${pixel}`}
                cx={column * 24 + (pixel % 5) * 4 + 3}
                cy={line * 36 + Math.floor(pixel / 5) * 4 + 3}
                r="1.25"
                className={
                  bitmap[pixel] === "1"
                    ? line === 1 && column >= 8
                      ? DIM_DOT
                      : LIT_DOT
                    : OFF_DOT
                }
              />
            ));
          }),
        )}
      </svg>
    </div>
  );
}

export function ProfilePicker({
  models,
  current,
  profileModels,
  onConfigure,
  onSelect,
}: {
  models: Model[];
  current: ModelProfile | null;
  profileModels?: Preferences["profileModels"];
  onConfigure: (profile: ModelProfile) => void;
  onSelect: (profile: ModelProfile) => void;
}) {
  const t = useT();
  const [preview, setPreview] = useState<ModelProfile>(
    current ?? "daily-normal",
  );
  const lane = PROFILE_LANES.find((entry) => entry.id === preview)!;
  const [position, setPosition] = useState({
    x: lane.x as number,
    y: lane.y as number,
  });
  const dragging = useRef(false);
  const dot = useRef<HTMLButtonElement>(null);
  const resolved = resolveProfile(models, preview, profileModels);
  const configuredModelId = profileModels?.[preview];
  const configuredModelUnavailable = configuredModelId !== undefined && !models.some((model) => !model.hidden && model.id === configuredModelId);
  const name =
    resolved.model?.displayName.replace(/^Claude\s+/i, "") ??
    t("composer.model.none");
  const title = `${t(`composer.profile.${lane.family}`)} · ${t(`composer.profile.${lane.weight}`)}`;
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    setPreview(laneAt(x, y));
    return { x, y };
  };
  const snap = (profile: ModelProfile) => {
    const target = PROFILE_LANES.find((entry) => entry.id === profile)!;
    setPosition({ x: target.x, y: target.y });
  };
  return (
    <div className="rounded-(--dsw-radius-lg) bg-accent p-2.5">
      <Led
        name={name}
        effort={resolved.effort ?? ""}
        profile={`${lane.family} ${lane.weight}`}
        geeky={lane.family === "geeky"}
      />
      <div className="mt-4 grid grid-cols-[248px_1fr] gap-5 max-[600px]:grid-cols-1">
        <div className="grid grid-cols-[20px_1fr] grid-rows-[22px_228px_24px] max-[600px]:mx-auto max-[600px]:w-[248px]">
          <div className="col-start-2 flex justify-between px-1.5 text-[13px] text-muted-foreground">
            <span>{t("composer.profile.daily")}</span>
            <span>{t("composer.profile.geeky")}</span>
          </div>
          <div className="row-start-2 flex flex-col justify-between py-1.5 text-xs text-muted-foreground [&_span]:rotate-180 [&_span]:[writing-mode:vertical-rl]">
            <span>{t("composer.profile.heavy")}</span>
            <span>{t("composer.profile.normal")}</span>
          </div>
          <div
            className="relative col-start-2 row-start-2 grid cursor-crosshair touch-none grid-cols-2 grid-rows-2 overflow-hidden rounded-(--dsw-radius-lg) border border-solid border-border bg-accent"
            data-testid={TESTID.profilePad}
            onPointerDown={(event) => {
              event.preventDefault();
              dot.current?.focus();
              dragging.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setPosition(point(event));
            }}
            onPointerMove={(event) => {
              const next = point(event);
              if (dragging.current) setPosition(next);
            }}
            onPointerLeave={() => {
              if (!dragging.current) setPreview(current ?? "daily-normal");
            }}
            onPointerUp={(event) => {
              if (!dragging.current) return;
              dragging.current = false;
              const next = point(event);
              const profile = laneAt(next.x, next.y);
              snap(profile);
              onSelect(profile);
            }}
            onPointerCancel={() => {
              dragging.current = false;
              setPreview(current ?? "daily-normal");
              snap(current ?? "daily-normal");
            }}
          >
            {PROFILE_LANES.map((entry) => (
              <div
                key={entry.id}
                className="pointer-events-none border-r border-b border-border p-2.5 text-xs leading-[18px] text-muted-foreground even:border-r-0 even:text-right nth-[n+3]:flex nth-[n+3]:items-end nth-[n+3]:border-b-0 nth-4:justify-end data-[active=true]:bg-warning data-[active=true]:text-foreground data-[active=true]:data-[geeky=true]:bg-muted-foreground"
                data-active={entry.id === preview}
                data-geeky={entry.family === "geeky"}
              >
                {resolveProfile(models, entry.id, profileModels).model?.displayName.replace(/^Claude\s+/i, "") ?? entry.name}
              </div>
            ))}
            <button
              ref={dot}
              type="button"
              className="absolute m-0 size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-0 bg-foreground p-0 shadow-[0_2px_8px_color-mix(in_oklch,var(--color-black)_40%,transparent)] [corner-shape:round]! focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring focus-visible:outline-solid active:cursor-grabbing"
              data-testid={TESTID.profileDot}
              aria-label={t("composer.profile.pad")}
              aria-describedby="profile-keyboard-help"
              style={{
                left: `${position.x * 100}%`,
                top: `${position.y * 100}%`,
              }}
              disabled={models.length === 0}
              onKeyDown={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  const next = laneAt(
                    event.key === "ArrowLeft"
                      ? 0.25
                      : event.key === "ArrowRight"
                        ? 0.75
                        : lane.x,
                    event.key === "ArrowUp"
                      ? 0.25
                      : event.key === "ArrowDown"
                        ? 0.75
                        : lane.y,
                  );
                  setPreview(next);
                  snap(next);
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(preview);
                }
              }}
            />
          </div>
          <div className="col-span-2 pt-2 text-center text-xs text-muted-foreground">{t("composer.profile.pull")}</div>
          <span id="profile-keyboard-help" className="sr-only">
            {t("composer.profile.keyboard")}
          </span>
        </div>
        <div
          className="mt-[22px] mb-6 flex flex-col rounded-(--dsw-radius-lg) border border-solid border-border bg-composer p-[18px] max-[600px]:m-0 max-[600px]:min-h-[150px]"
          data-testid={TESTID.profilePreview}
          data-profile={preview}
        >
          <div className="flex items-center justify-between gap-2 text-[15px] [&_span]:text-[10px] [&_span]:text-muted-foreground">
            <strong>{title}</strong>
            <span>
              {t(
                current === preview
                  ? "composer.profile.current"
                  : "composer.profile.preview",
              )}
            </span>
          </div>
          <p className="text-[13px] leading-[22px] text-muted-foreground">{t(`composer.profile.description.${preview}`)}</p>
          <button type="button" className="cursor-pointer self-start rounded-(--dsw-radius-md) border border-solid border-border bg-accent px-[9px] py-[5px] text-xs text-foreground [font-family:inherit] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid" data-profile-configure={preview} onClick={() => onConfigure(preview)}>
            {t("composer.profile.model")}
          </button>
          <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3 text-xs [&_span]:text-muted-foreground [&_span]:[overflow-wrap:anywhere] [&_strong]:text-right [&_strong]:font-medium">
            {configuredModelUnavailable && <span role="status" data-profile-unavailable={preview}>
              {t("composer.profile.model")}: {configuredModelId} · {t("composer.model.searchEmpty")}
            </span>}
            <span>{configuredModelUnavailable ? `${t("composer.profile.automatic")} · ` : ""}{t("composer.profile.resolved")}</span>
            <strong>
              {name} · {resolved.effort ?? "—"}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
