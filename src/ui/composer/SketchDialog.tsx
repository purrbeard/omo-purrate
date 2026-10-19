import { useCallback, useId, useRef, useState, type PointerEvent } from "react";
import { X } from "lucide-react";
import { Button, Dialog, IconButton } from "../kit";
import { useT } from "../../i18n";
import type { ImageInput } from "./attachments";
import clsx from "clsx";

const TOOLS = "flex flex-wrap items-center gap-2";

const WIDTH = 960;
const HEIGHT = 540;
// The drawing is white paper, independent of the surrounding application theme.
const PAPER = "#ffffff";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; color: string; width: number; erase: boolean };

function replay(canvas: HTMLCanvasElement, strokes: readonly Stroke[], current?: Stroke): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of current === undefined ? strokes : [...strokes, current]) {
    const first = stroke.points[0];
    if (first === undefined) continue;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.beginPath();
    if (stroke.points.length === 1) {
      context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }
}

export function SketchDialog({ onAttach, onClose }: {
  onAttach: (image: ImageInput) => void;
  onClose: () => void;
}) {
  const t = useT();
  const hintId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const pen = useRef<HTMLButtonElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [color, setColor] = useState("#111111");
  const [eraser, setEraser] = useState(false);

  // The dialog portal mounts the canvas after this component commits, so paint the paper when it attaches.
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvas.current = node;
    if (node !== null) replay(node, strokes.current);
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
      y: Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)),
    };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 || active.current !== null) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = {
      pointerId: event.pointerId,
      stroke: { points: [point(event)], color: eraser ? PAPER : color, width: eraser ? 24 : 4, erase: eraser },
    };
    replay(event.currentTarget, strokes.current, active.current.stroke);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (active.current?.pointerId !== event.pointerId) return;
    active.current.stroke.points.push(point(event));
    replay(event.currentTarget, strokes.current, active.current.stroke);
  };

  const finish = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (active.current?.pointerId !== event.pointerId) return;
    active.current.stroke.points.push(point(event));
    // Erasing untouched paper does not create an attachable sketch.
    if (!active.current.stroke.erase || strokes.current.some((stroke) => !stroke.erase)) {
      strokes.current.push(active.current.stroke);
    }
    active.current = null;
    setStrokeCount(strokes.current.length);
    replay(event.currentTarget, strokes.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelStroke = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (active.current?.pointerId !== event.pointerId) return;
    active.current = null;
    replay(event.currentTarget, strokes.current);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content initialFocus={pen} className="max-w-[1008px]! gap-5! p-0! pb-6! overflow-hidden!">
        <div className="flex items-center justify-between gap-2 pt-[22px] pr-3.5 pl-6">
          <Dialog.Title>{t("composer.sketch.title")}</Dialog.Title>
          <IconButton icon={<X />} label={t("composer.sketch.close")} className="size-7!" onClick={onClose} />
        </div>
        <div className="flex min-h-0 min-w-0 shrink flex-col gap-3 overflow-y-auto px-6 [&>*]:shrink-0">
          <div className={clsx(TOOLS, "justify-between gap-3 max-sm:flex-col max-sm:items-start")}>
            <div className={TOOLS} role="group" aria-label={t("composer.sketch.canvas")}>
              <Button ref={pen} size="sm" variant={eraser ? "ghost" : "outline"} aria-pressed={!eraser} onClick={() => setEraser(false)}>
                {t("composer.sketch.pen")}
              </Button>
              <Button size="sm" variant={eraser ? "outline" : "ghost"} aria-pressed={eraser} onClick={() => setEraser(true)}>
                {t("composer.sketch.eraser")}
              </Button>
              <label className="inline-flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                {t("composer.sketch.color")}
                <input className="box-border h-7 w-9 cursor-pointer rounded-md border border-solid border-input bg-card p-0.5" type="color" value={color} onChange={(event) => { setColor(event.currentTarget.value); setEraser(false); }} />
              </label>
            </div>
            <div className={TOOLS}>
              <Button size="sm" variant="ghost" disabled={strokeCount === 0} onClick={() => {
                strokes.current.pop();
                setStrokeCount(strokes.current.length);
                if (canvas.current !== null) replay(canvas.current, strokes.current);
              }}>
                {t("composer.sketch.undo")}
              </Button>
              <Button size="sm" variant="ghost" disabled={strokeCount === 0} onClick={() => {
                strokes.current = [];
                setStrokeCount(0);
                if (canvas.current !== null) replay(canvas.current, strokes.current);
              }}>
                {t("composer.sketch.clear")}
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-md border border-solid border-input">
            <canvas
              ref={attachCanvas}
              className="block aspect-video h-auto w-full cursor-crosshair touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-[3px] focus-visible:outline-ring data-[eraser]:cursor-cell"
              width={WIDTH}
              height={HEIGHT}
              tabIndex={0}
              aria-label={t("composer.sketch.canvas")}
              aria-describedby={hintId}
              data-eraser={eraser || undefined}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={cancelStroke}
              onLostPointerCapture={cancelStroke}
            >
              {t("composer.sketch.hint")}
            </canvas>
          </div>
          <p id={hintId} className="m-0 text-xs leading-5 text-muted-foreground">{t("composer.sketch.hint")}</p>
        </div>
        <Dialog.Footer className="px-6">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={strokeCount === 0}
            onClick={() => {
              if (canvas.current === null || strokes.current.length === 0) return;
              replay(canvas.current, strokes.current);
              onAttach({ type: "image", url: canvas.current.toDataURL("image/png") });
              onClose();
            }}
          >
            {t("composer.sketch.attach")}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
