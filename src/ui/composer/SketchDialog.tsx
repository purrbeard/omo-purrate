import { useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import { useLocale } from "../../i18n";
import type { ImageInput } from "./attachments";
import css from "./SketchDialog.module.css";

const WIDTH = 960;
const HEIGHT = 540;
// The drawing is white paper, independent of the surrounding application theme.
const PAPER = "#ffffff";
const LABELS = {
  en: {
    title: "Attach a sketch", close: "Close sketch", pen: "Pen", eraser: "Eraser",
    color: "Pen color", undo: "Undo last stroke", clear: "Clear sketch",
    cancel: "Cancel", attach: "Attach sketch", canvas: "Sketch canvas",
    hint: "Draw with your mouse, pen, or finger. The sketch is attached as a PNG image.",
  },
  ko: {
    title: "스케치 첨부", close: "스케치 닫기", pen: "펜", eraser: "지우개",
    color: "펜 색상", undo: "마지막 획 취소", clear: "스케치 지우기",
    cancel: "취소", attach: "스케치 첨부", canvas: "스케치 캔버스",
    hint: "마우스, 펜 또는 손가락으로 그리세요. 스케치는 PNG 이미지로 첨부됩니다.",
  },
};

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
  const labels = LABELS[useLocale()];
  const hintId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<{ pointerId: number; stroke: Stroke } | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [color, setColor] = useState("#111111");
  const [eraser, setEraser] = useState(false);

  useLayoutEffect(() => {
    if (canvas.current !== null) replay(canvas.current, strokes.current);
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
    <Modal
      open
      onClose={onClose}
      title={labels.title}
      closeLabel={labels.close}
      className={css.dialog}
      contentClassName={css.content}
      footer={
        <>
          <Button onClick={onClose}>{labels.cancel}</Button>
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
            {labels.attach}
          </Button>
        </>
      }
    >
      <div className={css.sketch}>
        <div className={css.toolbar}>
          <div className={css.tools} role="group" aria-label={labels.canvas}>
            <Button size="sm" variant={eraser ? "ghost" : "outline"} aria-pressed={!eraser} data-modal-autofocus onClick={() => setEraser(false)}>
              {labels.pen}
            </Button>
            <Button size="sm" variant={eraser ? "outline" : "ghost"} aria-pressed={eraser} onClick={() => setEraser(true)}>
              {labels.eraser}
            </Button>
            <label className={css.colorLabel}>
              {labels.color}
              <input className={css.color} type="color" value={color} onChange={(event) => { setColor(event.currentTarget.value); setEraser(false); }} />
            </label>
          </div>
          <div className={css.tools}>
            <Button size="sm" disabled={strokeCount === 0} onClick={() => {
              strokes.current.pop();
              setStrokeCount(strokes.current.length);
              if (canvas.current !== null) replay(canvas.current, strokes.current);
            }}>
              {labels.undo}
            </Button>
            <Button size="sm" disabled={strokeCount === 0} onClick={() => {
              strokes.current = [];
              setStrokeCount(0);
              if (canvas.current !== null) replay(canvas.current, strokes.current);
            }}>
              {labels.clear}
            </Button>
          </div>
        </div>
        <div className={css.paper}>
          <canvas
            ref={canvas}
            className={css.canvas}
            width={WIDTH}
            height={HEIGHT}
            tabIndex={0}
            aria-label={labels.canvas}
            aria-describedby={hintId}
            data-eraser={eraser || undefined}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={cancelStroke}
            onLostPointerCapture={cancelStroke}
          >
            {labels.hint}
          </canvas>
        </div>
        <p id={hintId} className={css.hint}>{labels.hint}</p>
      </div>
    </Modal>
  );
}
