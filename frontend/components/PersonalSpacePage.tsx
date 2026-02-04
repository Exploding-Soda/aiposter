import React, { useEffect, useState } from 'react';
import {
  Globe,
  HardDrive,
  FileText,
  Image as ImageIcon,
  Plus
} from 'lucide-react';
import { fetchWithAuth, getAccessToken } from '../services/authService';

type ReferenceStyleItem = {
  id: string;
  original_name: string;
  file_path: string;
  thumbnail_path?: string | null;
  mime_type?: string | null;
  created_at: string;
};

type LogoItem = {
  webp: string;
  filename: string;
};

const PersonalSpacePage: React.FC = () => {
  const [referenceStyles, setReferenceStyles] = useState<ReferenceStyleItem[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState('');
  const [referenceDeleting, setReferenceDeleting] = useState<string | null>(null);
  const [referenceUploadProgress, setReferenceUploadProgress] = useState<number | null>(null);
  const [isReferenceUploading, setIsReferenceUploading] = useState(false);
  const [logos, setLogos] = useState<LogoItem[]>([]);
  const [logosLoading, setLogosLoading] = useState(false);
  const [logosError, setLogosError] = useState('');
  const [logoDeleting, setLogoDeleting] = useState<string | null>(null);
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewImageName, setPreviewImageName] = useState<string | null>(null);
  const [previewImageSize, setPreviewImageSize] = useState<{ width: number; height: number } | null>(null);
  const [isPreviewClosing, setIsPreviewClosing] = useState(false);

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

  const loadReferenceStyles = async () => {
    setReferenceLoading(true);
    setReferenceError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/reference-styles`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load reference styles';
        throw new Error(message);
      }
      setReferenceStyles(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load reference styles';
      setReferenceError(message);
    } finally {
      setReferenceLoading(false);
    }
  };

  useEffect(() => {
    void loadReferenceStyles();
    void loadLogos();
  }, []);

  const handleReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceError('');
    setIsReferenceUploading(true);
    setReferenceUploadProgress(0);
    try {
      const url = `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/reference-styles/upload`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        const token = getAccessToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.withCredentials = true;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setReferenceUploadProgress(percent);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            const message = typeof data?.detail === 'string' ? data.detail : 'Failed to upload reference style';
            reject(new Error(message));
          } catch (parseError) {
            reject(parseError);
          }
        };
        xhr.onerror = () => reject(new Error('Failed to upload reference style'));
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
      await loadReferenceStyles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload reference style';
      setReferenceError(message);
    } finally {
      setIsReferenceUploading(false);
      setReferenceUploadProgress(null);
      event.target.value = '';
    }
  };

  const handleDeleteReferenceStyle = async (item: ReferenceStyleItem) => {
    if (!window.confirm('Delete this reference style?')) return;
    setReferenceError('');
    setReferenceDeleting(item.id);
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/reference-styles/${item.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete reference style';
        throw new Error(message);
      }
      setReferenceStyles((prev) => prev.filter((entry) => entry.id !== item.id));
      if (selectedStyle?.id === item.id) {
        setSelectedStyle(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete reference style';
      setReferenceError(message);
    } finally {
      setReferenceDeleting(null);
    }
  };

  const handleOpenReferencePreview = (item: ReferenceStyleItem) => {
    const baseUrl = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';
    setPreviewImageUrl(`${baseUrl}/reference/${item.file_path}`);
    setPreviewImageName(item.original_name);
    setPreviewImageSize(null);
    setIsPreviewClosing(false);
  };

  const handleOpenLogoPreview = (logo: LogoItem) => {
    const baseUrl = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';
    setPreviewImageUrl(`${baseUrl}${logo.webp}`);
    setPreviewImageName(logo.filename || 'Logo');
    setPreviewImageSize(null);
    setIsPreviewClosing(false);
  };

  const handleClosePreview = () => {
    if (isPreviewClosing) return;
    setIsPreviewClosing(true);
    window.setTimeout(() => {
      setPreviewImageUrl(null);
      setPreviewImageName(null);
      setPreviewImageSize(null);
      setIsPreviewClosing(false);
    }, 220);
  };

  const getPreviewDimensions = () => {
    if (!previewImageSize) return undefined;
    const maxWidth = Math.min(window.innerWidth * 0.9, previewImageSize.width);
    const maxHeight = Math.min(window.innerHeight * 0.8, previewImageSize.height);
    const scale = Math.min(maxWidth / previewImageSize.width, maxHeight / previewImageSize.height, 1);
    return {
      width: Math.round(previewImageSize.width * scale),
      height: Math.round(previewImageSize.height * scale)
    };
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
          <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-xl">
                  <FileText size={18} />
                </div>
                <h3 className="font-bold text-gray-900">Reference Styles</h3>
              </div>

              <label className="p-2 hover:bg-gray-100 rounded-full cursor-pointer transition-colors">
                <Plus size={20} className="text-gray-400 hover:text-gray-900" />
                <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} />
              </label>
            </div>

            <div className="flex-1">
              {referenceError && (
                <div className="text-xs text-red-600 mb-3">{referenceError}</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {referenceLoading && referenceStyles.length === 0 ? (
                  <div className="col-span-full text-sm text-gray-400">Loading reference styles...</div>
                ) : referenceStyles.length > 0 ? (
                  referenceStyles.map((item) => (
                    <div
                      key={item.id}
                      className="aspect-square bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden relative group shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenReferencePreview(item)}
                        className="absolute inset-0"
                        aria-label={`Preview ${item.original_name}`}
                      >
                        <img
                          src={`${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/reference/${item.thumbnail_path || item.file_path}`}
                          alt={item.original_name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        />
                      </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteReferenceStyle(item)}
                      disabled={referenceDeleting === item.id}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-white text-xs font-bold shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                      aria-label="Delete reference style"
                    >
                      x
                    </button>
                  </div>
                  ))
                ) : null}
                <label className="aspect-square border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-orange-400 hover:text-orange-500 hover:bg-orange-50/30 transition-all cursor-pointer">
                  <Plus size={24} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Add Image</span>
                  <input type="file" className="hidden" accept="image/*" onChange={handleReferenceUpload} />
                </label>
              </div>
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
                    <button
                      type="button"
                      onClick={() => handleOpenLogoPreview(logo)}
                      className="absolute inset-0"
                      aria-label={`Preview logo ${idx + 1}`}
                    >
                      <img src={`${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}${logo.webp}`} alt={`Logo ${idx + 1}`} className="w-full h-full object-contain p-4 transition-transform group-hover:scale-110" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLogo(logo)}
                      disabled={logoDeleting === logo.filename}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-white text-xs font-bold shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                      aria-label="Delete logo"
                    >
                      x
                    </button>
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

      {isReferenceUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="text-sm font-semibold text-gray-900 mb-2">Uploading reference</div>
            <div className="text-xs text-gray-400 mb-4">Please keep this window open.</div>
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all"
                style={{ width: `${referenceUploadProgress ?? 0}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-3">
              {referenceUploadProgress === null ? 'Starting...' : `${referenceUploadProgress}%`}
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

      {previewImageUrl && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${isPreviewClosing ? 'opacity-0' : 'opacity-100'}`}
          onClick={handleClosePreview}
        >
          <div
            className={`relative rounded-3xl bg-white p-3 shadow-2xl transition-transform duration-200 ${isPreviewClosing ? 'scale-95' : 'scale-100'}`}
            style={getPreviewDimensions()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="rounded-2xl bg-gray-50 flex items-center justify-center overflow-hidden">
              <img
                src={previewImageUrl}
                alt={previewImageName || 'Preview'}
                className="w-full h-full object-contain"
                onLoad={(event) => {
                  const target = event.currentTarget;
                  if (target.naturalWidth && target.naturalHeight) {
                    setPreviewImageSize({ width: target.naturalWidth, height: target.naturalHeight });
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalSpacePage;
