
import React from 'react';
import { PosterDraft } from '../types';
import { Eye, Download, Loader2, AlertCircle } from 'lucide-react';

const BACKEND_API = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';
const normalizeSecureImageUrl = (value?: string | null): string => {
  if (!value) return '';
  if (typeof window !== 'undefined' && window.location.protocol === 'https:' && value.startsWith('http://')) {
    return `https://${value.slice('http://'.length)}`;
  }
  return value;
};
const resolveProjectImageUrl = (value?: string | null): string => {
  if (!value) return '';
  if (value.startsWith('file://db/files/')) {
    const path = value.replace('file://db/files/', '');
    return normalizeSecureImageUrl(`${BACKEND_API}/files/${path}`);
  }
  return normalizeSecureImageUrl(value);
};

interface PosterCardProps {
  poster: PosterDraft;
  onEdit: () => void;
  onDownload: () => void;
  isLarge?: boolean;
  isPasteLogoMode?: boolean;
}

const PosterCard: React.FC<PosterCardProps> = ({
  poster,
  onEdit,
  onDownload,
  isLarge = false,
  isPasteLogoMode = false
}) => {
  const isGenerating = poster.status === 'generating' || poster.status === 'planning';
  const shouldOverlayLogo = isPasteLogoMode && Boolean(poster.logoUrl);
  const displayImageUrl = resolveProjectImageUrl(
    shouldOverlayLogo
      ? (poster.imageUrl || poster.imageUrlMerged)
      : (poster.imageUrlMerged || poster.imageUrl)
  );
  const displayLogoUrl = resolveProjectImageUrl(poster.logoUrl);

  return (
    <div className={`group relative bg-slate-800 overflow-hidden shadow-2xl border border-white/10 transition-all duration-500 ${isLarge ? 'w-full h-full mx-auto' : 'aspect-[9/16] hover:shadow-indigo-500/20 hover:-translate-y-2'}`}>
      <div className="w-full h-full relative bg-slate-900 flex items-center justify-center overflow-hidden">
        {isGenerating ? (
          <div className="flex flex-col items-center gap-4 text-slate-500">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
            <span className="text-xs font-bold tracking-[0.2em] uppercase animate-pulse">Designing...</span>
          </div>
        ) : poster.status === 'error' ? (
          <div className="flex flex-col items-center gap-3 text-rose-500 px-6 text-center">
            <AlertCircle className="w-8 h-8" />
            <span className="text-sm font-bold tracking-tight">Generation Failed</span>
          </div>
        ) : (
          <div className="w-full h-full relative font-serif select-none">
            {/* Background Layer */}
            <img 
              src={displayImageUrl} 
              alt="Poster Background" 
              className="absolute inset-0 w-full h-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
            />
            {shouldOverlayLogo && displayLogoUrl && (
              <div
                className="absolute z-10"
                style={{
                  left: `${(poster.logoPlacement?.x ?? 0) * 100}%`,
                  top: `${(poster.logoPlacement?.y ?? 0) * 100}%`,
                  width: `${(poster.logoPlacement?.width ?? 0.2) * 100}%`,
                  height: `${(poster.logoPlacement?.height ?? 0.12) * 100}%`
                }}
              >
                <img
                  src={displayLogoUrl}
                  alt="Poster Logo"
                  className="w-full h-full object-contain pointer-events-none select-none"
                />
              </div>
            )}

            <div className="absolute inset-0 z-40 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none">
              <div className="pointer-events-auto flex h-11 w-32 overflow-hidden rounded-full border border-white/45 bg-white/35 shadow-2xl backdrop-blur-md">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onEdit();
                  }}
                  className="flex-[3] flex items-center justify-center gap-1.5 bg-white/20 text-slate-900 transition hover:bg-white/35 active:bg-white/45"
                  aria-label="Refine Poster"
                  title="Refine Poster"
                >
                  <Eye className="h-4 w-4" />
                </button>
                <div className="my-2 w-px bg-white/40" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDownload();
                  }}
                  className="flex-[1] flex items-center justify-center bg-white/20 text-slate-900 transition hover:bg-white/35 active:bg-white/45"
                  aria-label="Download Poster"
                  title="Download Poster"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PosterCard;
