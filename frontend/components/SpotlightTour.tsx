import React from 'react';

type SpotlightTourProps = {
  open: boolean;
  targetRect: DOMRect | null;
  title: string;
  content: React.ReactNode;
  onClose: () => void;
  closeLabel?: string;
  onNext?: () => void;
  nextLabel?: string;
  onBack?: () => void;
  backLabel?: string;
  onSkip?: () => void;
  skipLabel?: string;
  stepLabel?: string;
  spotlightPadding?: number;
};

const getCardPosition = (
  targetRect: DOMRect | null,
  preferredWidth: number,
  preferredHeight = 300
) => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;
  const width = Math.min(preferredWidth, viewportWidth - margin * 2);

  if (!targetRect) {
    return {
      width,
      left: Math.max(margin, (viewportWidth - width) / 2),
      top: Math.max(margin, (viewportHeight - preferredHeight) / 2)
    };
  }

  const centeredLeft = targetRect.left + targetRect.width / 2 - width / 2;
  const left = Math.min(Math.max(margin, centeredLeft), viewportWidth - width - margin);
  const canPlaceBelow = targetRect.bottom + preferredHeight + 28 <= viewportHeight - margin;
  const top = canPlaceBelow
    ? targetRect.bottom + 20
    : Math.max(margin, targetRect.top - preferredHeight - 20);

  return { width, left, top };
};

const SpotlightTour: React.FC<SpotlightTourProps> = ({
  open,
  targetRect,
  title,
  content,
  onClose,
  closeLabel = 'Close',
  onNext,
  nextLabel = 'Next',
  onBack,
  backLabel = 'Back',
  onSkip,
  skipLabel = 'Skip',
  stepLabel,
  spotlightPadding = 12
}) => {
  if (!open) return null;

  const position = getCardPosition(targetRect, 420);
  const spotlightStyle = targetRect
    ? {
        left: Math.max(8, targetRect.left - spotlightPadding),
        top: Math.max(8, targetRect.top - spotlightPadding),
        width: targetRect.width + spotlightPadding * 2,
        height: targetRect.height + spotlightPadding * 2
      }
    : null;

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-slate-950/58 backdrop-blur-[2px]" onClick={onClose} />
      {spotlightStyle && (
        <div
          className="absolute rounded-[28px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.56)] transition-all duration-200 pointer-events-none"
          style={spotlightStyle}
        />
      )}
      <div
        className="absolute rounded-[28px] border border-slate-200 bg-white p-5 shadow-2xl"
        style={{ width: position.width, left: position.left, top: position.top }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            {stepLabel && (
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                {stepLabel}
              </div>
            )}
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:border-slate-300"
          >
            {closeLabel}
          </button>
        </div>
        <div className="mt-4 text-sm leading-6 text-slate-600">{content}</div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                className="rounded-full px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                {skipLabel}
              </button>
            )}
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              >
                {backLabel}
              </button>
            )}
          </div>
          {onNext && (
            <button
              type="button"
              onClick={onNext}
              className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              {nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpotlightTour;
