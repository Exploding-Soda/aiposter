
import React from 'react';
import { PosterDraft } from '../types';
import { Edit2, Loader2, AlertCircle } from 'lucide-react';

interface PosterCardProps {
  poster: PosterDraft;
  onEdit: () => void;
  isLarge?: boolean;
}

const PosterCard: React.FC<PosterCardProps> = ({ poster, onEdit, isLarge = false }) => {
  const isGenerating = poster.status === 'generating' || poster.status === 'planning';

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
              src={poster.imageUrl} 
              alt="Poster Background" 
              className="absolute inset-0 w-full h-full object-contain transition-transform duration-700 group-hover:scale-[1.02]"
            />

            {/* Interaction Layer (Overlay only in gallery mode) */}
            {!isLarge && (
              <div className="absolute inset-0 bg-indigo-950/40 opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center p-6 z-40 backdrop-blur-[2px]">
                <button 
                  onClick={onEdit}
                  className="px-8 py-4 bg-white text-slate-900 rounded-full font-black flex items-center gap-3 shadow-2xl hover:scale-110 active:scale-95 transition-all uppercase tracking-widest text-xs pointer-events-auto"
                >
                  <Edit2 className="w-4 h-4" /> Refine Design
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PosterCard;
