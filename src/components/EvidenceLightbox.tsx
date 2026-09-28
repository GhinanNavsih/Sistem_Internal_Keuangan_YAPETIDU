"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  X,
} from 'lucide-react';

interface EvidenceLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  title?: string;
}

function EvidenceLightboxContent({
  imageUrl,
  title,
  onClose,
}: {
  imageUrl: string;
  title: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);

  const effectivePan = zoom <= 1 ? { x: 0, y: 0 } : pan;
  const isPdf = /\.pdf(?:[?#]|$)/i.test(imageUrl);

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    panRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: effectivePan.x,
      panY: effectivePan.y,
      moved: false,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    const p = panRef.current;
    if (!p) return;
    const dx = event.clientX - p.startX;
    const dy = event.clientY - p.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) p.moved = true;
    setPan({ x: p.panX + dx, y: p.panY + dy });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const p = panRef.current;
    setIsPanning(false);
    if (p && !p.moved) {
      setZoom((z) => (z > 1 ? 1 : 2));
    }
    panRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/95 p-4 shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      {/* Header bar */}
      <div className="mb-3 flex w-full shrink-0 items-center justify-between border-b border-white/10 px-2 pb-3">
        <div className="flex min-w-0 items-center gap-2.5 pr-4">
          <FileText className="h-5 w-5 shrink-0 text-indigo-400" />
          <span className="truncate text-xs font-semibold text-white sm:text-sm">
            {title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isPdf && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))
                }
                disabled={zoom <= 0.5}
                className="h-8 w-8 rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                title="Perkecil"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-10 select-none text-center text-[11px] font-bold text-slate-300">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))
                }
                disabled={zoom >= 4}
                className="h-8 w-8 rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                title="Perbesar"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="h-8 w-8 rounded-full text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Putar 90°"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </>
          )}
          <a
            href={imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-indigo-500"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Buka di Tab Baru</span>
            <span className="sm:hidden">Buka</span>
          </a>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="ml-1 h-8 w-8 rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            title="Tutup"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex w-full flex-1 items-center justify-center overflow-hidden rounded-2xl bg-slate-950/60">
        {isPdf ? (
          <iframe
            src={imageUrl}
            className="h-full w-full rounded-2xl border-none bg-white"
            title={title}
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={title}
            draggable={false}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`max-w-none select-none rounded-2xl object-contain shadow-2xl touch-none ${
              isPanning ? '' : 'transition-transform duration-150'
            } ${
              zoom <= 1
                ? 'cursor-zoom-in'
                : isPanning
                  ? 'cursor-grabbing'
                  : 'cursor-zoom-out'
            }`}
            style={{
              transform: `translate(${effectivePan.x}px, ${effectivePan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
              maxHeight: rotation % 180 === 0 ? '82vh' : '65vw',
              maxWidth: rotation % 180 === 0 ? '100%' : '82vh',
            }}
          />
        )}
      </div>
    </div>
  );
}

export function EvidenceLightbox({
  isOpen,
  onClose,
  imageUrl,
  title = 'Dokumen Bukti Presensi',
}: EvidenceLightboxProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/80 p-4 backdrop-blur-md sm:p-6"
      onClick={onClose}
    >
      <EvidenceLightboxContent
        key={imageUrl}
        imageUrl={imageUrl}
        title={title}
        onClose={onClose}
      />
    </div>
  );
}
