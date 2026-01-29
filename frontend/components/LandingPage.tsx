import React, { useEffect, useState } from 'react';

type LandingPageProps = {
  onStartCreating: () => void;
};

const LandingPage: React.FC<LandingPageProps> = ({ onStartCreating }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), 100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen w-full flex bg-white text-zinc-900 relative overflow-hidden font-['Inter']">
      <LandingBackground />

      <main
        className={`flex-1 flex flex-col justify-center px-8 md:px-24 lg:px-32 relative z-10 transition-opacity duration-1000 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="max-w-7xl w-full flex flex-col lg:flex-row items-center justify-between gap-12 animate-fade-in">
          <div className="max-w-3xl relative">
            <h1 className="text-5xl sm:text-6xl md:text-8xl font-bold tracking-tighter leading-[0.85] mb-10">
              Automating <br />
              <span className="text-zinc-400">High-End</span> Visuals.
            </h1>

            <p className="text-lg sm:text-xl md:text-2xl text-zinc-500 font-light max-w-xl leading-relaxed">
              Visionary AI Studio provides private generative infrastructure for global marketing teams.
              Precision-engineered assets at the speed of thought.
            </p>
          </div>

          <div className="flex-1 flex justify-center lg:justify-end w-full">
            <div className="relative p-3 border border-zinc-100/50 rounded-lg">
              <button
                type="button"
                onClick={onStartCreating}
                className="group px-16 sm:px-20 py-10 sm:py-12 bg-zinc-900 text-white rounded-sm font-bold text-xs sm:text-sm uppercase tracking-[0.4em] hover:bg-zinc-800 transition-all shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18)] transform hover:-translate-y-2 active:translate-y-0 active:scale-[0.98] relative overflow-hidden"
              >
                <span className="relative z-10">Start Creating</span>
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t border-r border-zinc-300"></div>
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b border-l border-zinc-300"></div>
            </div>
          </div>
        </div>
      </main>

      <div
        className={`absolute bottom-8 left-6 md:bottom-10 md:left-12 flex items-center space-x-4 text-[10px] font-mono text-zinc-400 tracking-widest uppercase transition-opacity duration-1000 delay-500 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <span className="w-8 h-[1px] bg-zinc-200"></span>
        <span>40.7128 N // V.Studio-01</span>
      </div>

      <div
        className={`absolute bottom-8 right-6 md:bottom-10 md:right-12 text-[10px] font-mono text-zinc-400 tracking-widest uppercase transition-opacity duration-1000 delay-700 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        (c) 2025 Visionary.Aesthetica
      </div>
    </div>
  );
};

const LandingBackground: React.FC = () => (
  <div className="bg-sophisticated">
    <div className="noise-overlay"></div>

    <div className="scanline" style={{ animationDelay: '3s' }}></div>

    <div
      className="absolute inset-0 opacity-[0.02]"
      style={{
        backgroundImage: 'radial-gradient(#000 0.5px, transparent 0.5px)',
        backgroundSize: '60px 60px'
      }}
    ></div>

    <div className="corner-decoration top-8 left-8 opacity-30"></div>
    <div className="corner-decoration bottom-8 right-8 opacity-30 rotate-180"></div>

    <div className="absolute left-[10%] top-0 bottom-0 w-[1px] bg-zinc-200/30 hidden md:block"></div>

    <div className="absolute bottom-[15%] left-[5%] opacity-[0.07] rotate-90 origin-left">
      <span className="text-[12px] font-mono tracking-[1em] uppercase">System Integration // v2.5.0</span>
    </div>
  </div>
);

export default LandingPage;
