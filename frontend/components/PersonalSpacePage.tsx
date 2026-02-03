import React, { useEffect, useRef, useState } from 'react';
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
import { fetchWithAuth, getAccessToken } from '../services/authService';

type DesignItem = {
  id: string;
  title: string;
  description: string;
  details: string[];
};

type GuidanceItem = {
  id: string;
  description: string;
  source: string;
  created_at: string;
};

type LogoItem = {
  webp: string;
  filename: string;
};

const PersonalSpacePage: React.FC = () => {
  const [selectedGuidance, setSelectedGuidance] = useState<DesignItem | null>(null);
  const [guidanceItems, setGuidanceItems] = useState<GuidanceItem[]>([]);
  const [guidanceLoading, setGuidanceLoading] = useState(true);
  const [guidanceError, setGuidanceError] = useState('');
  const [guidanceDraft, setGuidanceDraft] = useState('');
  const [guidanceSaving, setGuidanceSaving] = useState(false);
  const [isGuidanceEditorOpen, setIsGuidanceEditorOpen] = useState(false);
  const [editingGuidanceId, setEditingGuidanceId] = useState<string | null>(null);
  const [isDetailEditing, setIsDetailEditing] = useState(false);
  const [logos, setLogos] = useState<LogoItem[]>([]);
  const [logosLoading, setLogosLoading] = useState(false);
  const [logosError, setLogosError] = useState('');
  const [logoDeleting, setLogoDeleting] = useState<string | null>(null);
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const detailTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    console.log('File selected:', file.name);
  };

  const loadLogos = async () => {
    setLogosLoading(true);
    setLogosError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/logos`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load logos';
        throw new Error(message);
      }
      setLogos(Array.isArray(data.logos) ? data.logos : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load logos';
      setLogosError(message);
    } finally {
      setLogosLoading(false);
    }
  };

  const loadGuidanceItems = async () => {
    setGuidanceLoading(true);
    setGuidanceError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/design-guidance`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load design guidance';
        throw new Error(message);
      }
      setGuidanceItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load design guidance';
      setGuidanceError(message);
    } finally {
      setGuidanceLoading(false);
    }
  };

  useEffect(() => {
    void loadGuidanceItems();
    void loadLogos();
  }, []);

  useEffect(() => {
    if (!isDetailEditing) return;
    const textarea = detailTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [guidanceDraft, isDetailEditing]);

  const handleCreateGuidance = async () => {
    if (guidanceSaving) return;
    const description = guidanceDraft.trim();
    if (!description) return;
    setGuidanceSaving(true);
    setGuidanceError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/design-guidance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, source: 'text' })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to create design guidance';
        throw new Error(message);
      }
      if (data?.item) {
        setGuidanceItems((prev) => [data.item, ...prev]);
      } else {
        void loadGuidanceItems();
      }
      setGuidanceDraft('');
      setIsGuidanceEditorOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create design guidance';
      setGuidanceError(message);
    } finally {
      setGuidanceSaving(false);
    }
  };

  const handleOpenCreateGuidance = () => {
    setEditingGuidanceId(null);
    setGuidanceDraft('');
    setGuidanceError('');
    setIsGuidanceEditorOpen(true);
  };

  const handleOpenEditGuidance = (item: GuidanceItem) => {
    setEditingGuidanceId(item.id);
    setGuidanceDraft(item.description);
    setGuidanceError('');
    setSelectedGuidance({
      id: item.id,
      title: 'Guidance',
      description: item.description,
      details: [item.description]
    });
    setIsDetailEditing(true);
  };

  const handleUpdateGuidance = async () => {
    if (guidanceSaving || !editingGuidanceId) return;
    const description = guidanceDraft.trim();
    if (!description) return;
    setGuidanceSaving(true);
    setGuidanceError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/design-guidance/${editingGuidanceId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to update design guidance';
        throw new Error(message);
      }
      if (data?.item) {
        setGuidanceItems((prev) => prev.map((item) => (item.id === data.item.id ? data.item : item)));
        if (selectedGuidance?.id === data.item.id) {
          setSelectedGuidance({
            id: data.item.id,
            title: selectedGuidance.title,
            description: data.item.description,
            details: [data.item.description]
          });
        }
      } else {
        void loadGuidanceItems();
      }
      setGuidanceDraft('');
      setIsDetailEditing(false);
      setEditingGuidanceId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update design guidance';
      setGuidanceError(message);
    } finally {
      setGuidanceSaving(false);
    }
  };

  const handleDeleteGuidance = async (item: GuidanceItem) => {
    if (!window.confirm('Delete this guidance?')) return;
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/design-guidance/${item.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete design guidance';
        throw new Error(message);
      }
      setGuidanceItems((prev) => prev.filter((entry) => entry.id !== item.id));
      if (selectedGuidance?.id === item.id) {
        setSelectedGuidance(null);
        setIsDetailEditing(false);
        setEditingGuidanceId(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete design guidance';
      setGuidanceError(message);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setLogosError('');
    setIsLogoUploading(true);
    setLogoUploadProgress(0);
    try {
      const url = `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/logos/upload`;
      const token = getAccessToken();
      const response = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.withCredentials = true;
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.upload.onprogress = (evt) => {
          if (!evt.lengthComputable) return;
          const percent = Math.round((evt.loaded / evt.total) * 100);
          setLogoUploadProgress(percent);
        };
        xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
        xhr.onerror = () => reject(new Error('Failed to upload logo'));
        xhr.send(form);
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to upload logo';
        throw new Error(message);
      }
      await loadLogos();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload logo';
      setLogosError(message);
    } finally {
      setIsLogoUploading(false);
      setLogoUploadProgress(null);
      event.currentTarget.value = '';
    }
  };

  const handleDeleteLogo = async (logo: LogoItem) => {
    if (!window.confirm('Delete this logo?')) return;
    setLogosError('');
    setLogoDeleting(logo.filename);
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/logos/${encodeURIComponent(logo.filename)}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete logo';
        throw new Error(message);
      }
      setLogos((prev) => prev.filter((item) => item.filename !== logo.filename));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete logo';
      setLogosError(message);
    } finally {
      setLogoDeleting(null);
    }
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
                <div className="text-2xl font-black text-gray-900">Unlimited</div>
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
                    onClick={() => {
                      setSelectedGuidance(null);
                      setIsDetailEditing(false);
                      setEditingGuidanceId(null);
                    }}
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
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 px-3 py-2 bg-black text-white rounded-xl text-xs font-bold cursor-pointer hover:bg-gray-800 transition-all">
                    <Upload size={14} />
                    <span>Upload PDF</span>
                    <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
                  </label>
                  <button
                    type="button"
                    onClick={handleOpenCreateGuidance}
                    className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all"
                  >
                    <Plus size={14} />
                    Add new guidance
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {!selectedGuidance ? (
                <div className="space-y-3">
                  {guidanceLoading ? (
                    <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading guidance...</div>
                  ) : guidanceItems.length > 0 ? (
                    guidanceItems.map((item, index) => (
                      <div
                        key={item.id}
                        className="p-4 flex items-center justify-between hover:bg-gray-50 rounded-2xl group transition-colors"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            {
                              setSelectedGuidance({
                                id: item.id,
                                title: `Guidance ${index + 1}`,
                                description: item.description,
                                details: [item.description]
                              });
                              setIsDetailEditing(false);
                              setEditingGuidanceId(null);
                            }
                          }
                          className="flex-1 flex items-center gap-4 text-left"
                        >
                          <div className="p-2 bg-gray-50 text-gray-400 group-hover:text-blue-500 group-hover:bg-blue-50 rounded-xl transition-colors">
                            <FileType size={20} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900">
                              {item.description.length > 60 ? `${item.description.slice(0, 60)}...` : item.description}
                            </p>
                            <p className="text-xs text-gray-500">Source: {item.source}</p>
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenEditGuidance(item)}
                            className="text-xs font-semibold text-gray-500 hover:text-gray-900"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteGuidance(item)}
                            className="text-xs font-semibold text-red-500 hover:text-red-600"
                          >
                            Delete
                          </button>
                          <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-900 transition-all group-hover:translate-x-1" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-48 flex flex-col items-center justify-center text-gray-400">
                      <FileText size={48} strokeWidth={1} className="mb-2 opacity-20" />
                      <p className="text-sm font-medium">No design guidance yet</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 space-y-4 animate-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                      Guidance Details
                    </div>
                    {!isDetailEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGuidanceId(selectedGuidance.id);
                          setGuidanceDraft(selectedGuidance.description);
                          setGuidanceError('');
                          setIsDetailEditing(true);
                        }}
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                  {isDetailEditing ? (
                    <div className="space-y-3">
                      <textarea
                        ref={detailTextareaRef}
                        value={guidanceDraft}
                        onChange={(event) => setGuidanceDraft(event.target.value)}
                        placeholder="Update guidance description..."
                        className="w-full min-h-[140px] resize-none overflow-hidden rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                      {guidanceError && (
                        <div className="text-xs text-red-600">{guidanceError}</div>
                      )}
                      <div className="flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => {
                            setGuidanceDraft(selectedGuidance.description);
                            setGuidanceError('');
                            setIsDetailEditing(false);
                            setEditingGuidanceId(null);
                          }}
                          className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleUpdateGuidance}
                          disabled={!guidanceDraft.trim() || guidanceSaving}
                          className="px-4 py-2 rounded-xl bg-black text-white text-xs font-semibold disabled:opacity-50"
                        >
                          {guidanceSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {selectedGuidance.details.map((detail, idx) => (
                        <li key={idx} className="flex items-start gap-3 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          <span className="text-sm text-gray-700 font-medium break-words whitespace-pre-wrap">
                            {detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
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
                <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>

            {logosError && (
              <div className="text-xs text-red-600 mb-3">{logosError}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {logosLoading && logos.length === 0 ? (
                <div className="col-span-full text-sm text-gray-400">Loading logos...</div>
              ) : (
                logos.map((logo, idx) => (
                  <div key={logo.filename || String(idx)} className="aspect-square bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden relative group shadow-sm">
                    <img src={`${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}${logo.webp}`} alt={`Logo ${idx + 1}`} className="w-full h-full object-contain p-4 transition-transform group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDeleteLogo(logo)}
                        disabled={logoDeleting === logo.filename}
                        className="px-3 py-1 rounded-full bg-white text-[10px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                      >
                        {logoDeleting === logo.filename ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))
              )}
              <label className="aspect-square border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-emerald-400 hover:text-emerald-500 hover:bg-emerald-50/30 transition-all cursor-pointer">
                <Plus size={24} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Add Logo</span>
                <input type="file" className="hidden" accept="image/*" onChange={handleLogoUpload} />
              </label>
            </div>
          </section>

        </div>
      </div>

      <div className="pt-8 text-center text-[10px] text-gray-300 font-medium tracking-widest uppercase">
        Personal Space Console • 2026 Release
      </div>

      {isGuidanceEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">Add new guidance</h3>
              <button
                type="button"
                onClick={() => {
                  setGuidanceDraft('');
                  setGuidanceError('');
                  setIsGuidanceEditorOpen(false);
                }}
                className="text-xs font-semibold text-gray-500 hover:text-gray-900"
              >
                Close
              </button>
            </div>
            <textarea
              value={guidanceDraft}
              onChange={(event) => setGuidanceDraft(event.target.value)}
              placeholder="Type one design guidance description..."
              className="w-full min-h-[140px] resize-y rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {guidanceError && (
              <div className="text-xs text-red-600 mt-2">{guidanceError}</div>
            )}
            <div className="flex items-center justify-between mt-5">
              <button
                type="button"
                onClick={() => {
                  setGuidanceDraft('');
                  setGuidanceError('');
                  setIsGuidanceEditorOpen(false);
                }}
                className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGuidance}
                disabled={!guidanceDraft.trim() || guidanceSaving}
                className="px-4 py-2 rounded-xl bg-black text-white text-xs font-semibold disabled:opacity-50"
              >
                {guidanceSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLogoUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="text-sm font-semibold text-gray-900 mb-2">Uploading logo</div>
            <div className="text-xs text-gray-400 mb-4">Please keep this window open.</div>
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${logoUploadProgress ?? 0}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-3">
              {logoUploadProgress === null ? 'Starting...' : `${logoUploadProgress}%`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalSpacePage;
