import React, { useEffect, useRef, useState } from 'react';
import {
  Globe,
  HardDrive,
  FileText,
  Image as ImageIcon,
  Droplets,
  Pipette,
  Plus,
  Info
} from 'lucide-react';
import { fetchWithAuth, getAccessToken } from '../services/authService';
import SpotlightTour from './SpotlightTour';
import { fontExampleImage, logoExampleImage, refPosterOne } from '../onboardingAssets';

type ReferenceStyleItem = {
  id: string;
  original_name: string;
  file_path: string;
  thumbnail_path?: string | null;
  mime_type?: string | null;
  created_at: string;
};

type FontReferenceItem = {
  id: string;
  original_name: string;
  file_path: string;
  thumbnail_path?: string | null;
  mime_type?: string | null;
  created_at: string;
};

type LogoItem = {
  png?: string;
  webp: string;
  filename: string;
};

type PrimaryColorGroupItem = {
  id: string;
  name?: string | null;
  colors: string[];
  created_at: string;
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const normalizeHexInput = (value: string) => {
  const sanitized = value.toUpperCase().replace(/[^#0-9A-F]/g, '');
  if (!sanitized) return '#';
  if (sanitized.startsWith('#')) {
    return `#${sanitized.slice(1, 7)}`;
  }
  return `#${sanitized.slice(0, 6)}`;
};

const PERSONAL_SPACE_ONBOARDING_STORAGE_KEY = 'poster-onboarding-personal-space-v1';

const PersonalSpacePage: React.FC = () => {
  const [referenceStyles, setReferenceStyles] = useState<ReferenceStyleItem[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState('');
  const [referenceDeleting, setReferenceDeleting] = useState<string | null>(null);
  const [referenceUploadProgress, setReferenceUploadProgress] = useState<number | null>(null);
  const [isReferenceUploading, setIsReferenceUploading] = useState(false);
  const [fontReferences, setFontReferences] = useState<FontReferenceItem[]>([]);
  const [fontReferenceLoading, setFontReferenceLoading] = useState(true);
  const [fontReferenceError, setFontReferenceError] = useState('');
  const [fontReferenceDeleting, setFontReferenceDeleting] = useState<string | null>(null);
  const [fontReferenceUploadProgress, setFontReferenceUploadProgress] = useState<number | null>(null);
  const [isFontReferenceUploading, setIsFontReferenceUploading] = useState(false);
  const [primaryColors, setPrimaryColors] = useState<PrimaryColorGroupItem[]>([]);
  const [primaryColorsLoading, setPrimaryColorsLoading] = useState(true);
  const [primaryColorsError, setPrimaryColorsError] = useState('');
  const [primaryColorDeleting, setPrimaryColorDeleting] = useState<string | null>(null);
  const [isPrimaryColorSaving, setIsPrimaryColorSaving] = useState(false);
  const [isEyeDropping, setIsEyeDropping] = useState(false);
  const [selectedPrimaryColorGroup, setSelectedPrimaryColorGroup] = useState<PrimaryColorGroupItem | null>(null);
  const [isPrimaryColorEditorOpen, setIsPrimaryColorEditorOpen] = useState(false);
  const [pendingPrimaryColorHex, setPendingPrimaryColorHex] = useState('#2563EB');
  const [pendingPrimaryColorGroupColors, setPendingPrimaryColorGroupColors] = useState<string[]>([]);
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
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const referenceSectionRef = useRef<HTMLElement | null>(null);
  const primaryColorSectionRef = useRef<HTMLElement | null>(null);
  const fontSectionRef = useRef<HTMLElement | null>(null);
  const logoSectionRef = useRef<HTMLElement | null>(null);
  const primaryColorMenuRef = useRef<HTMLDivElement | null>(null);

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

  const loadFontReferences = async () => {
    setFontReferenceLoading(true);
    setFontReferenceError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/font-references`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load font references';
        throw new Error(message);
      }
      setFontReferences(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load font references';
      setFontReferenceError(message);
    } finally {
      setFontReferenceLoading(false);
    }
  };

  const loadPrimaryColors = async () => {
    setPrimaryColorsLoading(true);
    setPrimaryColorsError('');
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/primary-colors`
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load primary colors';
        throw new Error(message);
      }
      setPrimaryColors(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load primary colors';
      setPrimaryColorsError(message);
    } finally {
      setPrimaryColorsLoading(false);
    }
  };

  useEffect(() => {
    void loadReferenceStyles();
    void loadPrimaryColors();
    void loadFontReferences();
    void loadLogos();
  }, []);

  useEffect(() => {
    if (!isPrimaryColorEditorOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!primaryColorMenuRef.current?.contains(event.target as Node)) {
        setIsPrimaryColorEditorOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isPrimaryColorEditorOpen]);

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

  const handleFontReferenceUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFontReferenceError('');
    setIsFontReferenceUploading(true);
    setFontReferenceUploadProgress(0);
    try {
      const url = `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/font-references/upload`;
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
            setFontReferenceUploadProgress(percent);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            const message = typeof data?.detail === 'string' ? data.detail : 'Failed to upload font reference';
            reject(new Error(message));
          } catch (parseError) {
            reject(parseError);
          }
        };
        xhr.onerror = () => reject(new Error('Failed to upload font reference'));
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
      await loadFontReferences();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload font reference';
      setFontReferenceError(message);
    } finally {
      setIsFontReferenceUploading(false);
      setFontReferenceUploadProgress(null);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete reference style';
      setReferenceError(message);
    } finally {
      setReferenceDeleting(null);
    }
  };

  const handleDeleteFontReference = async (item: FontReferenceItem) => {
    if (!window.confirm('Delete this font reference?')) return;
    setFontReferenceError('');
    setFontReferenceDeleting(item.id);
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/font-references/${item.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete font reference';
        throw new Error(message);
      }
      setFontReferences((prev) => prev.filter((entry) => entry.id !== item.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete font reference';
      setFontReferenceError(message);
    } finally {
      setFontReferenceDeleting(null);
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

  const handleOpenFontReferencePreview = (item: FontReferenceItem) => {
    const baseUrl = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';
    setPreviewImageUrl(`${baseUrl}/font-reference/${item.file_path}`);
    setPreviewImageName(item.original_name);
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

  const savePrimaryColorGroup = async (colors: string[], name = '', groupId?: string) => {
    if (colors.length > 6) {
      setPrimaryColorsError('A color group can contain at most 6 colors.');
      return;
    }

    setPrimaryColorsError('');
    setIsPrimaryColorSaving(true);
    try {
      const normalizedColors = colors.map((color) => color.trim().toUpperCase());
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/primary-colors${groupId ? `/${groupId}` : ''}`,
        {
          method: groupId ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: name.trim(),
            colors: normalizedColors
          })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to save primary color';
        throw new Error(message);
      }
      if (data.item) {
        setPrimaryColors((prev) => {
          if (!groupId) {
            return [data.item, ...prev];
          }
          return prev.map((item) => (item.id === groupId ? data.item : item));
        });
        setSelectedPrimaryColorGroup(data.item);
      }
      setPendingPrimaryColorGroupColors([]);
      setIsPrimaryColorEditorOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save primary color';
      setPrimaryColorsError(message);
    } finally {
      setIsPrimaryColorSaving(false);
    }
  };

  const handlePickScreenColor = async () => {
    const eyeDropperWindow = window as Window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
    };

    if (!eyeDropperWindow.EyeDropper) {
      setPrimaryColorsError('Screen color picking is not supported in this browser.');
      return;
    }

    setPrimaryColorsError('');
    setIsEyeDropping(true);
    try {
      const eyeDropper = new eyeDropperWindow.EyeDropper();
      const result = await eyeDropper.open();
      const pickedHex = result.sRGBHex.toUpperCase();
      setPendingPrimaryColorHex(pickedHex);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      const message = error instanceof Error ? error.message : 'Failed to pick screen color';
      setPrimaryColorsError(message);
    } finally {
      setIsEyeDropping(false);
    }
  };

  const handleDeletePrimaryColor = async (item: PrimaryColorGroupItem) => {
    setPrimaryColorsError('');
    setPrimaryColorDeleting(item.id);
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/primary-colors/${item.id}`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete primary color';
        throw new Error(message);
      }
      setPrimaryColors((prev) => prev.filter((entry) => entry.id !== item.id));
      if (selectedPrimaryColorGroup?.id === item.id) {
        setSelectedPrimaryColorGroup(null);
        setPendingPrimaryColorGroupColors([]);
        setIsPrimaryColorEditorOpen(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete primary color';
      setPrimaryColorsError(message);
    } finally {
      setPrimaryColorDeleting(null);
    }
  };

  const pendingPrimaryColorRgb = hexToRgb(pendingPrimaryColorHex);

  const handlePendingPrimaryColorChannelChange = (channel: 'r' | 'g' | 'b', value: string) => {
    const numericValue = Number.parseInt(value, 10);
    const safeValue = Number.isNaN(numericValue) ? 0 : Math.max(0, Math.min(255, numericValue));
    const nextRgb = {
      ...pendingPrimaryColorRgb,
      [channel]: safeValue
    };
    setPendingPrimaryColorHex(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  const handlePendingPrimaryColorHexChange = (value: string) => {
    const normalized = normalizeHexInput(value);
    setPendingPrimaryColorHex(normalized);

    const hexDigits = normalized.replace('#', '');
    if (hexDigits.length === 6) {
      setPrimaryColorsError('');
    }
  };

  const handleCreatePrimaryColorGroup = async () => {
    setPrimaryColorsError('');
    setIsPrimaryColorSaving(true);
    try {
      const response = await fetchWithAuth(
        `${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/primary-colors`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ colors: [] })
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to create color group';
        throw new Error(message);
      }
      if (data.item) {
        setPrimaryColors((prev) => [data.item, ...prev]);
        setSelectedPrimaryColorGroup(data.item);
        setPendingPrimaryColorGroupColors(data.item.colors ?? []);
        setPendingPrimaryColorHex('#2563EB');
        setIsPrimaryColorEditorOpen(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create color group';
      setPrimaryColorsError(message);
    } finally {
      setIsPrimaryColorSaving(false);
    }
  };

  const handleOpenPrimaryColorGroupEditor = (item: PrimaryColorGroupItem) => {
    setSelectedPrimaryColorGroup(item);
    setPendingPrimaryColorGroupColors(item.colors ?? []);
    setPendingPrimaryColorHex(item.colors?.[0] || '#2563EB');
    setPrimaryColorsError('');
    setIsPrimaryColorEditorOpen(true);
  };

  const handleAddPendingColorToGroup = () => {
    if (!/^#[0-9A-F]{6}$/i.test(pendingPrimaryColorHex)) {
      setPrimaryColorsError('Please enter a valid 6-digit hex color.');
      return;
    }
    setPrimaryColorsError('');
    setPendingPrimaryColorGroupColors((prev) => {
      if (prev.includes(pendingPrimaryColorHex)) {
        return prev;
      }
      if (prev.length >= 6) {
        setPrimaryColorsError('A color group can contain at most 6 colors.');
        return prev;
      }
      return [...prev, pendingPrimaryColorHex];
    });
  };

  const handleRemovePendingColorFromGroup = (color: string) => {
    setPendingPrimaryColorGroupColors((prev) => prev.filter((entry) => entry !== color));
  };

  const guideSteps = [
    {
      title: 'Reference Styles',
      target: referenceSectionRef,
      content: (
        <div className="space-y-3">
          <p>Upload a poster you already love here. It can be a past event poster from your school, club, or student organization. That gives the generator a much clearer style target. 📌</p>
          <img
            src={refPosterOne}
            alt="Reference style example poster"
            className="h-56 w-full rounded-2xl border border-gray-200 bg-slate-50 object-contain p-3"
          />
        </div>
      )
    },
    {
      title: 'Color Groups',
      target: primaryColorSectionRef,
      content: (
        <div className="space-y-3">
          <p>Build reusable color groups for your posters. Each group can hold up to six colors, which makes it easier to keep a full palette together.</p>
          <div className="grid grid-cols-3 gap-3">
            {['#2563EB', '#F97316', '#111827'].map((color, index) => (
              <div key={color} className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="grid grid-cols-2 gap-2">
                  {[color, index === 0 ? '#60A5FA' : index === 1 ? '#FDBA74' : '#4B5563'].map((swatch) => (
                    <div key={swatch} className="h-10 rounded-xl border border-black/5" style={{ backgroundColor: swatch }} />
                  ))}
                </div>
                <div className="mt-2 text-[11px] font-semibold text-gray-600">Color Group</div>
              </div>
            ))}
          </div>
        </div>
      )
    },
    {
      title: 'Font References',
      target: fontSectionRef,
      content: (
        <div className="space-y-3">
          <p>If your school, club, or campaign uses a distinctive type style, upload a screenshot like this so the poster text feels more on-brand. ✍️</p>
          <img
            src={fontExampleImage}
            alt="Font reference example"
            className="h-56 w-full rounded-2xl border border-gray-200 bg-slate-50 object-contain p-3"
          />
        </div>
      )
    },
    {
      title: 'Logo Assets',
      target: logoSectionRef,
      content: (
        <div className="space-y-3">
          <p>Upload your school logo, club mark, or event badge here. We can place it in a clean, appropriate spot when generating the poster. 🏫</p>
          <img
            src={logoExampleImage}
            alt="Logo example"
            className="h-48 w-full rounded-2xl border border-gray-200 object-contain bg-slate-50 p-4"
          />
        </div>
      )
    }
  ];

  const closeGuide = () => {
    localStorage.setItem(PERSONAL_SPACE_ONBOARDING_STORAGE_KEY, '1');
    setIsGuideOpen(false);
  };

  useEffect(() => {
    if (localStorage.getItem(PERSONAL_SPACE_ONBOARDING_STORAGE_KEY) === '1') return;
    const timer = window.setTimeout(() => {
      setGuideStep(0);
      setIsGuideOpen(true);
    }, 220);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Personal Space</h1>
          <p className="mt-2 text-sm text-gray-500">Manage the references and logo assets that shape your poster system.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setGuideStep(0);
            setIsGuideOpen(true);
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
          aria-label="Show personal space guide"
          title="Show personal space guide"
        >
          <Info className="h-4 w-4" />
        </button>
      </div>
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
          <section ref={referenceSectionRef} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex flex-col">
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

          <section ref={primaryColorSectionRef} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-50 text-cyan-600 rounded-xl">
                  <Droplets size={18} />
                </div>
                <h3 className="font-bold text-gray-900">Color Groups</h3>
              </div>
              <button
                type="button"
                onClick={() => void handleCreatePrimaryColorGroup()}
                disabled={isPrimaryColorSaving}
                className="inline-flex h-11 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                title="Add Color Set"
              >
                <Plus size={18} />
                <span>Add Color Set</span>
              </button>
            </div>

            {primaryColorsError && (
              <div className="text-xs text-red-600 mb-3">{primaryColorsError}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {primaryColorsLoading && primaryColors.length === 0 ? (
                <div className="col-span-full text-sm text-gray-400">Loading color groups...</div>
              ) : primaryColors.length > 0 ? (
                primaryColors.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleOpenPrimaryColorGroupEditor(item)}
                    className={`aspect-square rounded-2xl border overflow-hidden relative group shadow-sm bg-white p-3 text-left transition ${
                      selectedPrimaryColorGroup?.id === item.id
                        ? 'border-cyan-400 ring-2 ring-cyan-100'
                        : 'border-gray-100 hover:border-cyan-200'
                    }`}
                    title={item.name?.trim() ? `${item.name} ? ${item.colors.join(', ')}` : item.colors.join(', ')}
                  >
                    <div className="grid h-full grid-cols-2 gap-2">
                      {Array.from({ length: 6 }).map((_, index) => {
                        const swatch = item.colors[index];
                        return swatch ? (
                          <div
                            key={`${item.id}-${swatch}-${index}`}
                            className="rounded-xl border border-black/5"
                            style={{ backgroundColor: swatch }}
                            title={swatch}
                          />
                        ) : (
                          <div
                            key={`empty-${item.id}-${index}`}
                            className="rounded-xl border border-dashed border-gray-200 bg-slate-50"
                          />
                        );
                      })}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 text-white">
                      <div className="truncate text-sm font-semibold">
                        {item.name?.trim() || 'Color Set'}
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                        {item.colors.length} colors
                      </div>
                    </div>
                    <div className="absolute inset-0 ring-1 ring-inset ring-black/5 rounded-2xl pointer-events-none" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeletePrimaryColor(item);
                      }}
                      disabled={primaryColorDeleting === item.id}
                      className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-white text-xs font-bold shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                      aria-label="Delete color group"
                    >
                      x
                    </button>
                  </button>
                ))
              ) : (
                <div className="col-span-full rounded-2xl border border-dashed border-gray-200 bg-slate-50 px-4 py-10 text-sm text-gray-400">
                  No color groups yet.
                </div>
              )}
            </div>

            {isPrimaryColorEditorOpen && selectedPrimaryColorGroup && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
                <div ref={primaryColorMenuRef} className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-5 shadow-2xl">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Color Group</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {selectedPrimaryColorGroup.name?.trim() || 'Color Set'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPrimaryColorEditorOpen(false)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 text-gray-500 transition hover:border-gray-300 hover:text-gray-800"
                      aria-label="Close color group editor"
                    >
                      x
                    </button>
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                      <span>Group Colors</span>
                      <span>{pendingPrimaryColorGroupColors.length}/6</span>
                    </div>
                    <div className="grid grid-cols-6 gap-2">
                      {Array.from({ length: 6 }).map((_, index) => {
                        const swatch = pendingPrimaryColorGroupColors[index];
                        return swatch ? (
                          <button
                            key={`${swatch}-${index}`}
                            type="button"
                            onClick={() => handleRemovePendingColorFromGroup(swatch)}
                            className="h-12 rounded-xl border border-black/5 shadow-sm transition hover:scale-105"
                            style={{ backgroundColor: swatch }}
                            title={`Remove ${swatch}`}
                          />
                        ) : (
                          <div
                            key={`editor-empty-${index}`}
                            className="h-12 rounded-xl border border-dashed border-gray-200 bg-slate-50"
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePickScreenColor}
                      disabled={isEyeDropping || pendingPrimaryColorGroupColors.length >= 6}
                      className="inline-flex h-11 items-center gap-2 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-semibold text-cyan-700 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Pick a color from the screen"
                    >
                      <span aria-hidden="true" className="text-base leading-none">??</span>
                      <Pipette size={16} />
                      <span>{isEyeDropping ? 'Picking...' : 'Eyedropper'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleAddPendingColorToGroup}
                      disabled={pendingPrimaryColorGroupColors.length >= 6}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Add current color to group"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <div
                      className="h-14 w-14 shrink-0 rounded-2xl border border-gray-200 shadow-sm"
                      style={{ backgroundColor: pendingPrimaryColorHex }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Current</div>
                      <div className="truncate text-base font-semibold text-gray-900">{pendingPrimaryColorHex}</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-gray-100 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                      Hex
                    </label>
                    <input
                      type="text"
                      value={pendingPrimaryColorHex}
                      onChange={(event) => handlePendingPrimaryColorHexChange(event.target.value)}
                      placeholder="#2563EB"
                      className="mt-2 h-11 w-full rounded-2xl border border-gray-200 bg-white px-3 text-sm font-semibold uppercase text-gray-800 outline-none transition focus:border-cyan-400"
                      aria-label="Primary color hex value"
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(['r', 'g', 'b'] as const).map((channel) => (
                      <div key={channel}>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                          {channel}
                        </div>
                        <input
                          type="number"
                          min="0"
                          max="255"
                          value={pendingPrimaryColorRgb[channel]}
                          onChange={(event) => handlePendingPrimaryColorChannelChange(channel, event.target.value)}
                          className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-cyan-400"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void savePrimaryColorGroup(pendingPrimaryColorGroupColors, '', selectedPrimaryColorGroup.id)}
                    disabled={isPrimaryColorSaving}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
                  >
                    {isPrimaryColorSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}
          </section>
          <section ref={fontSectionRef} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                  <FileText size={18} />
                </div>
                <h3 className="font-bold text-gray-900">Font References</h3>
              </div>

              <label className="p-2 hover:bg-gray-100 rounded-full cursor-pointer transition-colors">
                <Plus size={20} className="text-gray-400 hover:text-gray-900" />
                <input type="file" className="hidden" accept="image/*" onChange={handleFontReferenceUpload} />
              </label>
            </div>

            <div className="flex-1">
              {fontReferenceError && (
                <div className="text-xs text-red-600 mb-3">{fontReferenceError}</div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {fontReferenceLoading && fontReferences.length === 0 ? (
                  <div className="col-span-full text-sm text-gray-400">Loading font references...</div>
                ) : fontReferences.length > 0 ? (
                  fontReferences.map((item) => (
                    <div
                      key={item.id}
                      className="aspect-square bg-gray-50 rounded-2xl border border-gray-100 overflow-hidden relative group shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenFontReferencePreview(item)}
                        className="absolute inset-0"
                        aria-label={`Preview ${item.original_name}`}
                      >
                        <img
                          src={`${import.meta.env.VITE_BACKEND_API || 'http://localhost:8001'}/font-reference/${item.thumbnail_path || item.file_path}`}
                          alt={item.original_name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFontReference(item)}
                        disabled={fontReferenceDeleting === item.id}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 text-gray-700 hover:bg-white text-xs font-bold shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-60"
                        aria-label="Delete font reference"
                      >
                        x
                      </button>
                    </div>
                  ))
                ) : null}
                <label className="aspect-square border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all cursor-pointer">
                  <Plus size={24} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Add Image</span>
                  <input type="file" className="hidden" accept="image/*" onChange={handleFontReferenceUpload} />
                </label>
              </div>
            </div>
          </section>

          <section ref={logoSectionRef} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
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

      <SpotlightTour
        open={isGuideOpen}
        targetRect={guideSteps[guideStep]?.target.current?.getBoundingClientRect() ?? null}
        title={guideSteps[guideStep]?.title || 'Personal Space'}
        content={guideSteps[guideStep]?.content || null}
        stepLabel={`${guideStep + 1} / ${guideSteps.length}`}
        onClose={closeGuide}
        onSkip={closeGuide}
        onBack={guideStep > 0 ? () => setGuideStep((prev) => prev - 1) : undefined}
        onNext={guideStep < guideSteps.length - 1 ? () => setGuideStep((prev) => prev + 1) : closeGuide}
        nextLabel={guideStep < guideSteps.length - 1 ? 'Next' : 'Done'}
      />

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

      {isFontReferenceUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <div className="text-sm font-semibold text-gray-900 mb-2">Uploading font reference</div>
            <div className="text-xs text-gray-400 mb-4">Please keep this window open.</div>
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${fontReferenceUploadProgress ?? 0}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mt-3">
              {fontReferenceUploadProgress === null ? 'Starting...' : `${fontReferenceUploadProgress}%`}
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
