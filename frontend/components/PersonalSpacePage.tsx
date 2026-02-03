import React, { useState } from 'react';
import {
  Globe,
  HardDrive,
  FileText,
  FileType,
  Upload,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Plus
} from 'lucide-react';

type DesignItem = {
  id: string;
  title: string;
  description: string;
  details: string[];
};

const PersonalSpacePage: React.FC = () => {
  const [selectedGuidance, setSelectedGuidance] = useState<DesignItem | null>(null);
  const [logos] = useState<string[]>([
    'https://picsum.photos/id/101/200/200',
    'https://picsum.photos/id/102/200/200',
    'https://picsum.photos/id/103/200/200',
    'https://picsum.photos/id/104/200/200'
  ]);

  const designGuidanceItems: DesignItem[] = [
    {
      id: '1',
      title: 'Typography System',
      description: 'Hierarchy, spacing, and fallback rules',
      details: [
        'Primary: Satoshi Bold for headlines',
        'Secondary: Inter Regular for body text',
        'Line height 1.4 for headings, 1.6 for body',
        'Use negative tracking on large headlines'
      ]
    },
    {
      id: '2',
      title: 'Color Tokens 2026',
      description: 'Brand palette and semantic colors',
      details: [
        'Primary: #111827 (Graphite)',
        'Surface: #F5F5F7 (Cloud)',
        'Accent: #22D3EE (Cyan)',
        'Success: #10B981 (Emerald)'
      ]
    },
    {
      id: '3',
      title: 'Layout Grid',
      description: 'Spacing grid and container rules',
      details: [
        'Base grid: 8px with 4px half-steps',
        'Cards: 24px padding, 16px radius',
        'Max width: 1180px',
        'Keep 64px min spacing on hero layouts'
      ]
    }
  ];

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    console.log('File selected:', file.name);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <section className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                <Globe size={18} />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Language & Region</h3>
            </div>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Primary</div>
                <div className="text-sm font-semibold text-gray-800">English (US)</div>
              </div>
              <div className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">Active</div>
            </div>
            <p className="text-[11px] text-gray-400 mt-4">Additional locales will follow the next release.</p>
          </section>

          <section className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
                <HardDrive size={18} />
              </div>
              <h3 className="font-bold text-gray-900 text-sm">Storage</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Plan</div>
                  <div className="text-2xl font-black text-gray-900">Unlimited</div>
                </div>
                <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full">Enterprise</span>
              </div>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 w-[22%] rounded-full" />
              </div>
              <p className="text-xs text-gray-500">No storage limit for the current workspace.</p>
            </div>
          </section>

        </div>

        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden min-h-[420px] flex flex-col">
            <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                {selectedGuidance ? (
                  <button
                    onClick={() => setSelectedGuidance(null)}
                    className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                ) : (
                  <div className="p-2 bg-orange-50 text-orange-600 rounded-xl">
                    <FileText size={18} />
                  </div>
                )}
                <h3 className="font-bold text-gray-900">
                  {selectedGuidance ? selectedGuidance.title : 'Design Guidance'}
                </h3>
              </div>

              {!selectedGuidance && (
                <label className="flex items-center gap-2 px-3 py-2 bg-black text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-gray-800 transition-all">
                  <Upload size={14} />
                  <span>Upload PDF</span>
                  <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
                </label>
              )}
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {!selectedGuidance ? (
                <div className="space-y-2">
                  {designGuidanceItems.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedGuidance(item)}
                      className="p-4 flex items-center justify-between hover:bg-gray-50 rounded-2xl cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-gray-50 text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 rounded-xl transition-colors">
                          <FileType size={20} />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{item.title}</p>
                          <p className="text-xs text-gray-500">{item.description}</p>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-900 transition-all group-hover:translate-x-1" />
                    </div>
                  ))}
                  {designGuidanceItems.length === 0 && (
                    <div className="h-64 flex flex-col items-center justify-center text-gray-400">
                      <FileText size={48} strokeWidth={1} className="mb-2 opacity-20" />
                      <p className="text-sm font-medium">No design guidance uploaded yet</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 space-y-4 animate-in slide-in-from-right-4 duration-300">
                  <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50">
                    <p className="text-xs text-blue-700 font-medium leading-relaxed">
                      Detailed specifications and implementation rules for {selectedGuidance.title.toLowerCase()}.
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {selectedGuidance.details.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                        <span className="text-sm text-gray-700 font-medium">{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                  <ImageIcon size={18} />
                </div>
                <h3 className="font-bold text-gray-900">Logo Assets</h3>
              </div>
              <label className="p-2 hover:bg-gray-100 rounded-full cursor-pointer transition-colors">
                <Plus size={20} className="text-gray-400 hover:text-gray-900" />
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {logos.map((logo, idx) => (
                <div key={idx} className="aspect-square bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden relative group shadow-sm">
                  <img src={logo} alt={`Logo ${idx + 1}`} className="w-full h-full object-contain p-4 transition-transform group-hover:scale-110" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button className="p-2 bg-white rounded-lg text-gray-900 hover:bg-gray-100">
                      <Upload size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <label className="aspect-square border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-emerald-400 hover:text-emerald-500 hover:bg-emerald-50/30 transition-all cursor-pointer">
                <Plus size={24} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Add Logo</span>
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </label>
            </div>
          </section>

        </div>
      </div>

      <div className="pt-8 text-center text-[10px] text-gray-300 font-medium tracking-widest uppercase">
        Personal Space Console • 2026 Release
      </div>
    </div>
  );
};

export default PersonalSpacePage;
