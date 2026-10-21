import { useEffect, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useT } from "../../i18n";
import { focusRing } from "../kit";
import { itemAtPointer, tickPercent } from "./timeline-position";

export interface TimelineItem {
  turnId: string;
  userText: string;
  assistantText: string;
}

const TICK_SPACING_PX = 6;
const MAX_RAIL = "70%";

function visibleItems(scroller: HTMLElement, indexOf: ReadonlyMap<string, number>): Set<number> {
  const view = scroller.getBoundingClientRect();
  const visible = new Set<number>();
  for (const element of scroller.querySelectorAll<HTMLElement>("[data-turn-id]")) {
    const index = indexOf.get(element.dataset["turnId"] ?? "");
    if (index === undefined) continue;
    const box = element.getBoundingClientRect();
    if (box.bottom > view.top && box.top < view.bottom) visible.add(index);
  }
  return visible;
}

/**
 * Alpha's timeline minimap: a rail on the transcript's left edge with one tick per user message. Hovering previews a
 * message, a click or Enter jumps to it, the arrows step one turn, and ticks of the turns on screen are drawn solid.
 */
export function TimelineMinimap({ items, scrollRef, onSelect }: {
  items: readonly TimelineItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onSelect(index: number): void;
}) {
  const t = useT();
  const [hovered, setHovered] = useState<number | null>(null);
  const [inView, setInView] = useState<ReadonlySet<number>>(() => new Set());

  useEffect(() => {
    const scroller = scrollRef.current;
    if (scroller === null) return;
    const indexOf = new Map(items.map((item, index) => [item.turnId, index]));
    let frame = 0;
    const measure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setInView(visibleItems(scroller, indexOf)));
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [scrollRef, items]);

  if (items.length < 3) return null;
  const visible = [...inView].sort((a, b) => a - b);
  const current = visible[0] ?? null;
  const previous = current === null ? null : current > 0 ? current - 1 : null;
  const next = current === null ? null : (visible.at(-1) ?? current) + 1 < items.length ? (visible.at(-1) ?? current) + 1 : null;
  const preview = hovered === null ? null : (items[hovered] ?? null);
  const pointed = (event: MouseEvent<HTMLButtonElement>): number | null => {
    const box = event.currentTarget.getBoundingClientRect();
    return itemAtPointer(items.length, box.top, box.height, event.clientY);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const last = items.length - 1;
    const step = (delta: number): void => setHovered((value) => Math.max(0, Math.min(last, (value ?? current ?? 0) + delta)));
    if (event.key === "ArrowDown") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); step(-1); }
    else if (event.key === "Home") { event.preventDefault(); setHovered(0); }
    else if (event.key === "End") { event.preventDefault(); setHovered(last); }
    else if ((event.key === "Enter" || event.key === " ") && hovered !== null) { event.preventDefault(); onSelect(hovered); }
  };
  const label = t("conversation.timeline.jump", { text: preview?.userText || t("conversation.timeline.userMessage") });
  const edge = hovered === null ? "-50%" : hovered === 0 ? "0%" : hovered === items.length - 1 ? "-100%" : "-50%";

  return (
    <div className="group/minimap pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-10 opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none [@media(pointer:fine)]:block"
      data-testid="timeline-minimap">
      <div className="pointer-events-auto absolute top-1/2 left-3 -translate-y-1/2"
        style={{ height: `min(${Math.max(1, (items.length - 1) * TICK_SPACING_PX)}px, ${MAX_RAIL})`, width: preview === null ? 28 : 360 }}>
        <StepButton direction="previous" disabled={previous === null} onClick={() => { if (previous !== null) onSelect(previous); }} />
        <button type="button" aria-label={label} data-testid="timeline-minimap-rail"
          className={clsx("absolute inset-y-0 left-0 m-0 w-7 cursor-pointer border-0 bg-transparent p-0", focusRing)}
          onMouseMove={(event) => setHovered(pointed(event))} onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered((value) => value ?? current ?? 0)} onBlur={() => setHovered(null)}
          onClick={(event) => { const index = pointed(event); if (index !== null) onSelect(index); }} onKeyDown={onKeyDown}>
          <span aria-hidden className="absolute top-0 left-0 h-full w-px bg-border/40" />
          {items.map((item, index) => {
            const distance = hovered === null ? null : Math.abs(index - hovered);
            return (
              <span key={item.turnId} aria-hidden data-testid="timeline-minimap-tick" data-in-view={inView.has(index)}
                className={clsx("pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[background-color,width] duration-150 data-[in-view=true]:bg-foreground/90",
                  distance === 0 ? "w-6 bg-muted-foreground/75" : distance === 1 ? "w-4" : distance === 2 ? "w-2.5" : "w-2")}
                style={{ top: `${tickPercent(index, items.length)}%` }} />
            );
          })}
        </button>
        {preview !== null && hovered !== null && (
          <span className="pointer-events-none absolute left-8 w-80 rounded-xl border border-solid border-border bg-popover p-3 text-left text-popover-foreground shadow-xl"
            data-testid="timeline-minimap-preview" style={{ top: `${tickPercent(hovered, items.length)}%`, transform: `translateY(${edge})` }}>
            <span className="block truncate text-sm font-medium leading-5">{preview.userText || t("conversation.timeline.userMessage")}</span>
            {preview.assistantText !== "" && <span className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">{preview.assistantText}</span>}
          </span>
        )}
        <StepButton direction="next" disabled={next === null} onClick={() => { if (next !== null) onSelect(next); }} />
      </div>
    </div>
  );
}

function StepButton({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick(): void }) {
  const t = useT();
  const Icon = direction === "previous" ? ChevronUp : ChevronDown;
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={t(direction === "previous" ? "conversation.timeline.previous" : "conversation.timeline.next")}
      data-testid={`timeline-minimap-${direction}`}
      className={clsx("absolute -left-2 m-0 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-foreground/90 hover:bg-accent disabled:cursor-default disabled:opacity-40",
        direction === "previous" ? "bottom-[calc(100%+2px)]" : "top-[calc(100%+2px)]", focusRing)}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
