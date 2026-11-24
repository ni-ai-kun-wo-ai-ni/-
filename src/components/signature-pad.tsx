'use client';
import { useEffect, useRef, type PointerEvent } from 'react';

export default function SignaturePad({
  id,
  label,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  disabled: boolean;
  onChange: (file: File | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const hasInk = useRef(false);
  const reset = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    pointer.current = null;
    hasInk.current = false;
  };
  useEffect(() => {
    reset();
  }, []);
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((e.clientX - rect.left) * 1000) / rect.width)),
      y: Math.max(0, Math.min(360, ((e.clientY - rect.top) * 360) / rect.height)),
    };
  }
  function finish(e: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== e.pointerId) return;
    pointer.current = null;
    if (!hasInk.current || disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    onChange(new File([bytes], '手写签名.png', { type: 'image/png' }));
  }
  return (
    <div className="signature-pad">
      <p className="muted" id={`${id}-help`}>
        请用鼠标或手指在下方签名。提交前可清空重写；重签会在保存后替换原签名。
      </p>
      <canvas
        id={id}
        ref={canvasRef}
        width={1000}
        height={360}
        aria-label={`${label}手写区域`}
        aria-describedby={`${id}-help`}
        onPointerDown={(e) => {
          if (disabled || !e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pointer.current = e.pointerId;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (disabled || pointer.current !== e.pointerId) return;
          e.preventDefault();
          const next = point(e);
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          if (Math.hypot(next.x - last.current.x, next.y - last.current.y) < 0.5) return;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(next.x, next.y);
          ctx.strokeStyle = '#163c34';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
          last.current = next;
          hasInk.current = true;
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      >
        请使用支持手写画布的浏览器。
      </canvas>
      <button
        className="secondary"
        type="button"
        disabled={disabled}
        onClick={() => {
          reset();
          onChange(null);
        }}
      >
        清空重写
      </button>
    </div>
  );
}
