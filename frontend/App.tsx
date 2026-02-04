
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, Image as ImageIcon, Type as TextIcon, Trash2, ZoomIn, ZoomOut, MousePointer2, GripHorizontal, Hand, Sparkles, Loader2, ArrowLeft, Search, Bold, Italic, Underline, Download, AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, MessageCircle, Pencil, Square, ArrowUpRight, ImagePlus, Home } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AppStatus, PosterDraft, PlanningStep, Artboard, Asset, Selection, AssetType, Project, TextLayout, TextStyleMap, Connection } from './types';
import { planPosters, generatePosterImage, generatePosterNoTextImage, generatePosterMergedImage, refinePoster, chatWithModel, ChatMessage, editPosterWithMarkup, generatePosterResolutionFromImage, generatePosterImageAsync, getAITaskStatus, extractImageFromTaskResult, getPendingAITasks, AITaskStatus, generateImageFromPrompt } from './services/geminiService';
import { AuthUser, fetchWithAuth, getAccessToken, loginUser, logoutUser, refreshAccessToken, registerUser } from './services/authService';
import PosterCard from './components/PosterCard';
import LandingPage from './components/LandingPage';
import PersonalSpacePage from './components/PersonalSpacePage';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const STORAGE_KEY = 'poster_canvas_projects';
const DEFAULT_BOARD_WIDTH = 320;
const DEFAULT_BOARD_HEIGHT = 480;
const ARTBOARD_GAP = 140;
const EXPORT_VERSION = 1;
const BOARD_BOUNDS = { minX: -2500, maxX: 2500, minY: -2500, maxY: 2500 };
const BOARD_WIDTH = BOARD_BOUNDS.maxX - BOARD_BOUNDS.minX;
const BOARD_HEIGHT = BOARD_BOUNDS.maxY - BOARD_BOUNDS.minY;
const BOARD_PADDING = 24;
const ADMIN_DB_LIMIT = 50;
const BACKEND_API = import.meta.env.VITE_BACKEND_API || 'http://localhost:8001';
const FONT_PREVIEW_API = import.meta.env.VITE_FONT_PREVIEW_API || BACKEND_API;
const FONT_ALPHABET_PREVIEW_TEXT = [
  'Aa Bb Cc Dd Ee Ff',
  'Gg Hh Ii Jj Kk Ll',
  'Mm Nn Oo Pp Qq Rr',
  'Ss Tt Uu Vv Ww Xx',
  'Yy Zz'
].join('\n');
const REFINE_RESOLUTION_OPTIONS = [
  { id: '9x16', label: '1080×1920 (9:16)', width: 1080, height: 1920 },
  { id: '1x1', label: '1080×1080 (1:1)', width: 1080, height: 1080 },
  { id: '16x9', label: '1920×1080 (16:9)', width: 1920, height: 1080 }
];

const generateId = () => Math.random().toString(36).slice(2, 9);
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const toHex = (b: number) => b.toString(16).padStart(2, '0');
    return [
      toHex(bytes[0]), toHex(bytes[1]), toHex(bytes[2]), toHex(bytes[3]),
      '-',
      toHex(bytes[4]), toHex(bytes[5]),
      '-',
      toHex(bytes[6]), toHex(bytes[7]),
      '-',
      toHex(bytes[8]), toHex(bytes[9]),
      '-',
      toHex(bytes[10]), toHex(bytes[11]), toHex(bytes[12]), toHex(bytes[13]), toHex(bytes[14]), toHex(bytes[15])
    ].join('');
  }
  return `${Date.now().toString(36)}-${generateId()}-${generateId()}`;
};
const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampPosition = (x: number, y: number, width: number, height: number) => ({
  x: clampValue(x, BOARD_BOUNDS.minX, BOARD_BOUNDS.maxX - width),
  y: clampValue(y, BOARD_BOUNDS.minY, BOARD_BOUNDS.maxY - height)
});
const fitSizeToBox = (targetWidth: number, targetHeight: number, maxWidth: number, maxHeight: number) => {
  const scale = Math.min(maxWidth / targetWidth, maxHeight / targetHeight, 1);
  return { width: targetWidth * scale, height: targetHeight * scale };
};
const buildDefaultTextLayout = (): TextLayout => ({
  topBanner: { x: 0.08, y: 0.06, width: 0.84, height: 0.08 },
  headline: { x: 0.08, y: 0.18, width: 0.84, height: 0.26 },
  subheadline: { x: 0.08, y: 0.48, width: 0.84, height: 0.14 },
  infoBlock: { x: 0.08, y: 0.66, width: 0.84, height: 0.22 }
});

type Rect = { left: number; top: number; right: number; bottom: number };
type AnnotationColor = 'red' | 'green' | 'purple';
type AnnotationTool = 'rect' | 'arrow' | 'pan';
type Annotation = {
  id: number;
  type: AnnotationTool;
  color: AnnotationColor;
  x: number;
  y: number;
  width: number;
  height: number;
  x2?: number;
  y2?: number;
};
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
type FontReferenceItem = {
  id: string;
  original_name: string;
  file_path: string;
  thumbnail_path?: string | null;
  mime_type?: string | null;
  created_at: string;
};

const rectsOverlap = (a: Rect, b: Rect, padding = 0) => (
  !(a.right + padding <= b.left || a.left - padding >= b.right || a.bottom + padding <= b.top || a.top - padding >= b.bottom)
);

const computeProductionMetrics = (
  count: number,
  boardWidth: number,
  boardHeight: number,
  includeStyle: boolean,
  includeLogo: boolean,
  includeFontReference: boolean
) => {
  const assetStartX = -300;
  let currentY = 40;
  currentY += 136; // note
  if (includeStyle) currentY += 166;
  if (includeLogo) currentY += 116;
  if (includeFontReference) currentY += 116;
  const groupHeight = currentY + 16;

  const rows = Math.max(1, Math.ceil(count / 3));
  const maxCol = Math.min(2, Math.max(0, count - 1));
  const artboardRight = maxCol * (boardWidth + ARTBOARD_GAP) + boardWidth;
  const artboardBottom = (rows - 1) * (boardHeight + ARTBOARD_GAP) + boardHeight;

  const leftRel = Math.min(assetStartX, 0);
  const rightRel = Math.max(artboardRight, assetStartX + 232);
  const topRel = 0;
  const bottomRel = Math.max(artboardBottom, groupHeight);

  return {
    leftRel,
    topRel,
    rightRel,
    bottomRel,
    width: rightRel - leftRel,
    height: bottomRel - topRel,
    groupHeight
  };
};

const UploadingModal: React.FC<{ open: boolean; title: string; progress: number | null; barClassName: string }> = ({
  open,
  title,
  progress,
  barClassName
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="text-sm font-semibold text-gray-900 mb-2">{title}</div>
        <div className="text-xs text-gray-400 mb-4">Please keep this window open.</div>
        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`${barClassName} transition-all`}
            style={{ width: `${progress ?? 0}%` }}
          />
        </div>
        <div className="text-xs text-gray-500 mt-3">
          {progress === null ? 'Starting...' : `${progress}%`}
        </div>
      </div>
    </div>
  );
};
const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [newProjectData, setNewProjectData] = useState({ title: '', width: DEFAULT_BOARD_WIDTH, height: DEFAULT_BOARD_HEIGHT });
  const [route, setRoute] = useState(() => window.location.pathname);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [selection, setSelection] = useState<Selection>({ artboardId: null, assetId: null });
  const [canvasSelectionId, setCanvasSelectionId] = useState<string | null>(null);
  const [multiSelectedArtboards, setMultiSelectedArtboards] = useState<string[]>([]);
  const [multiSelectedCanvasAssets, setMultiSelectedCanvasAssets] = useState<string[]>([]);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(4);
  const [styleImages, setStyleImages] = useState<string[]>([]);
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [fontReferenceImage, setFontReferenceImage] = useState<string | null>(null);
  const [activePosterId, setActivePosterId] = useState<string | null>(null);
  const [editablePoster, setEditablePoster] = useState<PlanningStep | null>(null);
  const [editableLayout, setEditableLayout] = useState<TextLayout | null>(null);
  const [editableStyles, setEditableStyles] = useState<TextStyleMap | null>(null);
  const [selectedTextKey, setSelectedTextKey] = useState<keyof TextLayout | null>('headline');
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [selectedServerFont, setSelectedServerFont] = useState('');
  const [renderedLayoutUrl, setRenderedLayoutUrl] = useState<string | null>(null);
  const [showRenderedLayout, setShowRenderedLayout] = useState(false);
  const [isRenderingLayout, setIsRenderingLayout] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showTextBoxes, setShowTextBoxes] = useState(true);
  const [didResolveOverlap, setDidResolveOverlap] = useState(false);
  const [pendingRenderCommit, setPendingRenderCommit] = useState(false);
  const [didAutoSizeLayout, setDidAutoSizeLayout] = useState(false);
  const [noTextImageSize, setNoTextImageSize] = useState<{ width: number; height: number } | null>(null);
  const [noTextContainRect, setNoTextContainRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [manualSizedKeys, setManualSizedKeys] = useState<Set<keyof TextLayout>>(new Set());
  const [isResizingTextBox, setIsResizingTextBox] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isRenamingProject, setIsRenamingProject] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState('');
  const [rightPanelMode, setRightPanelMode] = useState<'generator' | 'comment' | 'gallery' | null>(null);
  const [commentMessages, setCommentMessages] = useState<ChatMessage[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [isCommentLoading, setIsCommentLoading] = useState(false);
  const [commentAttachments, setCommentAttachments] = useState<string[]>([]);
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(10);
  const [galleryFileUrls, setGalleryFileUrls] = useState<string[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [referenceStyles, setReferenceStyles] = useState<ReferenceStyleItem[]>([]);
  const [referenceStylesLoading, setReferenceStylesLoading] = useState(false);
  const [referenceStylesError, setReferenceStylesError] = useState('');
  const [selectedReferenceStyleId, setSelectedReferenceStyleId] = useState<string | null>(null);
  const [referenceSelectLoadingId, setReferenceSelectLoadingId] = useState<string | null>(null);
  const [referenceUploadProgress, setReferenceUploadProgress] = useState<number | null>(null);
  const [isReferenceUploading, setIsReferenceUploading] = useState(false);
  const [logoAssets, setLogoAssets] = useState<LogoItem[]>([]);
  const [logoAssetsLoading, setLogoAssetsLoading] = useState(false);
  const [logoAssetsError, setLogoAssetsError] = useState('');
  const [selectedLogoAssetId, setSelectedLogoAssetId] = useState<string | null>(null);
  const [logoSelectLoadingId, setLogoSelectLoadingId] = useState<string | null>(null);
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(null);
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [fontReferences, setFontReferences] = useState<FontReferenceItem[]>([]);
  const [fontReferencesLoading, setFontReferencesLoading] = useState(false);
  const [fontReferencesError, setFontReferencesError] = useState('');
  const [selectedFontReferenceId, setSelectedFontReferenceId] = useState<string | null>(null);
  const [fontReferenceSelectLoadingId, setFontReferenceSelectLoadingId] = useState<string | null>(null);
  const [fontReferenceUploadProgress, setFontReferenceUploadProgress] = useState<number | null>(null);
  const [isFontReferenceUploading, setIsFontReferenceUploading] = useState(false);
  const [refStylesCanLeft, setRefStylesCanLeft] = useState(false);
  const [refStylesCanRight, setRefStylesCanRight] = useState(false);
  const [logosCanLeft, setLogosCanLeft] = useState(false);
  const [logosCanRight, setLogosCanRight] = useState(false);
  const [fontRefsCanLeft, setFontRefsCanLeft] = useState(false);
  const [fontRefsCanRight, setFontRefsCanRight] = useState(false);
  const [fadeInCanvasAssetIds, setFadeInCanvasAssetIds] = useState<Set<string>>(new Set());
  const [feedbackSuggestions, setFeedbackSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [ideaLoadingLabel, setIdeaLoadingLabel] = useState('Warming Up');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('rect');
  const [annotationColor, setAnnotationColor] = useState<AnnotationColor>('green');
  const [annotationZoom, setAnnotationZoom] = useState(1);
  const [annotatorSize, setAnnotatorSize] = useState({ width: 0, height: 0 });
  const [annotationPan, setAnnotationPan] = useState({ x: 0, y: 0 });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationNotes, setAnnotationNotes] = useState<Record<number, string>>({});
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<Annotation | null>(null);
  const [annotatorImage, setAnnotatorImage] = useState<HTMLImageElement | null>(null);
  const [annotatorLoaded, setAnnotatorLoaded] = useState(false);
  const [annotatorReadyTick, setAnnotatorReadyTick] = useState(0);
  const [refineReferenceImage, setRefineReferenceImage] = useState<string | null>(null);
  const [posterFeedback, setPosterFeedback] = useState('');
  const [selectedRefineResolutions, setSelectedRefineResolutions] = useState<Set<string>>(new Set());
  const [isPosterModalOpen, setIsPosterModalOpen] = useState(false);
  const [isPosterModalClosing, setIsPosterModalClosing] = useState(false);
  const [isRefiningPoster, setIsRefiningPoster] = useState(false);
  const [isResolutionModalOpen, setIsResolutionModalOpen] = useState(false);
  const [isGeneratingResolutions, setIsGeneratingResolutions] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [assetContextMenu, setAssetContextMenu] = useState<{
    x: number;
    y: number;
    scope: 'artboard' | 'canvas' | 'poster';
    artboardId?: string;
    assetId: string;
  } | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number;
    y: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const [isMergingPoster, setIsMergingPoster] = useState(false);
  const [showNoTextEdit, setShowNoTextEdit] = useState(false);
  const [noTextLoadingId, setNoTextLoadingId] = useState<string | null>(null);
  const [canvasAssets, setCanvasAssets] = useState<Asset[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);

  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0 });
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const noTextRef = useRef<HTMLDivElement>(null);
  const artboardsRef = useRef<Artboard[]>([]);
  const viewOffsetRef = useRef(viewOffset);
  const viewAnimationRef = useRef<number | null>(null);
  const historyRef = useRef<{ artboards: Artboard[]; canvasAssets: Asset[]; connections: Connection[] }[]>([]);
  const redoRef = useRef<{ artboards: Artboard[]; canvasAssets: Asset[]; connections: Connection[] }[]>([]);
  const historySignatureRef = useRef('');
  const lastLoadedProjectIdRef = useRef<string | null>(null);
  const autoSaveSignatureRef = useRef('');
  const autoSaveInFlightRef = useRef(false);
  const isRestoringRef = useRef(false);
  const annotatorRef = useRef<HTMLDivElement | null>(null);
  const annotatorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationIdRef = useRef(1);
  const annotationStartRef = useRef<{ x: number; y: number } | null>(null);
  const annotationHistoryRef = useRef<Annotation[][]>([]);
  const annotationRedoRef = useRef<Annotation[][]>([]);
  const isAnnotationRestoringRef = useRef(false);
  const annotationPanStartRef = useRef<{ x: number; y: number } | null>(null);
  const [fadeInArtboardIds, setFadeInArtboardIds] = useState<Set<string>>(new Set());
  const fadeInTimersRef = useRef<Record<string, number>>({});
  const fadeInCanvasTimersRef = useRef<Record<string, number>>({});
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [adminGeneratedUser, setAdminGeneratedUser] = useState<{ username: string; password: string } | null>(null);
  const [adminCopyStatus, setAdminCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [adminUsernameInput, setAdminUsernameInput] = useState('');
  const [adminRegisterError, setAdminRegisterError] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [passwordChangeForm, setPasswordChangeForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [adminDbTables, setAdminDbTables] = useState<string[]>([]);
  const [adminDbTable, setAdminDbTable] = useState('');
  const [adminDbSchema, setAdminDbSchema] = useState<Array<{ name: string; type: string; notnull: boolean; default: any; pk: number }>>([]);
  const [adminDbPrimaryKey, setAdminDbPrimaryKey] = useState<string[]>([]);
  const [adminDbHasRowid, setAdminDbHasRowid] = useState(true);
  const [adminDbRows, setAdminDbRows] = useState<Record<string, any>[]>([]);
  const [adminDbTotal, setAdminDbTotal] = useState(0);
  const [adminDbOffset, setAdminDbOffset] = useState(0);
  const [adminDbLoading, setAdminDbLoading] = useState(false);
  const [adminDbError, setAdminDbError] = useState('');
  const [adminDbEditorOpen, setAdminDbEditorOpen] = useState(false);
  const [adminDbEditorMode, setAdminDbEditorMode] = useState<'add' | 'edit'>('add');
  const [adminDbEditorValues, setAdminDbEditorValues] = useState<Record<string, any>>({});
  const [adminDbEditorRowId, setAdminDbEditorRowId] = useState<number | null>(null);
  const [adminDbEditorPrimaryKey, setAdminDbEditorPrimaryKey] = useState<Record<string, any> | null>(null);
  const [adminDbSaving, setAdminDbSaving] = useState(false);
  const [playgroundPrompt, setPlaygroundPrompt] = useState('');
  const [playgroundImages, setPlaygroundImages] = useState<string[]>([]);
  const [playgroundResult, setPlaygroundResult] = useState<string | null>(null);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundError, setPlaygroundError] = useState('');
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const fontReferenceInputRef = useRef<HTMLInputElement | null>(null);
  const referenceStyleUploadRef = useRef<HTMLInputElement | null>(null);
  const logoAssetUploadRef = useRef<HTMLInputElement | null>(null);
  const fontReferenceUploadRef = useRef<HTMLInputElement | null>(null);
  const referenceStylesScrollRef = useRef<HTMLDivElement | null>(null);
  const logoAssetsScrollRef = useRef<HTMLDivElement | null>(null);
  const fontReferencesScrollRef = useRef<HTMLDivElement | null>(null);

  const isAnnotatorReady = Boolean(annotatorImage && annotatorSize.width > 0 && annotatorSize.height > 0);
  const dragState = useRef<{
    key: keyof TextLayout | null;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  } | null>(null);
  const lastRenderedSignatureRef = useRef('');
  const textBoxWidthRef = useRef<Record<string, number>>({});
  const wrapLogRef = useRef<Record<string, string>>({});
  const textTransformRef = useRef<Record<string, string>>({});
  const wrapCacheRef = useRef<Record<string, string>>({});
  const textAreaRefs = useRef<Record<keyof TextLayout, HTMLTextAreaElement | null>>({
    topBanner: null,
    headline: null,
    subheadline: null,
    infoBlock: null
  });
  const measureDivRef = useRef<HTMLDivElement | null>(null);
  const triggerArtboardFadeIn = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFadeInArtboardIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    ids.forEach((id) => {
      if (fadeInTimersRef.current[id]) {
        window.clearTimeout(fadeInTimersRef.current[id]);
      }
      fadeInTimersRef.current[id] = window.setTimeout(() => {
        setFadeInArtboardIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        delete fadeInTimersRef.current[id];
      }, 500);
    });
  }, []);

  const resetGeneratorForm = useCallback(() => {
    setTheme('');
    setStyleImages([]);
    setLogoImage(null);
    setFontReferenceImage(null);
    setSelectedServerFont('');
    setCount(4);
    setSelectedSuggestions(new Set());
    setSelectedReferenceStyleId(null);
    setSelectedLogoAssetId(null);
    setSelectedFontReferenceId(null);
    if (fontReferenceInputRef.current) {
      fontReferenceInputRef.current.value = '';
    }
  }, []);

  useEffect(() => () => {
    Object.values(fadeInTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  const triggerCanvasAssetFadeIn = useCallback((id: string) => {
    setFadeInCanvasAssetIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (fadeInCanvasTimersRef.current[id]) {
      window.clearTimeout(fadeInCanvasTimersRef.current[id]);
    }
    fadeInCanvasTimersRef.current[id] = window.setTimeout(() => {
      setFadeInCanvasAssetIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      delete fadeInCanvasTimersRef.current[id];
    }, 500);
  }, []);

  useEffect(() => () => {
    Object.values(fadeInCanvasTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
  }, []);

  const getStorageKey = useCallback((userId?: string | null) => (
    userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY
  ), []);

  useEffect(() => {
    const bootAuth = async () => {
      const refreshed = await refreshAccessToken();
      if (refreshed?.user) {
        setAuthUser(refreshed.user);
        setMustChangePassword(Boolean(refreshed.user.must_change_password));
      }
      setAuthReady(true);
    };
    void bootAuth();
  }, []);

  useEffect(() => {
    const handleAuthToken = (event: Event) => {
      const detail = (event as CustomEvent).detail as { token?: string | null } | undefined;
      if (!detail?.token) {
        setAuthUser(null);
      }
    };
    window.addEventListener('auth:token', handleAuthToken as EventListener);
    return () => window.removeEventListener('auth:token', handleAuthToken as EventListener);
  }, []);

  // Load projects from backend after auth resolves
  useEffect(() => {
    if (!authReady) return;
    if (!authUser) {
      setProjects([]);
      return;
    }
    const loadProjectsFromBackend = async () => {
      try {
        const response = await fetchWithAuth(`${BACKEND_API}/projects`);
        if (response.ok) {
          const data = await response.json();
          const projects = data.projects || [];
          const processedProjects = projects.map(convertFileUrlsToHttp);
          setProjects(processedProjects);
          console.log('[info] Loaded projects from backend:', projects.length);
        } else if (response.status === 401) {
          setAuthUser(null);
        } else {
          console.warn('[warn] Failed to load projects from backend, falling back to localStorage');
          const saved = localStorage.getItem(getStorageKey(authUser.id));
          if (saved) {
            setProjects(JSON.parse(saved));
          }
        }
      } catch (error) {
        console.warn('[warn] Failed to connect to backend, using localStorage:', error);
        const saved = localStorage.getItem(getStorageKey(authUser.id));
        if (saved) {
          setProjects(JSON.parse(saved));
        }
      }
    };

    void loadProjectsFromBackend();
  }, [authReady, authUser, getStorageKey]);

  const syncRouteState = useCallback((path: string) => {
    setRoute(path);
    const boardMatch = path.match(/^\/board\/([^/]+)$/);
    if (boardMatch) {
      setActiveProjectId(boardMatch[1]);
    } else {
      setActiveProjectId(null);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      syncRouteState(path);
    };
    window.addEventListener('popstate', handlePopState);
    // Check initial route
    handlePopState();
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncRouteState]);

  const convertFileUrlsToHttp = (project: Project): Project => {
    const convertUrl = (url?: string): string | undefined => {
      if (!url) return url;
      if (url.startsWith('file://')) {
        // Convert file://db/files/project-id/filename.png to backend file URL
        const path = url.replace('file://db/files/', '');
        return `${BACKEND_API}/files/${path}`;
      }
      return url;
    };
    const convertUrls = (urls?: string[]) => (
      urls ? urls.map((url) => convertUrl(url) || url) : urls
    );
    const convertAssets = (assets?: Asset[]) => (
      assets
        ? assets.map((asset) => (
          asset.type === 'image'
            ? { ...asset, content: convertUrl(asset.content) || asset.content }
            : asset
        ))
        : assets
    );

    return {
      ...project,
      styleImages: convertUrls(project.styleImages),
      logoImage: convertUrl(project.logoImage) || project.logoImage || undefined,
      fontReferenceImage: convertUrl(project.fontReferenceImage) || project.fontReferenceImage || undefined,
      canvasAssets: convertAssets(project.canvasAssets),
      artboards: project.artboards?.map((ab) => ({
        ...ab,
        assets: ab.assets.map((asset) => {
          if (asset.type !== 'image') return asset;
          return { ...asset, content: convertUrl(asset.content) || asset.content };
        }),
        posterData: ab.posterData
          ? {
            ...ab.posterData,
            imageUrl: convertUrl(ab.posterData.imageUrl),
            imageUrlNoText: convertUrl(ab.posterData.imageUrlNoText),
            imageUrlMerged: convertUrl(ab.posterData.imageUrlMerged),
            logoUrl: convertUrl(ab.posterData.logoUrl)
          }
          : undefined
      }))
    };
  };

  const stripLargeData = (project: Project): Project => ({
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    width: project.width,
    height: project.height,
    artboards: [],
    canvasAssets: [],
    connections: [],
    styleImages: [],
    logoImage: null,
    fontReferenceImage: null,
    view: project.view
  });

  const saveProjectsToDisk = (updatedProjects: Project[]) => {
    setProjects(updatedProjects);
    const slimProjects = updatedProjects.map(stripLargeData);
    if (!authUser) return;
    try {
      localStorage.setItem(getStorageKey(authUser.id), JSON.stringify(slimProjects));
    } catch (err) {
      console.warn('Failed to save full projects to localStorage', err);
      try {
        localStorage.setItem(getStorageKey(authUser.id), JSON.stringify(slimProjects));
      } catch (fallbackErr) {
        console.warn('Failed to save slim projects to localStorage', fallbackErr);
      }
    }
  };

  const saveProjectToBackend = async (projectId: string, projectData: Project) => {
    if (!authUser) return;
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/projects/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          projectData, // Send full project data including base64 images
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setAuthUser(null);
          return;
        }
        throw new Error('Failed to save project to backend');
      }

      console.log('[info] Project auto-saved to backend:', projectId);
    } catch (error) {
      console.warn('[warn] Failed to auto-save project to backend:', error);
    }
  };

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const action = authMode === 'login' ? loginUser : registerUser;
      const data = await action(authForm.username, authForm.password);
      setAuthUser(data.user);
      setMustChangePassword(Boolean(data.user.must_change_password));
      setAuthForm({ username: '', password: '' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setAuthError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  const sanitizeFileName = (value: string) => {
    const trimmed = value.trim() || 'poster-project';
    return trimmed.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  };

  const dataUrlToBytes = (dataUrl: string) => {
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mime, bytes };
  };

  const extensionFromMime = (mime: string) => {
    if (mime.includes('png')) return 'png';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'bin';
  };

  const extensionFromUrl = (url: string) => {
    const clean = url.split('?')[0]?.split('#')[0] || '';
    const ext = clean.split('.').pop();
    if (!ext) return null;
    const normalized = ext.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(normalized)) return normalized;
    return null;
  };

  const triggerDownload = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (href.startsWith('blob:')) {
      URL.revokeObjectURL(href);
    }
  };

  const downloadAssetContent = async (asset: Asset) => {
    const baseName = `asset-${asset.id}`;
    if (asset.type === 'image' && asset.content) {
      if (asset.content.startsWith('data:image/')) {
        const parsed = dataUrlToBytes(asset.content);
        const ext = parsed ? extensionFromMime(parsed.mime) : 'png';
        triggerDownload(asset.content, `${baseName}.${ext}`);
        return;
      }
      const response = await fetch(asset.content);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }
      const blob = await response.blob();
      const ext = extensionFromUrl(asset.content) || extensionFromMime(blob.type || '');
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${baseName}.${ext || 'png'}`);
      return;
    }

    const textBlob = new Blob([asset.content || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(textBlob);
    triggerDownload(url, `${baseName}.txt`);
  };

  const exportProjectZip = (project: Project) => {
    const zipEntries: Record<string, Uint8Array> = {};
    const withAssets: Project = {
      ...project,
      artboards: project.artboards?.map((ab) => {
        const updatedAssets = ab.assets.map((asset, index) => {
          if (asset.type !== 'image' || !asset.content.startsWith('data:image/')) return asset;
          const parsed = dataUrlToBytes(asset.content);
          if (!parsed) return asset;
          const ext = extensionFromMime(parsed.mime);
          const fileName = `assets/${ab.id}-asset-${index}.${ext}`;
          zipEntries[fileName] = parsed.bytes;
          return { ...asset, content: `asset:${fileName}` };
        });

        if (!ab.posterData) {
          return { ...ab, assets: updatedAssets };
        }

        const posterData = { ...ab.posterData };
        if (posterData.imageUrl && posterData.imageUrl.startsWith('data:image/')) {
          const parsed = dataUrlToBytes(posterData.imageUrl);
          if (parsed) {
            const ext = extensionFromMime(parsed.mime);
            const fileName = `assets/${ab.id}-poster.${ext}`;
            zipEntries[fileName] = parsed.bytes;
            posterData.imageUrl = `asset:${fileName}`;
          }
        }
        if (posterData.imageUrlNoText && posterData.imageUrlNoText.startsWith('data:image/')) {
          const parsed = dataUrlToBytes(posterData.imageUrlNoText);
          if (parsed) {
            const ext = extensionFromMime(parsed.mime);
            const fileName = `assets/${ab.id}-poster-no-text.${ext}`;
            zipEntries[fileName] = parsed.bytes;
            posterData.imageUrlNoText = `asset:${fileName}`;
          }
        }
        if (posterData.imageUrlMerged && posterData.imageUrlMerged.startsWith('data:image/')) {
          const parsed = dataUrlToBytes(posterData.imageUrlMerged);
          if (parsed) {
            const ext = extensionFromMime(parsed.mime);
            const fileName = `assets/${ab.id}-poster-merged.${ext}`;
            zipEntries[fileName] = parsed.bytes;
            posterData.imageUrlMerged = `asset:${fileName}`;
          }
        }
        if (posterData.logoUrl && posterData.logoUrl.startsWith('data:image/')) {
          const parsed = dataUrlToBytes(posterData.logoUrl);
          if (parsed) {
            const ext = extensionFromMime(parsed.mime);
            const fileName = `assets/${ab.id}-logo.${ext}`;
            zipEntries[fileName] = parsed.bytes;
            posterData.logoUrl = `asset:${fileName}`;
          }
        }

        return {
          ...ab,
          assets: updatedAssets,
          posterData
        };
      })
    };

    const manifest = {
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      project: withAssets
    };
    const payload = JSON.stringify(manifest, null, 2);
    zipEntries['manifest.json'] = strToU8(payload);
    const zipped = zipSync(zipEntries);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const fileName = `${sanitizeFileName(project.title)}.zip`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const importProjectZip = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const unzipped = unzipSync(new Uint8Array(buffer));
    const manifestEntry = unzipped['manifest.json'];
    if (!manifestEntry) {
      throw new Error('manifest.json not found in zip.');
    }
    const manifest = JSON.parse(strFromU8(manifestEntry)) as {
      version?: number;
      project?: Project;
    };
    if (!manifest.project) {
      throw new Error('Invalid manifest.json payload.');
    }
    const readAsset = (value?: string) => {
      if (!value || !value.startsWith('asset:')) return value;
      const key = value.slice('asset:'.length);
      const bytes = unzipped[key];
      if (!bytes) return value;
      const ext = key.split('.').pop() || '';
      const mime = ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'application/octet-stream';
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return `data:${mime};base64,${base64}`;
    };

    const importedProject = {
      ...manifest.project,
      artboards: manifest.project.artboards?.map((ab) => ({
        ...ab,
        assets: ab.assets?.map((asset) => (
          asset.type === 'image'
            ? { ...asset, content: readAsset(asset.content) || '' }
            : asset
        )) || [],
        posterData: ab.posterData
          ? {
            ...ab.posterData,
            imageUrl: readAsset(ab.posterData.imageUrl),
            imageUrlNoText: readAsset(ab.posterData.imageUrlNoText),
            imageUrlMerged: readAsset(ab.posterData.imageUrlMerged),
            logoUrl: readAsset(ab.posterData.logoUrl)
          }
          : undefined
      }))
    } as Project;
    const existingIds = new Set(projects.map(p => p.id));
    const projectId = existingIds.has(importedProject.id) ? generateUUID() : importedProject.id;
    const normalized: Project = {
      ...importedProject,
      id: projectId,
      title: importedProject.title || 'Imported Project',
      createdAt: importedProject.createdAt || Date.now(),
      updatedAt: Date.now(),
      artboards: importedProject.artboards || []
    };
    const updatedProjects = [normalized, ...projects];
    saveProjectsToDisk(updatedProjects);
    setActiveProjectId(normalized.id);
    setViewMode('editor');
  };

  const updatePosterArtboard = useCallback((artboardId: string, updater: (artboard: Artboard) => Artboard) => {
    setArtboards(prev => prev.map(ab => ab.id === artboardId ? updater(ab) : ab));
  }, []);

  const openPosterModal = useCallback((artboardId: string) => {
    setActivePosterId(artboardId);
    setPosterFeedback('');
    setIsPosterModalOpen(true);
  }, []);

  const activeProject = projects.find(p => p.id === activeProjectId) || null;
  const boardWidth = activeProject?.width ?? DEFAULT_BOARD_WIDTH;
  const boardHeight = activeProject?.height ?? DEFAULT_BOARD_HEIGHT;
  const activePosterArtboard = artboards.find(ab => ab.id === activePosterId);
  const activePoster = activePosterArtboard?.posterData;
  const annotatorAspectRatio = (() => {
    if (annotatorImage) {
      const imageWidth = annotatorImage.naturalWidth || annotatorImage.width;
      const imageHeight = annotatorImage.naturalHeight || annotatorImage.height;
      if (imageWidth > 0 && imageHeight > 0) return imageWidth / imageHeight;
    }
    if (activePosterArtboard?.width && activePosterArtboard?.height) {
      return activePosterArtboard.width / activePosterArtboard.height;
    }
    return 9 / 16;
  })();

  useEffect(() => {
    artboardsRef.current = artboards;
  }, [artboards]);

  useEffect(() => {
    viewOffsetRef.current = viewOffset;
  }, [viewOffset]);

  useEffect(() => {
    if (!activeProject) return;
    if (lastLoadedProjectIdRef.current === activeProjectId) return;
    lastLoadedProjectIdRef.current = activeProjectId || null;
    setArtboards(activeProject.artboards || []);
    setCanvasAssets(activeProject.canvasAssets || []);
    setConnections(activeProject.connections || []);
    setSelection({ artboardId: null, assetId: null });
    setCanvasSelectionId(null);
    setMultiSelectedArtboards([]);
    setMultiSelectedCanvasAssets([]);
    setIsMarqueeSelecting(false);
    setMarqueeRect(null);
    setRightPanelMode('generator');
    setZoom(activeProject.view?.zoom ?? 1);
    setViewOffset({
      x: activeProject.view?.x ?? 0,
      y: activeProject.view?.y ?? 0
    });
    setTheme('');
    setStatus(AppStatus.IDLE);
    setStyleImages(activeProject.styleImages || []);
    setLogoImage(activeProject.logoImage || null);
    setFontReferenceImage(activeProject.fontReferenceImage || null);
    setActivePosterId(null);
    setEditablePoster(null);
    setEditableLayout(null);
    setEditableStyles(null);
    setAvailableFonts([]);
    setSelectedServerFont('');
    setRenderedLayoutUrl(null);
    setShowRenderedLayout(false);
    setIsRenderingLayout(false);
    setShowTextBoxes(true);
    setPendingRenderCommit(false);
    lastRenderedSignatureRef.current = '';
    setDidAutoSizeLayout(false);
    setNoTextImageSize(null);
    setNoTextContainRect(null);
    setManualSizedKeys(new Set());
    setIsResizingTextBox(false);
    setShowNoTextEdit(false);
    setNoTextLoadingId(null);
    setPosterFeedback('');
    setIsPosterModalOpen(false);
    setIsResolutionModalOpen(false);
    setIsRefiningPoster(false);
    setIsGeneratingResolutions(false);
    setSelectedRefineResolutions(new Set());
    setProjectTitleDraft(activeProject.title || '');
    setIsRenamingProject(false);
    setCommentMessages([]);
    setCommentInput('');
    setIsCommentLoading(false);
    setCommentAttachments([]);
    setGalleryVisibleCount(10);
    setGalleryFileUrls([]);
    setGalleryLoading(false);
    setGalleryError('');
    setFadeInCanvasAssetIds(new Set());
    fadeInCanvasTimersRef.current = {};
    historyRef.current = [];
    redoRef.current = [];
    historySignatureRef.current = '';
    autoSaveSignatureRef.current = '';
  }, [activeProjectId, activeProject]);

  // Resume polling for any generating tasks after page load/refresh
  useEffect(() => {
    if (!activeProject) return;

    const generatingArtboards = (activeProject.artboards || []).filter(
      ab => ab.posterData?.taskId && (ab.posterData.status === 'generating' || ab.posterData.status === 'planning')
    );

    if (generatingArtboards.length === 0) return;

    console.log(`[recovery] Found ${generatingArtboards.length} tasks to resume polling`);

    // Resume polling for each task
    generatingArtboards.forEach(ab => {
      const taskId = ab.posterData!.taskId!;
      const posterId = ab.id;

      void (async () => {
        try {
          while (true) {
            const result = await getAITaskStatus(taskId);

            if (result.status === 'completed') {
              const imageUrl = extractImageFromTaskResult(result);
              if (imageUrl) {
                setArtboards(prev => prev.map(a => {
                  if (a.id !== posterId) return a;
                  return {
                    ...a,
                    posterData: {
                      ...a.posterData!,
                      imageUrl,
                      imageUrlNoText: undefined,
                      textLayout: a.posterData?.textLayout || buildDefaultTextLayout(),
                      status: 'completed',
                      taskId: undefined
                    }
                  };
                }));
              } else {
                throw new Error('No image in result');
              }
              console.log(`[recovery] Task ${taskId} completed`);
              break;
            } else if (result.status === 'error') {
              throw new Error(result.error || 'Task failed');
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (err) {
          console.error(`[recovery] Task ${taskId} failed:`, err);
          setArtboards(prev => prev.map(a =>
            a.id === posterId
              ? { ...a, posterData: { ...a.posterData!, status: 'error', taskId: undefined } }
              : a
          ));
        }
      })();
    });
  }, [activeProjectId]); // Only run when project changes, not on every artboards update

  useEffect(() => {
    if (!assetContextMenu) return;
    const handleClose = () => setAssetContextMenu(null);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [assetContextMenu]);

  useEffect(() => {
    if (!canvasContextMenu) return;
    const handleClose = () => setCanvasContextMenu(null);
    window.addEventListener('scroll', handleClose, true);
    window.addEventListener('resize', handleClose);
    return () => {
      window.removeEventListener('scroll', handleClose, true);
      window.removeEventListener('resize', handleClose);
    };
  }, [canvasContextMenu]);


  useEffect(() => {
    if (!activePoster) return;
    const snapshot: PlanningStep = {
      topBanner: activePoster.topBanner || '',
      headline: activePoster.headline || '',
      subheadline: activePoster.subheadline || '',
      infoBlock: {
        orgName: activePoster.infoBlock?.orgName || '',
        details: activePoster.infoBlock?.details || '',
        credits: activePoster.infoBlock?.credits || ''
      },
      accentColor: activePoster.accentColor || '',
      visualPrompt: activePoster.visualPrompt || '',
      logoUrl: activePoster.logoUrl
    };
    setEditablePoster(snapshot);
    setEditableLayout(activePoster.textLayout || buildDefaultTextLayout());
    const defaultStyles: TextStyleMap = {
      topBanner: { fontSize: 10, color: '#ffffff', fontWeight: 800, fontStyle: 'normal', textDecoration: 'none', textAlign: 'center' },
      headline: { fontSize: 20, color: '#ffffff', fontWeight: 900, fontStyle: 'normal', textDecoration: 'none', textAlign: 'center' },
      subheadline: { fontSize: 12, color: '#ffffff', fontWeight: 600, fontStyle: 'normal', textDecoration: 'none', textAlign: 'center' },
      infoBlock: { fontSize: 11, color: '#ffffff', fontWeight: 600, fontStyle: 'normal', textDecoration: 'none', textAlign: 'center' }
    };
    const normalizeStyles = (styles?: TextStyleMap): TextStyleMap => ({
      topBanner: { ...defaultStyles.topBanner, ...(styles?.topBanner || {}) },
      headline: { ...defaultStyles.headline, ...(styles?.headline || {}) },
      subheadline: { ...defaultStyles.subheadline, ...(styles?.subheadline || {}) },
      infoBlock: { ...defaultStyles.infoBlock, ...(styles?.infoBlock || {}) }
    });
    setEditableStyles(normalizeStyles(activePoster.textStyles));
    setSelectedTextKey('headline');
    setDidAutoSizeLayout(false);
    setNoTextImageSize(null);
    setNoTextContainRect(null);
    setManualSizedKeys(new Set());
    setIsResizingTextBox(false);
    setShowNoTextEdit(false);
    setShowTextBoxes(true);
    setPendingRenderCommit(false);
    setDidResolveOverlap(false);
    lastRenderedSignatureRef.current = '';
    setAnnotationTool('rect');
    setAnnotationColor('green');
    setAnnotationZoom(1);
    setAnnotationPan({ x: 0, y: 0 });
    setAnnotations([]);
    setAnnotationNotes({});
    setAnnotationDraft(null);
    setIsAnnotating(false);
    annotationIdRef.current = 1;
    setAnnotatorImage(null);
    setAnnotatorLoaded(false);
    setRefineReferenceImage(null);
    setFeedbackSuggestions([]);
    setIsLoadingSuggestions(false);
    setIdeaLoadingLabel('Warming Up');
    setSelectedSuggestions(new Set());
    annotationHistoryRef.current = [];
    annotationRedoRef.current = [];
    isAnnotationRestoringRef.current = false;
  }, [activePosterId, isPosterModalOpen]);

  useEffect(() => {
    if (!showNoTextEdit) {
      setSelectedTextKey(null);
      setDidResolveOverlap(false);
      return;
    }
    setSelectedTextKey(null);
    setShowTextBoxes(false);
  }, [showNoTextEdit]);

  useEffect(() => {
    if (!isPosterModalOpen) return;
    const imageUrl = activePoster?.imageUrlMerged || activePoster?.imageUrl;
    console.log('[annotator] modal open', { imageUrl, posterId: activePoster?.id });
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      console.log('[annotator] preload loaded', { width: img.width, height: img.height, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
      setAnnotatorImage(img);
      setAnnotatorLoaded(true);
      setAnnotatorReadyTick((prev) => prev + 1);
    };
    img.onerror = () => {
      console.warn('[annotator] preload failed', { imageUrl });
      setAnnotatorImage(null);
      setAnnotatorLoaded(false);
    };
    img.src = imageUrl;
  }, [isPosterModalOpen, activePoster?.imageUrlMerged, activePoster?.imageUrl]);

  useEffect(() => {
    if (!isPosterModalOpen) return;
    const container = annotatorRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      console.log('[annotator] container', { width: rect.width, height: rect.height });
      setAnnotatorSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    requestAnimationFrame(updateSize);
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isPosterModalOpen, annotatorReadyTick]);

  useEffect(() => {
    if (!isPosterModalOpen) return;
    if (isAnnotationRestoringRef.current) return;
    const snapshot = annotations.map(annotation => ({ ...annotation }));
    const last = annotationHistoryRef.current[annotationHistoryRef.current.length - 1];
    const signature = JSON.stringify(snapshot);
    if (last && JSON.stringify(last) === signature) return;
    annotationHistoryRef.current = [...annotationHistoryRef.current, snapshot].slice(-50);
    annotationRedoRef.current = [];
  }, [annotations, isPosterModalOpen]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (isRestoringRef.current) return;
    const snapshot = {
      artboards: JSON.parse(JSON.stringify(artboards)) as Artboard[],
      canvasAssets: JSON.parse(JSON.stringify(canvasAssets)) as Asset[],
      connections: JSON.parse(JSON.stringify(connections)) as Connection[]
    };
    const signature = JSON.stringify(snapshot);
    if (signature === historySignatureRef.current) return;
    historySignatureRef.current = signature;
    historyRef.current = [...historyRef.current, snapshot].slice(-50);
    redoRef.current = [];
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(redoRef.current.length > 0);
  }, [activeProjectId, artboards, canvasAssets, connections]);

  useEffect(() => {
    if (!activeProjectId || !activeProject || !authUser) return;
    let isMounted = true;
    const tick = async () => {
      if (!isMounted || autoSaveInFlightRef.current) return;
      const snapshot = buildProjectSnapshot({}, { includeUploads: true });
      if (!snapshot) return;
      const signature = JSON.stringify({ ...snapshot, updatedAt: 0 });
      if (signature === autoSaveSignatureRef.current) return;
      autoSaveSignatureRef.current = signature;
      autoSaveInFlightRef.current = true;
      setIsAutoSaving(true);
      const updatedProjects = projects.map(project => (
        project.id === snapshot.id ? snapshot : project
      ));
      saveProjectsToDisk(updatedProjects);
      try {
        await saveProjectToBackend(snapshot.id, snapshot);
      } finally {
        autoSaveInFlightRef.current = false;
        if (isMounted) {
          setIsAutoSaving(false);
        }
      }
    };
    const intervalId = window.setInterval(() => {
      void tick();
    }, 5000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [
    activeProjectId,
    activeProject,
    authUser,
    artboards,
    canvasAssets,
    connections,
    styleImages,
    logoImage,
    viewOffset,
    zoom,
    projects
  ]);

  useEffect(() => {
    if (!showNoTextEdit || !noTextRef.current || !noTextImageSize) return;
    const updateContainRect = () => {
      const rect = noTextRef.current?.getBoundingClientRect();
      if (!rect) return;
      const containerRatio = rect.width / rect.height;
      const imageRatio = noTextImageSize.width / noTextImageSize.height;
      let width = rect.width;
      let height = rect.height;
      if (imageRatio > containerRatio) {
        height = rect.width / imageRatio;
      } else {
        width = rect.height * imageRatio;
      }
      const left = (rect.width - width) / 2;
      const top = (rect.height - height) / 2;
      setNoTextContainRect({ left, top, width, height });
    };
    updateContainRect();
    window.addEventListener('resize', updateContainRect);
    return () => window.removeEventListener('resize', updateContainRect);
  }, [showNoTextEdit, noTextImageSize]);

  useEffect(() => {
    if (!showNoTextEdit) return;
    if (!editableLayout || !editableStyles || !editablePoster || !noTextContainRect) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const containerWidth = noTextContainRect.width;
    const containerHeight = noTextContainRect.height;
    if (!containerWidth || !containerHeight) return;

    const measureBlock = (key: keyof TextLayout, text: string, widthPx: number) => {
      const style = editableStyles[key];
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px serif`;
      const lineHeight = style.fontSize * 1.2;
      const paragraphs = text.split('\n');
      let totalHeight = 0;
      let maxLineWidth = 0;
      paragraphs.forEach((paragraph, index) => {
        const lines = wrapTextLines(ctx, paragraph, widthPx);
        lines.forEach((line) => {
          maxLineWidth = Math.max(maxLineWidth, ctx.measureText(line).width);
        });
        totalHeight += lines.length * lineHeight;
        if (index < paragraphs.length - 1) {
          totalHeight += lineHeight * 0.2;
        }
      });
      return {
        height: Math.max(lineHeight, totalHeight),
        width: Math.max(1, maxLineWidth)
      };
    };

    const adjustBlock = (key: keyof TextLayout, text: string, layout: TextLayout) => {
      if (manualSizedKeys.has(key)) {
        return layout[key];
      }
      const box = layout[key];
      const maxWidthPx = (1 - box.x) * containerWidth;
      const maxHeightPx = (1 - box.y) * containerHeight;
      const currentWidthPx = box.width * containerWidth;

      const firstPass = measureBlock(key, text, currentWidthPx);
      const targetWidthPx = Math.min(maxWidthPx, Math.max(firstPass.width, 4));
      const secondPass = measureBlock(key, text, targetWidthPx);
      const nextWidth = Math.max(currentWidthPx, targetWidthPx);
      const nextHeight = Math.max(box.height * containerHeight, Math.min(maxHeightPx, secondPass.height));

      return {
        ...box,
        width: nextWidth / containerWidth,
        height: nextHeight / containerHeight
      };
    };

    const blocks = [
      { key: 'topBanner', text: editablePoster.topBanner },
      { key: 'headline', text: editablePoster.headline },
      { key: 'subheadline', text: editablePoster.subheadline },
      {
        key: 'infoBlock',
        text: `${editablePoster.infoBlock.orgName}\n${editablePoster.infoBlock.details}\n${editablePoster.infoBlock.credits}`
      }
    ] as const;

    let layoutChanged = false;
    const nextLayout = { ...editableLayout };

    blocks.forEach(({ key, text }) => {
      const nextBox = adjustBlock(key, text, nextLayout);
      if (Math.abs(nextBox.height - nextLayout[key].height) > 0.002 || Math.abs(nextBox.width - nextLayout[key].width) > 0.002) {
        nextLayout[key] = nextBox;
        layoutChanged = true;
      }
    });

    if (layoutChanged) setEditableLayout(nextLayout);
  }, [showNoTextEdit, editableLayout, editableStyles, editablePoster, noTextContainRect, manualSizedKeys, isResizingTextBox]);

  useEffect(() => {
    if (!showNoTextEdit || didAutoSizeLayout) return;
    if (!noTextContainRect) return;
    const frame = requestAnimationFrame(() => {
      const containerWidth = noTextContainRect.width;
      const containerHeight = noTextContainRect.height;
      if (!containerWidth || !containerHeight) return;
      setEditableLayout((prev) => {
        if (!prev) return prev;
        let layoutChanged = false;
        const nextLayout = { ...prev };
        (Object.keys(nextLayout) as Array<keyof TextLayout>).forEach((key) => {
          const textArea = textAreaRefs.current[key];
          if (!textArea) return;
          const wrapper = textArea.closest('[data-textbox]') as HTMLElement | null;
          if (!wrapper) return;
          const wrapperStyles = window.getComputedStyle(wrapper);
          const paddingLeft = Number.parseFloat(wrapperStyles.paddingLeft || '0') || 0;
          const paddingRight = Number.parseFloat(wrapperStyles.paddingRight || '0') || 0;
          const paddingTop = Number.parseFloat(wrapperStyles.paddingTop || '0') || 0;
          const paddingBottom = Number.parseFloat(wrapperStyles.paddingBottom || '0') || 0;
          const maxWidthFrac = Math.max(0.02, 1 - nextLayout[key].x);
          const maxHeightFrac = Math.max(0.02, 1 - nextLayout[key].y);
          const currentWidthPx = nextLayout[key].width * containerWidth;
          const currentHeightPx = nextLayout[key].height * containerHeight;
          const desiredWidthPx = Math.min(
            maxWidthFrac * containerWidth,
            Math.max(currentWidthPx, Math.ceil(textArea.scrollWidth + paddingLeft + paddingRight))
          );
          const requiredHeightPx = measureTextBoxHeight(key, desiredWidthPx);
          const desiredHeightPx = requiredHeightPx
            ? Math.min(maxHeightFrac * containerHeight, Math.max(currentHeightPx, requiredHeightPx))
            : currentHeightPx;
          const nextWidth = Math.min(maxWidthFrac, Math.max(0.02, desiredWidthPx / containerWidth));
          const nextHeight = Math.min(maxHeightFrac, Math.max(0.02, desiredHeightPx / containerHeight));
          if (Math.abs(nextWidth - nextLayout[key].width) > 0.001 || Math.abs(nextHeight - nextLayout[key].height) > 0.001) {
            nextLayout[key] = {
              ...nextLayout[key],
              width: nextWidth,
              height: nextHeight
            };
            layoutChanged = true;
          }
        });
        if (layoutChanged) return nextLayout;
        return prev;
      });
      setDidAutoSizeLayout(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [showNoTextEdit, didAutoSizeLayout, noTextContainRect]);

  useEffect(() => {
    if (!showNoTextEdit || didResolveOverlap) return;
    if (!editableLayout || !noTextContainRect) return;
    const gapFrac = Math.min(0.02, 8 / Math.max(1, noTextContainRect.height));
    const order: Array<keyof TextLayout> = ['topBanner', 'headline', 'subheadline', 'infoBlock'];
    let cursor = 0;
    let changed = false;
    const nextLayout = { ...editableLayout };
    order.forEach((key) => {
      const box = nextLayout[key];
      const minY = cursor;
      let nextY = box.y;
      if (nextY < minY) {
        nextY = minY;
      }
      const maxY = Math.max(0, 1 - box.height);
      if (nextY > maxY) {
        nextY = maxY;
      }
      if (Math.abs(nextY - box.y) > 0.0005) {
        nextLayout[key] = { ...box, y: nextY };
        changed = true;
      }
      cursor = Math.min(1, nextLayout[key].y + nextLayout[key].height + gapFrac);
    });
    if (changed) {
      setEditableLayout(nextLayout);
    }
    setDidResolveOverlap(true);
  }, [showNoTextEdit, didResolveOverlap, editableLayout, noTextContainRect]);

  useEffect(() => {
    if (!showNoTextEdit || !noTextContainRect) return;
    const containerHeight = noTextContainRect.height;
    if (!containerHeight) return;
    setEditableLayout((prev) => {
      if (!prev) return prev;
      let layoutChanged = false;
      const nextLayout = { ...prev };
      (Object.keys(nextLayout) as Array<keyof TextLayout>).forEach((key) => {
        const textArea = textAreaRefs.current[key];
        if (!textArea) return;
        const wrapper = textArea.closest('[data-textbox]') as HTMLElement | null;
        if (!wrapper) return;
        const scrollHeight = Math.ceil(textArea.scrollHeight);
        const currentHeightPx = wrapper.getBoundingClientRect().height;
        if (scrollHeight <= currentHeightPx + 2) return;
        const maxHeightFrac = Math.max(0.02, 1 - nextLayout[key].y);
        const requiredHeightPx = Math.min(maxHeightFrac * containerHeight, scrollHeight + 2);
        const requiredHeightFrac = requiredHeightPx / containerHeight;
        if (requiredHeightFrac > nextLayout[key].height + 0.001) {
          nextLayout[key] = {
            ...nextLayout[key],
            height: requiredHeightFrac
          };
          layoutChanged = true;
        }
      });
      return layoutChanged ? nextLayout : prev;
    });
  }, [showNoTextEdit, noTextContainRect]);

  useEffect(() => {
    const isOnBoard = route.startsWith('/board/');
    if (!isPosterModalOpen && !isOnBoard) return;
    if (availableFonts.length > 0) return;
    const loadFonts = async () => {
      try {
        const response = await fetch(`${FONT_PREVIEW_API}/fonts`);
        if (!response.ok) return;
        const data = await response.json() as { fonts?: string[] };
        setAvailableFonts(data.fonts || []);
      } catch (err) {
        console.warn('Failed to load fonts list', err);
      }
    };
    loadFonts();
  }, [isPosterModalOpen, route, availableFonts.length]);

  useEffect(() => {
    if (!showNoTextEdit) return;
    if (selectedServerFont) return;
    if (availableFonts.length === 0) return;
    const defaultFont = availableFonts[0];
    setSelectedServerFont(defaultFont);
    setRenderedLayoutUrl(null);
    setShowRenderedLayout(false);
    lastRenderedSignatureRef.current = '';
    setPendingRenderCommit(true);
  }, [showNoTextEdit, selectedServerFont, availableFonts]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!dragState.current || !editableLayout || !noTextRef.current) return;
      const rect = noTextRef.current.getBoundingClientRect();
      const dx = event.clientX - dragState.current.startX;
      const dy = event.clientY - dragState.current.startY;
      const deltaX = dx / rect.width;
      const deltaY = dy / rect.height;
      const key = dragState.current.key;
      if (!key) return;
      const box = editableLayout[key];
      if (dragState.current.mode === 'move') {
        setEditableLayout({
          ...editableLayout,
          [key]: {
            ...box,
            x: Math.min(1, Math.max(0, dragState.current.originX + deltaX)),
            y: Math.min(1, Math.max(0, dragState.current.originY + deltaY))
          }
        });
        return;
      }

      const minSize = 0.04;
      const maxWidthFrac = Math.max(minSize, 1 - box.x);
      const maxHeightFrac = Math.max(minSize, 1 - box.y);
      const proposedWidthFrac = Math.min(maxWidthFrac, Math.max(minSize, dragState.current.originW + deltaX));
      const proposedHeightFrac = Math.min(maxHeightFrac, Math.max(minSize, dragState.current.originH + deltaY));

      let nextWidth = proposedWidthFrac;
      let nextHeight = proposedHeightFrac;

      if (editablePoster && editableStyles) {
        const maxWidthPx = maxWidthFrac * rect.width;
        const maxHeightPx = maxHeightFrac * rect.height;
        const minWidthPx = Math.max(4, minSize * rect.width);
        const proposedWidthPx = Math.min(maxWidthPx, Math.max(minWidthPx, proposedWidthFrac * rect.width));
        let requiredHeightPx = measureTextBoxHeight(key, proposedWidthPx);

        if (requiredHeightPx !== null && requiredHeightPx > maxHeightPx) {
          const widenedHeight = measureTextBoxHeight(key, maxWidthPx);
          if (widenedHeight !== null && widenedHeight <= maxHeightPx) {
            nextWidth = maxWidthFrac;
            requiredHeightPx = widenedHeight;
          }
        }

        if (requiredHeightPx !== null) {
          nextHeight = Math.min(
            maxHeightFrac,
            Math.max(proposedHeightFrac, requiredHeightPx / rect.height)
          );
        }
        nextWidth = Math.min(maxWidthFrac, Math.max(minSize, nextWidth));
      }

      setEditableLayout({
        ...editableLayout,
        [key]: {
          ...box,
          width: nextWidth,
          height: nextHeight
        }
      });
    };
    const handleUp = () => {
      if (!showTextBoxes && dragState.current?.key) {
        setPendingRenderCommit(true);
      }
      dragState.current = null;
      setIsResizingTextBox(false);
    };
    const handleCancel = () => handleUp();
    const handleVisibilityChange = () => {
      if (document.hidden) handleUp();
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.addEventListener('mouseup', handleUp);
    window.addEventListener('mouseleave', handleCancel);
    window.addEventListener('blur', handleCancel);
    document.addEventListener('mouseleave', handleCancel);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.removeEventListener('mouseup', handleUp);
      window.removeEventListener('mouseleave', handleCancel);
      window.removeEventListener('blur', handleCancel);
      document.removeEventListener('mouseleave', handleCancel);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [editableLayout, editablePoster, editableStyles, showTextBoxes]);

  useEffect(() => {
    if (!pendingRenderCommit) return;
    setPendingRenderCommit(false);
    void refreshRenderedLayout();
  }, [pendingRenderCommit, editableLayout, editablePoster, editableStyles, selectedServerFont]);

  useEffect(() => {
    if (!showNoTextEdit || !showRenderedLayout || !selectedServerFont) return;
    if (!noTextContainRect) return;
    void refreshRenderedLayout();
  }, [showNoTextEdit, showRenderedLayout, selectedServerFont, noTextContainRect]);

  const handleCreateProject = async () => {
    if (!newProjectData.title.trim()) return;
    const newProject: Project = {
      id: generateUUID(),
      title: newProjectData.title.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      width: DEFAULT_BOARD_WIDTH,
      height: DEFAULT_BOARD_HEIGHT,
      artboards: [],
      view: { x: 0, y: 0, zoom: 1 }
    };
    const updated = [newProject, ...projects];
    saveProjectsToDisk(updated);
    // Save to backend
    await saveProjectToBackend(newProject.id, newProject);
    setIsNewProjectModalOpen(false);
    setNewProjectData({ title: '', width: DEFAULT_BOARD_WIDTH, height: DEFAULT_BOARD_HEIGHT });
    // Navigate to board
    handleNavigate(`/board/${newProject.id}`);
  };

  const handleOpenProject = async (id: string) => {
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/projects/${id}`);
      if (response.status === 401) {
        setAuthUser(null);
        return;
      }
      if (!response.ok) {
        throw new Error(`Failed to load project ${id}: ${response.status}`);
      }
      const data = await response.json();
      const fetched = convertFileUrlsToHttp(data as Project);
      setProjects((prev) => {
        const updated = prev.map((project) => (project.id === id ? fetched : project));
        saveProjectsToDisk(updated);
        return updated;
      });
    } catch (error) {
      console.warn('[warn] Failed to fetch project from backend, using local copy:', error);
    }
    handleNavigate(`/board/${id}`);
  };

  const handleDeleteProject = async (id: string) => {
    if (confirm('Delete this project?')) {
      const updated = projects.filter(p => p.id !== id);
      saveProjectsToDisk(updated);
      // Delete from backend
      try {
        const response = await fetchWithAuth(`${BACKEND_API}/projects/${id}`, { method: 'DELETE' });
        if (response.status === 401) {
          setAuthUser(null);
          return;
        }
        console.log('[info] Project deleted from backend:', id);
      } catch (error) {
        console.warn('[warn] Failed to delete project from backend:', error);
      }
      if (activeProjectId === id) {
        handleNavigate('/');
      }
    }
  };

  const persistActiveProject = () => {
    const snapshot = buildProjectSnapshot();
    if (!snapshot) return null;
    const updated = projects.map(project =>
      project.id === snapshot.id ? snapshot : project
    );
    saveProjectsToDisk(updated);
    return snapshot;
  };

  const handleSaveProject = () => {
    const snapshot = persistActiveProject();
    if (snapshot) {
      exportProjectZip(snapshot);
    }
  };

  const handleBackToDashboard = () => {
    const snapshot = persistActiveProject();
    if (snapshot) {
      void saveProjectToBackend(snapshot.id, snapshot);
    }
    handleNavigate('/');
  };

  const handleRenameProject = async () => {
    if (!activeProjectId || !activeProject) return;
    const nextTitle = projectTitleDraft.trim() || activeProject.title || 'Untitled Project';
    const updatedProjects = projects.map(project =>
      project.id === activeProjectId ? { ...project, title: nextTitle, updatedAt: Date.now() } : project
    );
    saveProjectsToDisk(updatedProjects);
    setIsRenamingProject(false);
    const updatedProject = updatedProjects.find(project => project.id === activeProjectId);
    if (updatedProject) {
      await saveProjectToBackend(activeProjectId, updatedProject);
    }
  };

  const collectSelectedImages = useCallback(() => {
    const imageUrls: string[] = [];
    const artboardIds = multiSelectedArtboards.length > 0 ? multiSelectedArtboards : (selection.artboardId ? [selection.artboardId] : []);
    artboardIds.forEach((id) => {
      const artboard = artboards.find((ab) => ab.id === id);
      const posterUrl = artboard?.posterData?.imageUrlMerged || artboard?.posterData?.imageUrl;
      if (posterUrl) imageUrls.push(posterUrl);
    });
    const assetIds = multiSelectedCanvasAssets.length > 0 ? multiSelectedCanvasAssets : (canvasSelectionId ? [canvasSelectionId] : []);
    assetIds.forEach((id) => {
      const asset = canvasAssets.find((item) => item.id === id);
      if (asset?.type === 'image' && asset.content) imageUrls.push(asset.content);
    });
    return Array.from(new Set(imageUrls));
  }, [multiSelectedArtboards, selection.artboardId, artboards, multiSelectedCanvasAssets, canvasSelectionId, canvasAssets]);

  const resolveRefineTargetId = useCallback(() => {
    const candidateIds = multiSelectedArtboards.length > 0
      ? multiSelectedArtboards
      : (selection.artboardId ? [selection.artboardId] : []);
    for (const id of candidateIds) {
      const artboard = artboards.find((ab) => ab.id === id);
      if (artboard?.posterData) {
        return id;
      }
    }
    return null;
  }, [multiSelectedArtboards, selection.artboardId, artboards]);

  useEffect(() => {
    const attachments = collectSelectedImages();
    setCommentAttachments(attachments);
    if (attachments.length > 0) {
      setRightPanelMode('comment');
    } else {
      setRightPanelMode('generator');
    }
  }, [collectSelectedImages]);

  const handleSendComment = async () => {
    const trimmed = commentInput.trim();
    if (!trimmed || isCommentLoading) return;
    const refineTargetId = resolveRefineTargetId();
    if (refineTargetId) {
      setCommentInput('');
      openPosterModal(refineTargetId);
      setPosterFeedback(trimmed);
      return;
    }
    const attachments = commentAttachments;
    const nextMessages: ChatMessage[] = [...commentMessages, { role: 'user', content: trimmed, images: attachments }];
    setCommentMessages(nextMessages);
    setCommentInput('');
    setIsCommentLoading(true);
    try {
      const reply = await chatWithModel(nextMessages);
      setCommentMessages(prev => [...prev, { role: 'assistant', content: reply || 'Sorry, I could not generate a response.' }]);
    } catch (error) {
      setCommentMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, there was a problem contacting the model.' }
      ]);
    } finally {
      setIsCommentLoading(false);
    }
  };


  const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    if (!text) return [''];
    const hasSpaces = /\s/.test(text);
    if (!hasSpaces) {
      const lines: string[] = [];
      let current = '';
      for (const char of text) {
        const test = current + char;
        if (ctx.measureText(test).width <= maxWidth || !current) {
          current = test;
        } else {
          lines.push(current);
          current = char;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    words.forEach((word) => {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
        return;
      }
      if (current) lines.push(current);
      if (ctx.measureText(word).width <= maxWidth) {
        current = word;
        return;
      }
      let chunk = '';
      for (const char of word) {
        const testChunk = chunk + char;
        if (ctx.measureText(testChunk).width <= maxWidth || !chunk) {
          chunk = testChunk;
        } else {
          lines.push(chunk);
          chunk = char;
        }
      }
      current = chunk;
    });
    if (current) lines.push(current);
    return lines;
  };

  const measureTextBoxHeight = (key: keyof TextLayout, widthPx: number) => {
    const textArea = textAreaRefs.current[key];
    if (!textArea) return null;
    const wrapper = textArea.closest('[data-textbox]') as HTMLElement | null;
    if (!wrapper) return null;
    if (!measureDivRef.current) {
      const div = document.createElement('div');
      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      div.style.pointerEvents = 'none';
      div.style.left = '-9999px';
      div.style.top = '-9999px';
      div.style.whiteSpace = 'pre-wrap';
      div.style.wordBreak = 'break-word';
      div.style.boxSizing = 'border-box';
      measureDivRef.current = div;
      document.body.appendChild(div);
    }
    const div = measureDivRef.current;
    const styles = window.getComputedStyle(textArea);
    const wrapperStyles = window.getComputedStyle(wrapper);
    const paddingLeft = Number.parseFloat(wrapperStyles.paddingLeft || '0') || 0;
    const paddingRight = Number.parseFloat(wrapperStyles.paddingRight || '0') || 0;
    const paddingTop = Number.parseFloat(wrapperStyles.paddingTop || '0') || 0;
    const paddingBottom = Number.parseFloat(wrapperStyles.paddingBottom || '0') || 0;
    div.style.fontFamily = styles.fontFamily;
    div.style.fontSize = styles.fontSize;
    div.style.fontWeight = styles.fontWeight;
    div.style.fontStyle = styles.fontStyle;
    div.style.letterSpacing = styles.letterSpacing;
    div.style.lineHeight = styles.lineHeight;
    div.style.padding = '0';
    const contentWidth = Math.max(1, widthPx - paddingLeft - paddingRight);
    div.style.width = `${contentWidth}px`;
    div.textContent = textArea.value || '';
    const textHeight = div.scrollHeight;
    return textHeight + paddingTop + paddingBottom + 2;
  };

  const drawWrappedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    lineHeight: number,
    underline: boolean,
    align: 'left' | 'center' | 'right'
  ) => {
    const paragraphs = text.split('\n');
    let cursorY = y;
    paragraphs.forEach((paragraph, index) => {
      const lines = wrapTextLines(ctx, paragraph, width);
      lines.forEach((line) => {
        if (cursorY + lineHeight > y + height) return;
        const lineWidth = ctx.measureText(line).width;
        let drawX = x;
        if (align === 'center') {
          drawX = x + (width - lineWidth) / 2;
        } else if (align === 'right') {
          drawX = x + (width - lineWidth);
        }
        ctx.fillText(line, drawX, cursorY);
        if (underline) {
          const underlineY = cursorY + lineHeight * 0.85;
          ctx.strokeStyle = ctx.fillStyle as string;
          ctx.lineWidth = Math.max(1, lineHeight * 0.06);
          ctx.beginPath();
          ctx.moveTo(drawX, underlineY);
          ctx.lineTo(drawX + lineWidth, underlineY);
          ctx.stroke();
        }
        cursorY += lineHeight;
      });
      if (index < paragraphs.length - 1) {
        cursorY += lineHeight * 0.2;
      }
    });
  };

  const getWrappedText = (
    key: keyof TextLayout,
    text: string,
    baseWidth: number | null,
    logLines = false
  ) => {
    if (!editableLayout || !editableStyles) return text;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return text;
    const style = editableStyles[key];
    const textarea = textAreaRefs.current[key];
    const cachedWrapped = wrapCacheRef.current[key];
    const previewRect = noTextContainRect ?? noTextRef.current?.getBoundingClientRect();
    const previewWidth = previewRect?.width || 0;
    const widthSource = baseWidth && baseWidth > 0 ? baseWidth : previewWidth;
    let widthPx = Math.max(1, editableLayout[key].width * (widthSource || 1));
    let fontFamily = `"${selectedServerFont}", serif`;
    let normalizedText = text;
    if (textarea) {
      const textStyles = window.getComputedStyle(textarea);
      fontFamily = textStyles.fontFamily || fontFamily;
      textTransformRef.current[key] = textStyles.textTransform || '';
      if (textStyles.textTransform === 'uppercase') {
        normalizedText = normalizedText.toUpperCase();
      } else if (textStyles.textTransform === 'lowercase') {
        normalizedText = normalizedText.toLowerCase();
      } else if (textStyles.textTransform === 'capitalize') {
        normalizedText = normalizedText.replace(/\b\w/g, (char) => char.toUpperCase());
      }
      const wrapper = textarea.closest('[data-textbox]') as HTMLElement | null;
      if (wrapper) {
        const wrapperStyles = window.getComputedStyle(wrapper);
        const paddingLeft = Number.parseFloat(wrapperStyles.paddingLeft || '0') || 0;
        const paddingRight = Number.parseFloat(wrapperStyles.paddingRight || '0') || 0;
        const wrapperWidth = wrapper.getBoundingClientRect().width;
        widthPx = Math.max(1, wrapperWidth - paddingLeft - paddingRight);
        textBoxWidthRef.current[key] = widthPx;
      }
    } else if (textBoxWidthRef.current[key]) {
      widthPx = textBoxWidthRef.current[key];
      const cachedTransform = textTransformRef.current[key];
      if (cachedTransform === 'uppercase') {
        normalizedText = normalizedText.toUpperCase();
      } else if (cachedTransform === 'lowercase') {
        normalizedText = normalizedText.toLowerCase();
      } else if (cachedTransform === 'capitalize') {
        normalizedText = normalizedText.replace(/\b\w/g, (char) => char.toUpperCase());
      }
      if (cachedWrapped) {
        if (logLines) {
          const signature = `${Math.round(widthPx)}|${cachedWrapped}`;
          if (wrapLogRef.current[key] !== signature) {
            wrapLogRef.current[key] = signature;
          }
        }
        return cachedWrapped;
      }
    }
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${fontFamily}`;
    const paragraphs = normalizedText.split('\n');
    const lines: string[] = [];
    paragraphs.forEach((paragraph) => {
      const wrapped = wrapTextLines(ctx, paragraph, widthPx);
      lines.push(...wrapped);
    });
    const wrappedText = lines.join('\n');
    wrapCacheRef.current[key] = wrappedText;
    if (logLines) {
      const signature = `${Math.round(widthPx)}|${lines.join('\n')}`;
      if (wrapLogRef.current[key] !== signature) {
        wrapLogRef.current[key] = signature;
      }
    }
    return wrappedText;
  };

  const requestServerLayoutImage = async (width: number, height: number) => {
    if (!editablePoster || !editableLayout || !editableStyles || !selectedServerFont) return null;
    const payload = {
        font: selectedServerFont,
        width,
        height,
        background: 'transparent',
        format: 'png',
        respectLineBreaks: true,
        blocks: [
        {
          key: 'topBanner',
          text: getWrappedText('topBanner', editablePoster.topBanner, width, true),
          box: editableLayout.topBanner,
          style: editableStyles.topBanner
        },
        {
          key: 'headline',
          text: getWrappedText('headline', editablePoster.headline, width, true),
          box: editableLayout.headline,
          style: editableStyles.headline
        },
        {
          key: 'subheadline',
          text: getWrappedText('subheadline', editablePoster.subheadline, width, true),
          box: editableLayout.subheadline,
          style: editableStyles.subheadline
        },
        {
          key: 'infoBlock',
          text: getWrappedText(
            'infoBlock',
            `${editablePoster.infoBlock.orgName}\n${editablePoster.infoBlock.details}\n${editablePoster.infoBlock.credits}`,
            width,
            true
          ),
          box: editableLayout.infoBlock,
          style: editableStyles.infoBlock
        }
      ]
    };
    const response = await fetch(`${FONT_PREVIEW_API}/fonts/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.warn('Font layout render failed', response.status);
      return null;
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(blob);
    });
  };

  const buildRenderSignature = () => {
    if (!editablePoster || !editableLayout || !editableStyles) return '';
    return JSON.stringify({
      font: selectedServerFont,
      layout: editableLayout,
      styles: editableStyles,
      wrappedCopy: {
        topBanner: getWrappedText('topBanner', editablePoster.topBanner, null),
        headline: getWrappedText('headline', editablePoster.headline, null),
        subheadline: getWrappedText('subheadline', editablePoster.subheadline, null),
        infoBlock: getWrappedText(
          'infoBlock',
          `${editablePoster.infoBlock.orgName}\n${editablePoster.infoBlock.details}\n${editablePoster.infoBlock.credits}`,
          null
        )
      }
    });
  };

  const renderServerLayoutPreview = async () => {
    if (!noTextRef.current) return null;
    let rect = noTextContainRect
      ? { width: noTextContainRect.width, height: noTextContainRect.height }
      : null;
    if (!rect && noTextImageSize) {
      const container = noTextRef.current.getBoundingClientRect();
      const containerRatio = container.width / container.height;
      const imageRatio = noTextImageSize.width / noTextImageSize.height;
      let width = container.width;
      let height = container.height;
      if (imageRatio > containerRatio) {
        height = container.width / imageRatio;
      } else {
        width = container.height * imageRatio;
      }
      rect = { width, height };
    }
    if (!rect) {
      const fallback = noTextRef.current.getBoundingClientRect();
      rect = { width: fallback.width, height: fallback.height };
    }
    if (!rect.width || !rect.height) return null;
    return await requestServerLayoutImage(Math.round(rect.width), Math.round(rect.height));
  };

  const refreshRenderedLayout = async () => {
    if (!selectedServerFont) return null;
    setIsRenderingLayout(true);
    try {
      const layoutUrl = await renderServerLayoutPreview();
      if (layoutUrl) {
        setRenderedLayoutUrl(layoutUrl);
        setShowRenderedLayout(true);
        lastRenderedSignatureRef.current = buildRenderSignature();
      }
      return layoutUrl;
    } catch (err) {
      console.warn('Failed to refresh rendered layout', err);
      return null;
    } finally {
      setIsRenderingLayout(false);
    }
  };

  const commitTextEdits = async () => {
    const signature = buildRenderSignature();
    if (!signature || !selectedServerFont) {
      setShowTextBoxes(true);
      setShowRenderedLayout(false);
      setSelectedTextKey(null);
      return;
    }
    if (signature !== lastRenderedSignatureRef.current) {
      await refreshRenderedLayout();
    }
    setShowRenderedLayout(true);
    setShowTextBoxes(false);
    setSelectedTextKey(null);
  };

  const commitRenderedEdits = async () => {
    const signature = buildRenderSignature();
    if (!signature || !selectedServerFont) {
      setShowTextBoxes(true);
      setShowRenderedLayout(false);
      setSelectedTextKey(null);
      return;
    }
    if (signature !== lastRenderedSignatureRef.current) {
      await refreshRenderedLayout();
    }
    setShowRenderedLayout(true);
    setShowTextBoxes(false);
    setSelectedTextKey(null);
  };

  const buildTextLayoutImageUrl = async () => {
    if (!editablePoster || !editableLayout || !editableStyles || !noTextRef.current) return null;
    let width = 0;
    let height = 0;
    if (activePoster?.imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const imgLoaded = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load original image.'));
      });
      img.src = activePoster.imageUrl;
      try {
        const loaded = await imgLoaded;
        width = loaded.naturalWidth;
        height = loaded.naturalHeight;
      } catch (err) {
        console.warn('Failed to resolve original image size', err);
      }
    }
    const containerRect = noTextRef.current.getBoundingClientRect();
    let previewWidth = containerRect.width;
    let previewHeight = containerRect.height;

    if (noTextContainRect) {
      previewWidth = noTextContainRect.width;
      previewHeight = noTextContainRect.height;
    } else if (noTextImageSize) {
      const containerRatio = containerRect.width / containerRect.height;
      const imageRatio = noTextImageSize.width / noTextImageSize.height;
      let containedWidth = containerRect.width;
      let containedHeight = containerRect.height;
      if (imageRatio > containerRatio) {
        containedHeight = containerRect.width / imageRatio;
      } else {
        containedWidth = containerRect.height * imageRatio;
      }
      previewWidth = containedWidth;
      previewHeight = containedHeight;
    }

    previewWidth = Math.round(previewWidth);
    previewHeight = Math.round(previewHeight);
    if (!width || !height) {
      width = previewWidth;
      height = previewHeight;
    }
    if (width <= 0 || height <= 0 || previewWidth <= 0 || previewHeight <= 0) return null;
    const scale = width / previewWidth;

    const compositeOnBlack = async (srcUrl: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const imgLoaded = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load layout image.'));
      });
      img.src = srcUrl;
      const loaded = await imgLoaded;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(loaded, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    };

    if (renderedLayoutUrl) {
      try {
        const composited = await compositeOnBlack(renderedLayoutUrl);
        if (composited) return composited;
      } catch (err) {
        console.warn('Failed to composite rendered layout on black background', err);
      }
    }

    if (selectedServerFont) {
      const serverUrl = await requestServerLayoutImage(width, height);
      if (serverUrl) {
        try {
          const composited = await compositeOnBlack(serverUrl);
          if (composited) return composited;
        } catch (err) {
          console.warn('Failed to composite server layout on black background', err);
          return serverUrl;
        }
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'top';

    const drawBlock = (key: keyof TextLayout, text: string) => {
      const box = editableLayout[key];
      const style = editableStyles[key];
      const x = box.x * width;
      const y = box.y * height;
      const w = box.width * width;
      const h = box.height * height;
      const scaledFontSize = Math.max(1, Math.round(style.fontSize * scale));
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${scaledFontSize}px serif`;
      ctx.fillStyle = style.color;
      const lineHeight = scaledFontSize * 1.2;
      drawWrappedText(
        ctx,
        text,
        x,
        y,
        w,
        h,
        lineHeight,
        style.textDecoration === 'underline',
        style.textAlign || 'left'
      );
    };

    drawBlock('topBanner', editablePoster.topBanner);
    drawBlock('headline', editablePoster.headline);
    drawBlock('subheadline', editablePoster.subheadline);
    drawBlock(
      'infoBlock',
      `${editablePoster.infoBlock.orgName}\n${editablePoster.infoBlock.details}\n${editablePoster.infoBlock.credits}`
    );

    return canvas.toDataURL('image/png');
  };

  const downloadTextLayoutImage = async () => {
    const dataUrl = await buildTextLayoutImageUrl();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = 'text-layout.png';
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleRenderServerFont = async () => {
    if (!selectedServerFont) return;
    try {
      const layoutUrl = await refreshRenderedLayout();
      if (layoutUrl) {
        setShowTextBoxes(false);
        setSelectedTextKey(null);
      }
    } catch (err) {
      console.warn('Failed to render server font layout', err);
    }
  };

  const handleCombinePoster = async () => {
    if (!activePoster?.imageUrl) return;
    const layoutUrl = await buildTextLayoutImageUrl();
    if (!layoutUrl) return;
    setIsMergingPoster(true);
    try {
      const merged = await generatePosterMergedImage(activePoster.imageUrl, layoutUrl);
      updatePosterArtboard(activePoster.id, (ab) => ({
        ...ab,
        posterData: { ...ab.posterData!, imageUrlMerged: merged, imageUrl: merged }
      }));
    } catch (err) {
      console.error('Failed to combine poster images', err);
    } finally {
      setIsMergingPoster(false);
    }
  };

  const ensureNoTextImage = useCallback(async (posterId: string, posterImageUrl: string) => {
    const existing = artboards.find((ab) => ab.id === posterId)?.posterData?.imageUrlNoText;
    if (existing) return existing;
    setNoTextLoadingId(posterId);
    try {
      const noTextUrl = await generatePosterNoTextImage(posterImageUrl);
      updatePosterArtboard(posterId, (ab) => ({
        ...ab,
        posterData: {
          ...ab.posterData!,
          imageUrlNoText: noTextUrl
        }
      }));
      return noTextUrl;
    } catch (err) {
      console.warn('Failed to lazily generate no-text poster image', err);
      return null;
    } finally {
      setNoTextLoadingId((prev) => (prev === posterId ? null : prev));
    }
  }, [artboards, updatePosterArtboard]);

  const handleNavigate = useCallback((path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, '', path);
    syncRouteState(path);
  }, [syncRouteState]);

  const handleLogout = async () => {
    await logoutUser();
    setAuthUser(null);
    setProjects([]);
    setActiveProjectId(null);
    setMustChangePassword(false);
    handleNavigate('/');
  };

  const handleCopyAdminCredentials = async () => {
    if (!adminGeneratedUser) return;
    const text = `username: ${adminGeneratedUser.username}\npassword: ${adminGeneratedUser.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setAdminCopyStatus('copied');
      window.setTimeout(() => setAdminCopyStatus('idle'), 1200);
    } catch {
      setAdminCopyStatus('idle');
    }
  };

  const handleAdminRegister = async () => {
    const username = adminUsernameInput.trim();
    if (!username) {
      setAdminRegisterError('Username is required');
      return;
    }
    setAdminRegisterError('');
    setAdminGeneratedUser(null);
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/admin/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to create account';
        throw new Error(message);
      }
      setAdminGeneratedUser({ username: data.username, password: data.password });
      setAdminUsernameInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account';
      setAdminRegisterError(message);
    }
  };

  const handlePasswordChange = async () => {
    if (passwordChangeLoading) return;
    const current = passwordChangeForm.current.trim();
    const next = passwordChangeForm.next.trim();
    const confirm = passwordChangeForm.confirm.trim();
    if (!current || !next) {
      setPasswordChangeError('Please enter your current and new password');
      return;
    }
    if (next !== confirm) {
      setPasswordChangeError('Passwords do not match');
      return;
    }
    setPasswordChangeError('');
    setPasswordChangeLoading(true);
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to update password';
        throw new Error(message);
      }
      setMustChangePassword(false);
      setPasswordChangeForm({ current: '', next: '', confirm: '' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update password';
      setPasswordChangeError(message);
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  const handleCanvasImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image.'));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.onload = () => {
      addUploadedPosterArtboard(dataUrl, image.width, image.height);
    };
    image.src = dataUrl;
    event.target.value = '';
  };

  const handleClosePosterModal = () => {
    setIsPosterModalClosing(true);
    setTimeout(() => {
      setIsPosterModalOpen(false);
      setIsPosterModalClosing(false);
    }, 180);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1) {
      if (e.ctrlKey) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const startX = (e.clientX - rect.left - viewOffset.x) / zoom;
        const startY = (e.clientY - rect.top - viewOffset.y) / zoom;
        marqueeStart.current = { x: startX, y: startY };
        setMarqueeRect({ x: startX, y: startY, width: 0, height: 0 });
        setIsMarqueeSelecting(true);
        return;
      }
      setIsPanning(true);
      panStart.current = { x: e.clientX - viewOffset.x, y: e.clientY - viewOffset.y };
      setSelection({ artboardId: null, assetId: null });
      setCanvasSelectionId(null);
      setMultiSelectedArtboards([]);
      setMultiSelectedCanvasAssets([]);
    }
  };

  const handleCanvasWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const zoomIntensity = 0.0015;
    const wheelDelta = -e.deltaY;
    const zoomFactor = 1 + wheelDelta * zoomIntensity;
    const nextZoom = Math.min(2, Math.max(0.4, zoom * zoomFactor));

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - viewOffset.x) / zoom;
    const worldY = (mouseY - viewOffset.y) / zoom;

    const nextOffsetX = mouseX - worldX * nextZoom;
    const nextOffsetY = mouseY - worldY * nextZoom;

    setZoom(nextZoom);
    setViewOffset({ x: nextOffsetX, y: nextOffsetY });
  }, [zoom, viewOffset]);

  const handleCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldX = (e.clientX - rect.left - viewOffset.x) / zoom;
    const worldY = (e.clientY - rect.top - viewOffset.y) / zoom;
    const menuWidth = 144;
    const menuHeight = 48;
    const padding = 8;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - padding);
    setCanvasContextMenu({
      x: Math.max(padding, x),
      y: Math.max(padding, y),
      worldX,
      worldY
    });
  };

  const fetchProjectFileUrls = useCallback(async () => {
    if (!activeProjectId) return;
    setGalleryLoading(true);
    setGalleryError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/files/list/${activeProjectId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load files';
        throw new Error(message);
      }
      const files = Array.isArray(data?.files) ? data.files : [];
      const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
      const urls = files
        .filter((name: string) => {
          const ext = name.split('.').pop()?.toLowerCase() || '';
          return imageExts.has(ext);
        })
        .map((name: string) => `${BACKEND_API}/files/${activeProjectId}/${name}`);
      setGalleryFileUrls(urls);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load files';
      setGalleryError(message);
    } finally {
      setGalleryLoading(false);
    }
  }, [activeProjectId]);

  const loadReferenceStyles = useCallback(async () => {
    if (!authUser) {
      setReferenceStyles([]);
      return;
    }
    setReferenceStylesLoading(true);
    setReferenceStylesError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/reference-styles`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load reference styles';
        throw new Error(message);
      }
      setReferenceStyles(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load reference styles';
      setReferenceStylesError(message);
    } finally {
      setReferenceStylesLoading(false);
    }
  }, [authUser]);

  const loadLogoAssets = useCallback(async () => {
    if (!authUser) {
      setLogoAssets([]);
      return;
    }
    setLogoAssetsLoading(true);
    setLogoAssetsError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/logos`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load logos';
        throw new Error(message);
      }
      setLogoAssets(Array.isArray(data.logos) ? data.logos : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load logos';
      setLogoAssetsError(message);
    } finally {
      setLogoAssetsLoading(false);
    }
  }, [authUser]);

  const loadFontReferences = useCallback(async () => {
    if (!authUser) {
      setFontReferences([]);
      return;
    }
    setFontReferencesLoading(true);
    setFontReferencesError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/font-references`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load font references';
        throw new Error(message);
      }
      setFontReferences(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load font references';
      setFontReferencesError(message);
    } finally {
      setFontReferencesLoading(false);
    }
  }, [authUser]);

  const handleUploadReferenceStyle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReferenceStylesError('');
    setIsReferenceUploading(true);
    setReferenceUploadProgress(0);
    try {
      const url = `${BACKEND_API}/reference-styles/upload`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        const token = getAccessToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.withCredentials = true;
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload reference style';
      setReferenceStylesError(message);
    } finally {
      setIsReferenceUploading(false);
      setReferenceUploadProgress(null);
      event.target.value = '';
    }
  };

  const handleUploadLogoAsset = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoAssetsError('');
    setIsLogoUploading(true);
    setLogoUploadProgress(0);
    try {
      const url = `${BACKEND_API}/logos/upload`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        const token = getAccessToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.withCredentials = true;
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
            setLogoUploadProgress(percent);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            const message = typeof data?.detail === 'string' ? data.detail : 'Failed to upload logo';
            reject(new Error(message));
          } catch (parseError) {
            reject(parseError);
          }
        };
        xhr.onerror = () => reject(new Error('Failed to upload logo'));
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
      await loadLogoAssets();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload logo';
      setLogoAssetsError(message);
    } finally {
      setIsLogoUploading(false);
      setLogoUploadProgress(null);
      event.target.value = '';
    }
  };

  const handleUploadFontReference = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFontReferencesError('');
    setIsFontReferenceUploading(true);
    setFontReferenceUploadProgress(0);
    try {
      const url = `${BACKEND_API}/font-references/upload`;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        const token = getAccessToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        xhr.withCredentials = true;
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const percent = Math.round((evt.loaded / evt.total) * 100);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload font reference';
      setFontReferencesError(message);
    } finally {
      setIsFontReferenceUploading(false);
      setFontReferenceUploadProgress(null);
      event.target.value = '';
    }
  };


  useEffect(() => {
    if (rightPanelMode === 'gallery') {
      setGalleryVisibleCount(10);
      void fetchProjectFileUrls();
    }
  }, [rightPanelMode, fetchProjectFileUrls]);

  useEffect(() => {
    if (rightPanelMode !== 'generator') return;
    if (referenceStylesLoading) return;
    if (referenceStyles.length > 0) return;
    void loadReferenceStyles();
  }, [rightPanelMode, loadReferenceStyles, referenceStyles.length, referenceStylesLoading]);

  useEffect(() => {
    if (rightPanelMode !== 'generator') return;
    if (logoAssetsLoading) return;
    if (logoAssets.length > 0) return;
    void loadLogoAssets();
  }, [rightPanelMode, loadLogoAssets, logoAssets.length, logoAssetsLoading]);

  useEffect(() => {
    if (rightPanelMode !== 'generator') return;
    if (fontReferencesLoading) return;
    if (fontReferences.length > 0) return;
    void loadFontReferences();
  }, [rightPanelMode, loadFontReferences, fontReferences.length, fontReferencesLoading]);

  const handleRemoveStyleImage = (index: number) => {
    setStyleImages(prev => prev.filter((_, i) => i !== index));
    setSelectedReferenceStyleId(null);
  };

  const handleRemoveLogo = () => {
    setLogoImage(null);
    setSelectedLogoAssetId(null);
  };

  const handleFontReferenceChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read font reference image.'));
      reader.readAsDataURL(file);
    });
    setFontReferenceImage(dataUrl);
    setSelectedServerFont('');
    event.target.value = '';
  };

  const handleRemoveFontReferenceImage = () => {
    setFontReferenceImage(null);
  };

  const handlePlaygroundImagesChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    setPlaygroundError('');
    try {
      const dataUrls = await Promise.all(
        files.map((file) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Failed to read reference image.'));
          reader.readAsDataURL(file);
        }))
      );
      setPlaygroundImages((prev) => [...prev, ...dataUrls]);
    } catch (err) {
      setPlaygroundError(err instanceof Error ? err.message : 'Failed to read reference image.');
    } finally {
      event.target.value = '';
    }
  };

  const handleRemovePlaygroundImage = (index: number) => {
    setPlaygroundImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRunPlayground = async () => {
    if (!playgroundPrompt.trim()) {
      setPlaygroundError('Prompt is required.');
      return;
    }
    setPlaygroundLoading(true);
    setPlaygroundError('');
    try {
      const imageUrl = await generateImageFromPrompt(playgroundPrompt, playgroundImages);
      setPlaygroundResult(imageUrl);
    } catch (err) {
      setPlaygroundError(err instanceof Error ? err.message : 'Failed to generate image.');
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const buildAlphabetPreviewUrl = (fontName: string) => {
    const params = new URLSearchParams({
      font: fontName,
      text: FONT_ALPHABET_PREVIEW_TEXT,
      size: '96',
      width: '1400',
      height: '700',
      padding: '44',
      color: '#0f172a',
      background: '#ffffff'
    });
    return `${FONT_PREVIEW_API}/fonts/preview?${params.toString()}`;
  };

  const fetchImageAsDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image as data URL.'));
      reader.readAsDataURL(blob);
    });
  };

  const fetchAuthedImageAsDataUrl = async (url: string): Promise<string> => {
    const response = await fetchWithAuth(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read image as data URL.'));
      reader.readAsDataURL(blob);
    });
  };

  const buildAlphabetPreviewDataUrl = async (fontName: string): Promise<string | null> => {
    try {
      const previewUrl = buildAlphabetPreviewUrl(fontName);
      const dataUrl = await fetchImageAsDataUrl(previewUrl);
      return dataUrl.startsWith('data:image/') ? dataUrl : null;
    } catch (err) {
      console.warn('Failed to convert font preview to data URL', err);
      return null;
    }
  };

  const resolveFontReferenceUrl = async (
    fontImage: string | null,
    fontName: string
  ): Promise<string | null> => {
    if (fontImage) {
      if (fontImage.startsWith('data:image/')) return fontImage;
      try {
        const dataUrl = await fetchImageAsDataUrl(fontImage);
        return dataUrl.startsWith('data:image/') ? dataUrl : null;
      } catch (err) {
        console.warn('Failed to convert font reference to data URL', err);
        return null;
      }
    }
    if (!fontName) return null;
    return await buildAlphabetPreviewDataUrl(fontName);
  };

  const handleSelectReferenceStyle = async (item: ReferenceStyleItem) => {
    if (selectedReferenceStyleId === item.id) {
      setStyleImages([]);
      setSelectedReferenceStyleId(null);
      return;
    }
    setReferenceSelectLoadingId(item.id);
    setReferenceStylesError('');
    try {
      const url = `${BACKEND_API}/reference/${item.file_path}`;
      const dataUrl = await fetchAuthedImageAsDataUrl(url);
      setStyleImages([dataUrl]);
      setSelectedReferenceStyleId(item.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load reference style';
      setReferenceStylesError(message);
    } finally {
      setReferenceSelectLoadingId(null);
    }
  };

  const handleSelectFontReference = async (item: FontReferenceItem) => {
    if (selectedFontReferenceId === item.id) {
      setFontReferenceImage(null);
      setSelectedFontReferenceId(null);
      return;
    }
    setFontReferenceSelectLoadingId(item.id);
    setFontReferencesError('');
    try {
      const url = `${BACKEND_API}/font-reference/${item.file_path}`;
      const dataUrl = await fetchAuthedImageAsDataUrl(url);
      setFontReferenceImage(dataUrl);
      setSelectedFontReferenceId(item.id);
      setSelectedServerFont('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load font reference';
      setFontReferencesError(message);
    } finally {
      setFontReferenceSelectLoadingId(null);
    }
  };

  const handleClearFontReference = () => {
    setFontReferenceImage(null);
    setSelectedFontReferenceId(null);
  };

  const updateScrollIndicators = useCallback(
    (
      ref: React.RefObject<HTMLDivElement>,
      setCanLeft: React.Dispatch<React.SetStateAction<boolean>>,
      setCanRight: React.Dispatch<React.SetStateAction<boolean>>
    ) => {
      const node = ref.current;
      if (!node) return;
      const maxLeft = node.scrollWidth - node.clientWidth;
      const left = node.scrollLeft;
      setCanLeft(left > 2);
      setCanRight(left < maxLeft - 2);
    },
    []
  );

  const scrollRow = (ref: React.RefObject<HTMLDivElement>, direction: 'left' | 'right') => {
    const node = ref.current;
    if (!node) return;
    const step = Math.max(180, Math.round(node.clientWidth * 0.8));
    node.scrollBy({ left: direction === 'left' ? -step : step, behavior: 'smooth' });
  };

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      updateScrollIndicators(referenceStylesScrollRef, setRefStylesCanLeft, setRefStylesCanRight);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [referenceStyles.length, updateScrollIndicators]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      updateScrollIndicators(logoAssetsScrollRef, setLogosCanLeft, setLogosCanRight);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [logoAssets.length, updateScrollIndicators]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      updateScrollIndicators(fontReferencesScrollRef, setFontRefsCanLeft, setFontRefsCanRight);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [fontReferences.length, updateScrollIndicators]);

  const handleSelectLogoAsset = async (item: LogoItem) => {
    if (selectedLogoAssetId === item.filename) {
      handleRemoveLogo();
      return;
    }
    setLogoSelectLoadingId(item.filename);
    setLogoAssetsError('');
    try {
      const url = `${BACKEND_API}${item.webp}`;
      const dataUrl = await fetchAuthedImageAsDataUrl(url);
      setLogoImage(dataUrl);
      setSelectedLogoAssetId(item.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load logo asset';
      setLogoAssetsError(message);
    } finally {
      setLogoSelectLoadingId(null);
    }
  };

  const handleGeneratorFontChange = (fontName: string) => {
    setSelectedServerFont(fontName);
    if (fontName) {
      setFontReferenceImage(null);
      setSelectedFontReferenceId(null);
    }
    setRenderedLayoutUrl(null);
    setShowRenderedLayout(false);
    lastRenderedSignatureRef.current = '';
    if (showNoTextEdit && showRenderedLayout && fontName) {
      setPendingRenderCommit(true);
    }
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning) {
      setViewOffset({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y
      });
    }
  }, [isPanning]);

  const handleGlobalMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  useEffect(() => {
    if (!isMarqueeSelecting) return;
    const handleMove = (event: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const start = marqueeStart.current;
      if (!rect || !start) return;
      const currentX = (event.clientX - rect.left - viewOffset.x) / zoom;
      const currentY = (event.clientY - rect.top - viewOffset.y) / zoom;
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);
      setMarqueeRect({ x, y, width, height });
    };
    const handleUp = (event: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const start = marqueeStart.current;
      if (!rect || !start || !marqueeRect) {
        setIsMarqueeSelecting(false);
        setMarqueeRect(null);
        marqueeStart.current = null;
        return;
      }
      const currentX = (event.clientX - rect.left - viewOffset.x) / zoom;
      const currentY = (event.clientY - rect.top - viewOffset.y) / zoom;
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);
      const bounds = { left: x, top: y, right: x + width, bottom: y + height };

      const hitsArtboards = artboards
        .filter(ab => !(ab.x + ab.width < bounds.left || ab.x > bounds.right || ab.y + ab.height < bounds.top || ab.y > bounds.bottom))
        .map(ab => ab.id);
      const hitsCanvasAssets = canvasAssets
        .filter(asset => !(asset.x + asset.width < bounds.left || asset.x > bounds.right || asset.y + asset.height < bounds.top || asset.y > bounds.bottom))
        .map(asset => asset.id);

      setMultiSelectedArtboards(hitsArtboards);
      setMultiSelectedCanvasAssets(hitsCanvasAssets);
      setSelection({ artboardId: null, assetId: null });
      setCanvasSelectionId(null);
      setIsMarqueeSelecting(false);
      setMarqueeRect(null);
      marqueeStart.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isMarqueeSelecting, artboards, canvasAssets, viewOffset, zoom, marqueeRect]);

  const getViewCenterWorld = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    return {
      x: (centerX - viewOffsetRef.current.x) / zoom,
      y: (centerY - viewOffsetRef.current.y) / zoom
    };
  }, [zoom]);

  const smoothPanToWorld = useCallback((worldX: number, worldY: number, duration = 800) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = {
      x: rect.width / 2 - worldX * zoom,
      y: rect.height / 2 - worldY * zoom
    };
    const start = performance.now();
    const from = { ...viewOffsetRef.current };

    if (viewAnimationRef.current) {
      cancelAnimationFrame(viewAnimationRef.current);
    }

    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      const eased = easeInOut(progress);
      setViewOffset({
        x: from.x + (target.x - from.x) * eased,
        y: from.y + (target.y - from.y) * eased
      });
      if (progress < 1) {
        viewAnimationRef.current = requestAnimationFrame(step);
      }
    };

    viewAnimationRef.current = requestAnimationFrame(step);
  }, [zoom]);

  const addArtboard = useCallback(() => {
    const targetX = 400 - viewOffset.x / zoom;
    const targetY = 200 - viewOffset.y / zoom;
    const clamped = clampPosition(targetX, targetY, boardWidth, boardHeight);
    const newArtboard: Artboard = {
      id: generateId(),
      name: `Design ${artboards.length + 1}`,
      x: clamped.x,
      y: clamped.y,
      width: boardWidth,
      height: boardHeight,
      assets: []
    };
    setArtboards(prev => [...prev, newArtboard]);
  }, [artboards.length, viewOffset, zoom, boardWidth, boardHeight]);

  const handleDragArtboard = useCallback((artboardId: string, dx: number, dy: number) => {
    setArtboards(prev => prev.map(ab =>
      ab.id === artboardId
        ? {
          ...ab,
          ...clampPosition(ab.x + dx, ab.y + dy, ab.width, ab.height)
        }
        : ab
    ));
  }, []);

  const handleResizeArtboard = useCallback((artboardId: string, dw: number, dh: number) => {
    setArtboards(prev => prev.map(ab => {
      if (ab.id !== artboardId) return ab;
      const minSize = 160;
      const baseWidth = Math.max(1, ab.width);
      const baseHeight = Math.max(1, ab.height);
      const scale = Math.max(
        (baseWidth + dw) / baseWidth,
        (baseHeight + dh) / baseHeight
      );
      const nextWidth = Math.max(minSize, baseWidth * scale);
      const nextHeight = Math.max(minSize, baseHeight * scale);
      const clamped = clampPosition(ab.x, ab.y, nextWidth, nextHeight);
      return {
        ...ab,
        ...clamped,
        width: nextWidth,
        height: nextHeight
      };
    }));
  }, []);

  const addAsset = useCallback((type: AssetType, artboardId: string) => {
    const newAsset: Asset = {
      id: generateId(),
      type,
      x: 40,
      y: 100,
      width: type === 'text' ? 240 : 200,
      height: type === 'text' ? 60 : 200,
      content: type === 'text' ? 'Enter headline...' : '',
      fontSize: type === 'text' ? 20 : undefined,
      color: type === 'text' ? '#0f172a' : undefined,
      fontWeight: type === 'text' ? '600' : undefined,
      zIndex: 20
    };
    setArtboards(prev => prev.map(ab =>
      ab.id === artboardId ? { ...ab, assets: [...ab.assets, newAsset] } : ab
    ));
    setSelection({ artboardId, assetId: newAsset.id });
  }, []);

  const addImageAsset = useCallback((artboardId: string, content: string, width: number, height: number) => {
    const newAsset: Asset = {
      id: generateId(),
      type: 'image',
      x: 40,
      y: 100,
      width,
      height,
      content,
      zIndex: 20
    };
    setArtboards(prev => prev.map(ab =>
      ab.id === artboardId ? { ...ab, assets: [...ab.assets, newAsset] } : ab
    ));
    setSelection({ artboardId, assetId: newAsset.id });
  }, []);

  const addCanvasImageAsset = useCallback((content: string, width: number, height: number) => {
    const viewCenter = getViewCenterWorld();
    const id = generateId();
    const newAsset: Asset = {
      id,
      type: 'image',
      x: viewCenter.x - width / 2,
      y: viewCenter.y - height / 2,
      width,
      height,
      content,
      zIndex: 20
    };
    setCanvasAssets(prev => [...prev, newAsset]);
    setCanvasSelectionId(id);
    setSelection({ artboardId: null, assetId: null });
    triggerCanvasAssetFadeIn(id);
    return id;
  }, [getViewCenterWorld, triggerCanvasAssetFadeIn]);

  const handleGalleryImageClick = useCallback((url: string) => {
    const image = new Image();
    image.onload = () => {
      const rawWidth = image.width || image.naturalWidth || 200;
      const rawHeight = image.height || image.naturalHeight || 200;
      addUploadedPosterArtboard(url, rawWidth, rawHeight);
      setRightPanelMode('generator');
    };
    image.onerror = () => {
      console.warn('Failed to load gallery image');
    };
    image.src = url;
  }, [addCanvasImageAsset]);

  const addCanvasNoteAssetAt = useCallback((x: number, y: number) => {
    const width = 240;
    const height = 180;
    const clamped = clampPosition(x - width / 2, y - height / 2, width, height);
    const newAsset: Asset = {
      id: generateId(),
      type: 'note',
      x: clamped.x,
      y: clamped.y,
      width,
      height,
      content: 'Note\nNotes...',
      zIndex: 20
    };
    setCanvasAssets(prev => [...prev, newAsset]);
    setCanvasSelectionId(newAsset.id);
    setSelection({ artboardId: null, assetId: null });
    setMultiSelectedCanvasAssets([]);
    setMultiSelectedArtboards([]);
  }, []);

  const addUploadedPosterArtboard = useCallback((imageUrl: string, naturalWidth: number, naturalHeight: number) => {
    const viewCenter = getViewCenterWorld();
    const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : boardWidth / boardHeight;
    let width = boardWidth;
    let height = Math.round(width / aspect);
    if (height > boardHeight * 1.4) {
      height = boardHeight;
      width = Math.round(height * aspect);
    }
    const position = clampPosition(viewCenter.x - width / 2, viewCenter.y - height / 2, width, height);
    const id = generateUUID();
    const posterData: PosterDraft = {
      id,
      topBanner: '',
      headline: 'Uploaded Poster',
      subheadline: '',
      infoBlock: { orgName: '', details: '', credits: '' },
      accentColor: '#111827',
      visualPrompt: '',
      imageUrl,
      imageUrlMerged: imageUrl,
      textLayout: buildDefaultTextLayout(),
      status: 'completed'
    };
    const newArtboard: Artboard = {
      id,
      name: 'Uploaded Poster',
      x: position.x,
      y: position.y,
      width,
      height,
      assets: [],
      posterData
    };
    setArtboards((prev) => [...prev, newArtboard]);
    setSelection({ artboardId: id, assetId: null });
    setActivePosterId(id);
    triggerArtboardFadeIn([id]);
  }, [boardWidth, boardHeight, getViewCenterWorld, triggerArtboardFadeIn]);

  const handleDragAsset = useCallback((artboardId: string, assetId: string, dx: number, dy: number) => {
    setArtboards(prev => prev.map(ab => {
      if (ab.id !== artboardId) return ab;
      return {
        ...ab,
        assets: ab.assets.map(asset =>
          asset.id === assetId ? { ...asset, x: asset.x + dx, y: asset.y + dy } : asset
        )
      };
    }));
  }, []);

  const handleResizeAsset = useCallback((artboardId: string, assetId: string, dw: number, dh: number) => {
    setArtboards(prev => prev.map(ab => {
      if (ab.id !== artboardId) return ab;
      return {
        ...ab,
        assets: ab.assets.map(asset =>
          asset.id === assetId
            ? {
              ...asset,
              width: Math.max(20, asset.width + dw),
              height: Math.max(20, asset.height + dh)
            }
            : asset
        )
      };
    }));
  }, []);

  const updateAssetContent = useCallback((artboardId: string, assetId: string, content: string) => {
    setArtboards(prev => prev.map(ab => {
      if (ab.id !== artboardId) return ab;
      return {
        ...ab,
        assets: ab.assets.map(asset =>
          asset.id === assetId ? { ...asset, content } : asset
        )
      };
    }));
  }, []);

  const handleDragCanvasAsset = useCallback((assetId: string, dx: number, dy: number) => {
    setCanvasAssets(prev => {
      const draggedAsset = prev.find(a => a.id === assetId);
      if (!draggedAsset) return prev;

      // Check if dragging a group background
      const isGroupBg = draggedAsset.id.startsWith('group-bg-');

      if (isGroupBg) {
        // Find all assets that overlap with this group background
        const groupBounds = {
          left: draggedAsset.x,
          top: draggedAsset.y,
          right: draggedAsset.x + draggedAsset.width,
          bottom: draggedAsset.y + draggedAsset.height
        };

        // Helper to check if an asset overlaps with the group bounds
        const isInsideGroup = (asset: Asset) => {
          if (asset.id === draggedAsset.id) return true; // The group itself
          if (asset.id.startsWith('group-bg-')) return false; // Don't include other groups

          const assetBounds = {
            left: asset.x,
            top: asset.y,
            right: asset.x + asset.width,
            bottom: asset.y + asset.height
          };

          // Check if there's any overlap (asset touches the group)
          return !(assetBounds.right < groupBounds.left ||
                   assetBounds.left > groupBounds.right ||
                   assetBounds.bottom < groupBounds.top ||
                   assetBounds.top > groupBounds.bottom);
        };

        const groupAssets = prev.filter(isInsideGroup);
        const groupMinX = Math.min(...groupAssets.map(asset => asset.x));
        const groupMinY = Math.min(...groupAssets.map(asset => asset.y));
        const groupMaxX = Math.max(...groupAssets.map(asset => asset.x + asset.width));
        const groupMaxY = Math.max(...groupAssets.map(asset => asset.y + asset.height));

        const clampedDx = clampValue(dx, BOARD_BOUNDS.minX - groupMinX, BOARD_BOUNDS.maxX - groupMaxX);
        const clampedDy = clampValue(dy, BOARD_BOUNDS.minY - groupMinY, BOARD_BOUNDS.maxY - groupMaxY);

        return prev.map(asset =>
          isInsideGroup(asset)
            ? { ...asset, x: asset.x + clampedDx, y: asset.y + clampedDy }
            : asset
        );
      }

      // For non-group assets, just move the single asset
      return prev.map(asset =>
        asset.id === assetId
          ? {
            ...asset,
            ...clampPosition(asset.x + dx, asset.y + dy, asset.width, asset.height)
          }
          : asset
      );
    });
  }, []);

  const handleResizeCanvasAsset = useCallback((assetId: string, dw: number, dh: number) => {
    setCanvasAssets(prev => prev.map(asset =>
      asset.id === assetId
        ? {
          ...asset,
          width: Math.min(Math.max(60, asset.width + dw), BOARD_BOUNDS.maxX - asset.x),
          height: Math.min(Math.max(40, asset.height + dh), BOARD_BOUNDS.maxY - asset.y)
        }
        : asset
    ));
  }, []);

  const updateCanvasAssetContent = useCallback((assetId: string, content: string) => {
    setCanvasAssets(prev => prev.map(asset =>
      asset.id === assetId ? { ...asset, content } : asset
    ));
  }, []);

  const deleteCanvasAsset = useCallback((assetId: string) => {
    setCanvasAssets(prev => prev.filter(a => a.id !== assetId));
    setConnections(prev => prev.filter(c => c.fromId !== assetId && c.toId !== assetId));
  }, []);

  const handleOpenAssetContextMenu = (
    event: React.MouseEvent,
    scope: 'artboard' | 'canvas' | 'poster',
    assetId: string,
    artboardId?: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 176;
    const menuHeight = 84;
    const padding = 8;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);
    setAssetContextMenu({ x: Math.max(padding, x), y: Math.max(padding, y), scope, artboardId, assetId });
  };

  const getContextAsset = useCallback(() => {
    if (!assetContextMenu) return null;
    if (assetContextMenu.scope === 'canvas') {
      return canvasAssets.find(asset => asset.id === assetContextMenu.assetId) || null;
    }
    if (assetContextMenu.scope === 'poster') {
      return null;
    }
    const artboard = artboards.find(ab => ab.id === assetContextMenu.artboardId);
    return artboard?.assets.find(asset => asset.id === assetContextMenu.assetId) || null;
  }, [assetContextMenu, canvasAssets, artboards]);

  const getContextPoster = useCallback(() => {
    if (!assetContextMenu || assetContextMenu.scope !== 'poster') return null;
    const artboard = artboards.find(ab => ab.id === assetContextMenu.artboardId);
    if (!artboard?.posterData) return null;
    const imageUrl = artboard.posterData.imageUrlMerged || artboard.posterData.imageUrl;
    return imageUrl ? { id: artboard.id, imageUrl } : null;
  }, [assetContextMenu, artboards]);

  const handleContextDownload = async () => {
    try {
      const poster = getContextPoster();
      if (poster) {
        const ext = extensionFromUrl(poster.imageUrl) || 'png';
        if (poster.imageUrl.startsWith('data:image/')) {
          triggerDownload(poster.imageUrl, `poster-${poster.id}.${ext}`);
        } else {
          const response = await fetch(poster.imageUrl);
          if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          triggerDownload(url, `poster-${poster.id}.${ext}`);
        }
        return;
      }
      const asset = getContextAsset();
      if (!asset) return;
      await downloadAssetContent(asset);
    } catch (err) {
      console.warn('Failed to download asset', err);
    } finally {
      setAssetContextMenu(null);
    }
  };

  const fetchAdminDbTables = useCallback(async () => {
    setAdminDbLoading(true);
    setAdminDbError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/admin/db/tables`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load tables';
        throw new Error(message);
      }
      const tables = Array.isArray(data?.tables) ? data.tables : [];
      setAdminDbTables(tables);
      if (!tables.includes(adminDbTable)) {
        setAdminDbTable(tables[0] || '');
        setAdminDbOffset(0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tables';
      setAdminDbError(message);
    } finally {
      setAdminDbLoading(false);
    }
  }, [adminDbTable]);

  const fetchAdminDbSchema = useCallback(async (table: string) => {
    if (!table) return;
    setAdminDbLoading(true);
    setAdminDbError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/admin/db/schema/${table}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load schema';
        throw new Error(message);
      }
      setAdminDbSchema(data.columns || []);
      setAdminDbPrimaryKey(data.primaryKey || []);
      setAdminDbHasRowid(Boolean(data.hasRowid));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load schema';
      setAdminDbError(message);
    } finally {
      setAdminDbLoading(false);
    }
  }, []);

  const fetchAdminDbRows = useCallback(async (table: string, offset = 0) => {
    if (!table) return;
    setAdminDbLoading(true);
    setAdminDbError('');
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/admin/db/rows/${table}?limit=${ADMIN_DB_LIMIT}&offset=${offset}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to load rows';
        throw new Error(message);
      }
      setAdminDbRows(data.rows || []);
      setAdminDbTotal(data.total || 0);
      setAdminDbOffset(offset);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load rows';
      setAdminDbError(message);
    } finally {
      setAdminDbLoading(false);
    }
  }, []);

  const openAdminDbEditor = (mode: 'add' | 'edit', row?: Record<string, any>) => {
    const values: Record<string, any> = {};
    adminDbSchema.forEach((column) => {
      const rawValue = row ? row[column.name] : '';
      values[column.name] = rawValue ?? '';
    });
    setAdminDbEditorMode(mode);
    setAdminDbEditorValues(values);
    setAdminDbEditorRowId(row && typeof row._rowid === 'number' ? row._rowid : null);
    if (row && adminDbPrimaryKey.length > 0) {
      const pk: Record<string, any> = {};
      adminDbPrimaryKey.forEach((key) => {
        pk[key] = row[key];
      });
      setAdminDbEditorPrimaryKey(pk);
    } else {
      setAdminDbEditorPrimaryKey(null);
    }
    setAdminDbEditorOpen(true);
  };

  const closeAdminDbEditor = () => {
    setAdminDbEditorOpen(false);
    setAdminDbEditorValues({});
    setAdminDbEditorRowId(null);
    setAdminDbEditorPrimaryKey(null);
  };

  const handleAdminDbSave = async () => {
    if (!adminDbTable) return;
    if (adminDbSaving) return;
    setAdminDbSaving(true);
    setAdminDbError('');
    const payload = {
      values: adminDbEditorValues,
      primaryKey: adminDbEditorPrimaryKey,
      rowId: adminDbEditorRowId
    };
    try {
      const response = await fetchWithAuth(`${BACKEND_API}/admin/db/rows/${adminDbTable}`, {
        method: adminDbEditorMode === 'add' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to save row';
        throw new Error(message);
      }
      closeAdminDbEditor();
      await fetchAdminDbRows(adminDbTable, adminDbOffset);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save row';
      setAdminDbError(message);
    } finally {
      setAdminDbSaving(false);
    }
  };

  const handleAdminDbDelete = async (row: Record<string, any>) => {
    if (!adminDbTable) return;
    const confirmed = window.confirm('Delete this row? This cannot be undone.');
    if (!confirmed) return;
    setAdminDbError('');
    try {
      const payload = {
        primaryKey: adminDbPrimaryKey.length > 0
          ? adminDbPrimaryKey.reduce((acc, key) => ({ ...acc, [key]: row[key] }), {})
          : null,
        rowId: typeof row._rowid === 'number' ? row._rowid : null
      };
      const response = await fetchWithAuth(`${BACKEND_API}/admin/db/rows/${adminDbTable}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.detail === 'string' ? data.detail : 'Failed to delete row';
        throw new Error(message);
      }
      await fetchAdminDbRows(adminDbTable, adminDbOffset);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete row';
      setAdminDbError(message);
    }
  };

  const handleContextDelete = () => {
    if (!assetContextMenu) return;
    if (assetContextMenu.scope === 'canvas') {
      deleteCanvasAsset(assetContextMenu.assetId);
      if (canvasSelectionId === assetContextMenu.assetId) {
        setCanvasSelectionId(null);
      }
      setAssetContextMenu(null);
      return;
    }
    if (assetContextMenu.scope === 'poster') {
      setArtboards(prev => prev.filter(ab => ab.id !== assetContextMenu.artboardId));
      setConnections(prev => prev.filter(c => c.fromId !== assetContextMenu.artboardId && c.toId !== assetContextMenu.artboardId));
      if (selection.artboardId === assetContextMenu.artboardId) {
        setSelection({ artboardId: null, assetId: null });
      }
      if (activePosterId === assetContextMenu.artboardId) {
        setActivePosterId(null);
      }
      setAssetContextMenu(null);
      return;
    }
    setArtboards(prev => prev.map(ab =>
      ab.id === assetContextMenu.artboardId
        ? { ...ab, assets: ab.assets.filter(a => a.id !== assetContextMenu.assetId) }
        : ab
    ));
    if (selection.artboardId === assetContextMenu.artboardId && selection.assetId === assetContextMenu.assetId) {
      setSelection({ artboardId: selection.artboardId, assetId: null });
    }
    setAssetContextMenu(null);
  };

  const deleteSelected = useCallback(() => {
    if (canvasSelectionId) {
      const targetAsset = canvasAssets.find(asset => asset.id === canvasSelectionId);
      if (!targetAsset) return;
      if (targetAsset.groupId && targetAsset.id.startsWith('group-bg-')) {
        setCanvasAssets(prev => prev.filter(asset => asset.groupId !== targetAsset.groupId));
        setConnections(prev => prev.filter(conn => conn.groupId !== targetAsset.groupId));
      } else {
        deleteCanvasAsset(canvasSelectionId);
      }
      setCanvasSelectionId(null);
      return;
    }
    if (!selection.artboardId) return;
    if (selection.assetId) {
      setArtboards(prev => prev.map(ab =>
        ab.id === selection.artboardId ? { ...ab, assets: ab.assets.filter(a => a.id !== selection.assetId) } : ab
      ));
      setSelection({ ...selection, assetId: null });
    } else {
      setArtboards(prev => prev.filter(ab => ab.id !== selection.artboardId));
      setSelection({ artboardId: null, assetId: null });
    }
  }, [canvasSelectionId, canvasAssets, selection, deleteCanvasAsset]);

  const applySnapshot = useCallback((snapshot: { artboards: Artboard[]; canvasAssets: Asset[]; connections: Connection[] }) => {
    isRestoringRef.current = true;
    setArtboards(snapshot.artboards);
    setCanvasAssets(snapshot.canvasAssets);
    setConnections(snapshot.connections);
    setSelection({ artboardId: null, assetId: null });
    setCanvasSelectionId(null);
    requestAnimationFrame(() => {
      isRestoringRef.current = false;
    });
  }, []);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current[historyRef.current.length - 1];
    const previous = historyRef.current[historyRef.current.length - 2];
    historyRef.current = historyRef.current.slice(0, -1);
    redoRef.current = [current, ...redoRef.current].slice(0, 50);
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(redoRef.current.length > 0);
    applySnapshot(previous);
  }, [applySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const [next, ...rest] = redoRef.current;
    redoRef.current = rest;
    historyRef.current = [...historyRef.current, next].slice(-50);
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(redoRef.current.length > 0);
    applySnapshot(next);
  }, [applySnapshot]);

  const buildAnnotatedImageDataUrl = useCallback(async (sourceUrl: string) => {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        console.warn('[annotator] failed to fetch source for markup', response.status);
        return null;
      }
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image for markup.'));
        reader.readAsDataURL(blob);
      });
      const baseImage = new Image();
      const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
        baseImage.onload = () => resolve(baseImage);
        baseImage.onerror = () => resolve(null);
        baseImage.src = dataUrl;
      });
      if (!loaded) return null;
      const imageWidth = loaded.naturalWidth || loaded.width;
      const imageHeight = loaded.naturalHeight || loaded.height;
      if (!imageWidth || !imageHeight) return null;
      const canvas = document.createElement('canvas');
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(loaded, 0, 0, imageWidth, imageHeight);
      const colorMap: Record<AnnotationColor, string> = {
        red: '#ef4444',
        green: '#22c55e',
        purple: '#a855f7'
      };
      const lineWidth = Math.max(2, Math.round(imageWidth * 0.003));
      const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: string) => {
        const headLength = Math.max(10, lineWidth * 4);
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      };
      const drawLabel = (label: number, x: number, y: number, color: string) => {
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.max(16, Math.round(imageWidth * 0.018))}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(String(label), x + 6, y + 6);
      };
      annotations.forEach((annotation) => {
        const color = colorMap[annotation.color];
        if (annotation.type === 'rect') {
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
          drawLabel(annotation.id, annotation.x, annotation.y, color);
        } else {
          drawArrow(annotation.x, annotation.y, annotation.x2 ?? annotation.x, annotation.y2 ?? annotation.y, color);
          drawLabel(annotation.id, Math.min(annotation.x, annotation.x2 ?? annotation.x), Math.min(annotation.y, annotation.y2 ?? annotation.y), color);
        }
      });
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.warn('[annotator] failed to build annotated image', error);
      return null;
    }
  }, [annotations]);

  const buildAnnotationPrompt = useCallback(() => {
    const instructions = annotations
      .map((annotation) => {
        const note = (annotationNotes[annotation.id] || '').trim();
        if (!note) return null;
        return `For box ${annotation.id}, ${note}`;
      })
      .filter((value): value is string => Boolean(value));
    return instructions.join(', ');
  }, [annotations, annotationNotes]);

  const getAnnotatorTransform = useCallback(() => {
    if (!annotatorImage || !annotatorSize.width || !annotatorSize.height) return null;
    const imageWidth = annotatorImage.naturalWidth || annotatorImage.width;
    const imageHeight = annotatorImage.naturalHeight || annotatorImage.height;
    if (!imageWidth || !imageHeight) return null;
    const baseScale = Math.min(
      annotatorSize.width / imageWidth,
      annotatorSize.height / imageHeight
    );
    const scale = baseScale * annotationZoom;
    const offsetX = annotationPan.x;
    const offsetY = annotationPan.y;
    const result = { scale, offsetX, offsetY, imageWidth, imageHeight };
    console.log('[annotator] transform', result);
    return result;
  }, [annotatorImage, annotatorSize, annotationZoom, annotationPan]);

  const getImagePointFromEvent = useCallback((event: React.MouseEvent) => {
    const container = annotatorRef.current;
    const transform = getAnnotatorTransform();
    if (!container || !transform || !annotatorImage) return null;
    const rect = container.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = (localX - transform.offsetX) / transform.scale;
    const y = (localY - transform.offsetY) / transform.scale;
    const imageWidth = annotatorImage.naturalWidth || annotatorImage.width;
    const imageHeight = annotatorImage.naturalHeight || annotatorImage.height;
    console.log('[annotator] pointer', { localX, localY, x, y, imageWidth, imageHeight });
    if (x < 0 || y < 0 || x > imageWidth || y > imageHeight) return null;
    return { x, y };
  }, [annotatorImage, getAnnotatorTransform]);

  useEffect(() => {
    const canvas = annotatorCanvasRef.current;
    const transform = getAnnotatorTransform();
    if (!canvas || !annotatorImage || !transform) return;
    const imageWidth = annotatorImage.naturalWidth || annotatorImage.width;
    const imageHeight = annotatorImage.naturalHeight || annotatorImage.height;
    canvas.width = Math.max(1, Math.floor(imageWidth));
    canvas.height = Math.max(1, Math.floor(imageHeight));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    console.log('[annotator] redraw', { canvasWidth: canvas.width, canvasHeight: canvas.height, annotations: annotations.length, hasDraft: Boolean(annotationDraft) });

    const colorMap: Record<AnnotationColor, string> = {
      red: '#ef4444',
      green: '#22c55e',
      purple: '#a855f7'
    };

    const drawArrow = (fromX: number, fromY: number, toX: number, toY: number, color: string) => {
      const headLength = 10;
      const angle = Math.atan2(toY - fromY, toX - fromX);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    };

    const drawLabel = (label: number, x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(String(label), x + 4, y + 4);
    };

    const drawAnnotation = (annotation: Annotation) => {
      const color = colorMap[annotation.color];
      if (annotation.type === 'rect') {
        const x = annotation.x;
        const y = annotation.y;
        const w = annotation.width;
        const h = annotation.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        drawLabel(annotation.id, x, y, color);
      } else {
        const startX = annotation.x;
        const startY = annotation.y;
        const endX = annotation.x2 ?? annotation.x;
        const endY = annotation.y2 ?? annotation.y;
        drawArrow(startX, startY, endX, endY, color);
        drawLabel(annotation.id, Math.min(startX, endX), Math.min(startY, endY), color);
      }
    };

    annotations.forEach(drawAnnotation);
    if (annotationDraft) {
      drawAnnotation(annotationDraft);
    }
  }, [annotatorImage, annotatorSize, annotationZoom, annotations, annotationDraft, getAnnotatorTransform]);

  const handleAnnotatorMouseDown = (event: React.MouseEvent) => {
    console.log('[annotator] mouse down', { tool: annotationTool, loaded: annotatorLoaded, ready: isAnnotatorReady, size: annotatorSize, tick: annotatorReadyTick });
    const ensureReady = () => {
      if (!annotatorImage) return false;
      const transform = getAnnotatorTransform();
      return Boolean(transform && annotatorSize.width > 0 && annotatorSize.height > 0);
    };
    if (!ensureReady()) return;
    if (annotationTool === 'pan') {
      annotationPanStartRef.current = { x: event.clientX, y: event.clientY };
      setIsAnnotating(true);
      return;
    }
    const point = getImagePointFromEvent(event);
    if (!point) {
      console.warn('[annotator] mouse down: no point');
      return;
    }
    annotationStartRef.current = point;
    setIsAnnotating(true);
    setAnnotationDraft({
      id: annotationIdRef.current,
      type: annotationTool,
      color: annotationColor,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      x2: point.x,
      y2: point.y
    });
  };

  const handleAnnotatorMouseMove = (event: React.MouseEvent) => {
    if (!isAnnotatorReady) return;
    if (!isAnnotating) return;
    console.log('[annotator] mouse move', { tool: annotationTool });
    if (annotationTool === 'pan' && annotationPanStartRef.current) {
      const dx = event.clientX - annotationPanStartRef.current.x;
      const dy = event.clientY - annotationPanStartRef.current.y;
      annotationPanStartRef.current = { x: event.clientX, y: event.clientY };
      setAnnotationPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (!annotationStartRef.current || !annotationDraft) return;
    const point = getImagePointFromEvent(event);
    if (!point) return;
    const start = annotationStartRef.current;
    if (annotationDraft.type === 'rect') {
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const width = Math.abs(point.x - start.x);
      const height = Math.abs(point.y - start.y);
      setAnnotationDraft({ ...annotationDraft, x, y, width, height });
    } else {
      setAnnotationDraft({ ...annotationDraft, x2: point.x, y2: point.y, width: 0, height: 0 });
    }
  };

  const handleAnnotatorMouseUp = () => {
    console.log('[annotator] mouse up', { tool: annotationTool, hasDraft: Boolean(annotationDraft), ready: isAnnotatorReady });
    if (annotationTool === 'pan') {
      setIsAnnotating(false);
      annotationPanStartRef.current = null;
      return;
    }
    if (!isAnnotating || !annotationDraft) {
      setIsAnnotating(false);
      annotationStartRef.current = null;
      return;
    }
    const isRect = annotationDraft.type === 'rect';
    const valid =
      isRect
        ? annotationDraft.width > 6 && annotationDraft.height > 6
        : Math.hypot((annotationDraft.x2 ?? annotationDraft.x) - annotationDraft.x, (annotationDraft.y2 ?? annotationDraft.y) - annotationDraft.y) > 6;
    if (valid) {
      const id = annotationIdRef.current;
      annotationIdRef.current += 1;
      const finalized = { ...annotationDraft, id };
      setAnnotations(prev => [...prev, finalized]);
      setAnnotationNotes(prev => ({ ...prev, [id]: '' }));
    }
    setAnnotationDraft(null);
    setIsAnnotating(false);
    annotationStartRef.current = null;
  };

  const handleAnnotationUndo = () => {
    if (annotationHistoryRef.current.length < 2) return;
    const current = annotationHistoryRef.current[annotationHistoryRef.current.length - 1];
    const previous = annotationHistoryRef.current[annotationHistoryRef.current.length - 2];
    annotationHistoryRef.current = annotationHistoryRef.current.slice(0, -1);
    annotationRedoRef.current = [current, ...annotationRedoRef.current].slice(0, 50);
    isAnnotationRestoringRef.current = true;
    setAnnotations(previous);
    requestAnimationFrame(() => {
      isAnnotationRestoringRef.current = false;
    });
  };

  const handleAnnotationRedo = () => {
    if (annotationRedoRef.current.length === 0) return;
    const [next, ...rest] = annotationRedoRef.current;
    annotationRedoRef.current = rest;
    annotationHistoryRef.current = [...annotationHistoryRef.current, next].slice(-50);
    isAnnotationRestoringRef.current = true;
    setAnnotations(next);
    requestAnimationFrame(() => {
      isAnnotationRestoringRef.current = false;
    });
  };

  useEffect(() => {
    if (!isLoadingSuggestions) return;
    const labels = ['Warming Up', 'Brewing Ideas', 'Gathering Sparks', 'Polishing Notions', 'Tuning Vibes', 'Charging Up'];
    let index = 0;
    setIdeaLoadingLabel(labels[index]);
    const intervalId = setInterval(() => {
      index = (index + 1) % labels.length;
      setIdeaLoadingLabel(labels[index]);
    }, 900);
    return () => clearInterval(intervalId);
  }, [isLoadingSuggestions]);

  const handleFetchFeedbackIdeas = async () => {
    if (!activePoster) return;
    if (isLoadingSuggestions) return;
    setIsLoadingSuggestions(true);
    setFeedbackSuggestions([]);
    try {
      const posterImage = activePoster.imageUrlMerged || activePoster.imageUrl || '';
      const prompt = `You are a senior creative director. Analyze the poster image and propose 4-6 concise, imaginative expansion ideas that explore new creative directions (conceptual twists, storytelling beats, visual motifs, alternate compositions).
Return ONLY valid JSON in the format:
{"ideas":["idea 1","idea 2","idea 3","idea 4"]}`;
      const response = await chatWithModel([
        {
          role: 'user',
          content: prompt,
          images: posterImage ? [posterImage] : []
        }
      ]);
      const trimmed = response.trim();
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) as { ideas?: string[] } : null;
      const ideas = parsed?.ideas?.filter(Boolean) ?? [];
      if (ideas.length > 0) {
        setFeedbackSuggestions(ideas);
        setSelectedSuggestions(new Set());
      } else if (trimmed) {
        const parsedIdeas = trimmed.split('\n').map(line => line.replace(/^[\-\*\d\.\s]+/, '').trim()).filter(Boolean);
        setFeedbackSuggestions(parsedIdeas);
        setSelectedSuggestions(new Set());
      }
    } catch (err) {
      console.warn('Failed to fetch feedback ideas', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const createDerivedArtboard = useCallback((
    source: Artboard,
    posterData: PosterDraft,
    overrides?: { width?: number; height?: number; x?: number; y?: number; nameSuffix?: string }
  ) => {
    const derivedId = `derived-${source.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const width = overrides?.width ?? source.width;
    const height = overrides?.height ?? source.height;
    const target = clampPosition(
      overrides?.x ?? (source.x + source.width + ARTBOARD_GAP),
      overrides?.y ?? source.y,
      width,
      height
    );
    const derivedArtboard: Artboard = {
      id: derivedId,
      name: posterData.headline
        ? `${posterData.headline}${overrides?.nameSuffix ? ` (${overrides.nameSuffix})` : ''}`
        : `${source.name} (Derived)`,
      x: target.x,
      y: target.y,
      width,
      height,
      assets: [],
      posterData: {
        ...posterData,
        id: derivedId,
        status: 'generating'
      }
    };
    setArtboards((prev) => [...prev, derivedArtboard]);
    setConnections((prev) => [
      ...prev,
      {
        id: `conn-${source.id}-${derivedId}-${Date.now()}`,
        fromId: source.id,
        fromType: 'artboard',
        toId: derivedId,
        toType: 'artboard',
        groupId: `derive-${source.id}`
      }
    ]);
    return derivedId;
  }, []);

  const handleRefinePoster = async () => {
    if (!activePosterId) return;
    if (!editablePoster) return;
    const feedback = posterFeedback.trim();
    const currentArtboard = artboards.find(ab => ab.id === activePosterId);
    if (!currentArtboard?.posterData) return;
    const originalImageUrl = currentArtboard.posterData.imageUrlMerged || currentArtboard.posterData.imageUrl;
    const annotationPrompt = buildAnnotationPrompt() || 'Apply the requested changes inside the numbered boxes/arrows.';
    const useMarkup = annotations.length > 0 && Boolean(originalImageUrl);
    console.log('[refine] submit', {
      posterId: activePosterId,
      useMarkup,
      originalImageUrl,
      annotations: annotations.length,
      annotationPrompt,
      feedbackLength: feedback.length
    });

    handleClosePosterModal();
    setIsRefiningPoster(true);

    try {
      if (useMarkup && originalImageUrl) {
        const derivedPosterData: PosterDraft = {
          ...currentArtboard.posterData,
          imageUrl: currentArtboard.posterData.imageUrl,
          imageUrlMerged: currentArtboard.posterData.imageUrlMerged
        };
        const derivedId = createDerivedArtboard(currentArtboard, derivedPosterData);
        console.log('[refine] generating annotated image');
        const markedImageUrl = await buildAnnotatedImageDataUrl(originalImageUrl);
        console.log('[refine] marked image ready', { length: markedImageUrl?.length });
        if (!markedImageUrl) throw new Error('Failed to create annotated image.');
        console.log('[refine] sending edit request');
        const editedUrl = await editPosterWithMarkup(
          originalImageUrl,
          markedImageUrl,
          annotationPrompt,
          refineReferenceImage
        );
        console.log('[refine] edit response', { editedUrl });
        updatePosterArtboard(derivedId, (ab) => ({
          ...ab,
          posterData: {
            ...ab.posterData!,
            imageUrlMerged: editedUrl,
            imageUrl: editedUrl,
            status: 'completed'
          }
        }));
        return;
      }

      const logoForPoster = currentArtboard.posterData.logoUrl ?? logoImage ?? null;
      const fontReferenceUrl = await resolveFontReferenceUrl(fontReferenceImage, selectedServerFont);
      let targetPoster: PlanningStep = {
        ...editablePoster,
        logoUrl: logoForPoster ?? undefined
      };
      if (feedback) {
        const refined = await refinePoster(editablePoster, feedback);
        targetPoster = {
          ...refined,
          logoUrl: logoForPoster ?? undefined
        };
      }

      const nextLayout = editableLayout
        || currentArtboard.posterData?.textLayout
        || buildDefaultTextLayout();

      const baseDerivedId = createDerivedArtboard(currentArtboard, {
        ...currentArtboard.posterData,
        status: 'generating'
      });

      // Submit async task
      const taskId = await generatePosterImageAsync(targetPoster, styleImages, logoForPoster, fontReferenceUrl);

      // Store taskId for recovery
      updatePosterArtboard(baseDerivedId, (ab) => ({
        ...ab,
        posterData: {
          ...ab.posterData!,
          ...targetPoster,
          taskId,
          logoUrl: logoForPoster ?? undefined
        }
      }));

      // Poll until completion
      while (true) {
        const result = await getAITaskStatus(taskId);

        if (result.status === 'completed') {
          const imageUrl = extractImageFromTaskResult(result);
          if (imageUrl) {
            updatePosterArtboard(baseDerivedId, (ab) => ({
              ...ab,
              posterData: {
                ...ab.posterData!,
                ...targetPoster,
                logoUrl: logoForPoster ?? undefined,
                imageUrl,
                imageUrlMerged: imageUrl,
                imageUrlNoText: undefined,
                textLayout: nextLayout,
                textStyles: editableStyles || ab.posterData?.textStyles,
                status: 'completed',
                taskId: undefined
              }
            }));
          } else {
            throw new Error('No image in result');
          }
          break;
        } else if (result.status === 'error') {
          throw new Error(result.error || 'Task failed');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      setPosterFeedback('');
      setEditablePoster(targetPoster);
      setEditableLayout(nextLayout);
      if (editableStyles) {
        setEditableStyles(editableStyles);
      }
    } catch (err) {
      console.error('[refine] failed', err);
    } finally {
      setIsRefiningPoster(false);
    }
  };

  const handleOpenResolutionModal = () => {
    if (!activePosterId) return;
    setIsResolutionModalOpen(true);
  };

  const handleGenerateResolutions = async () => {
    if (!activePosterId) return;
    const currentArtboard = artboards.find(ab => ab.id === activePosterId);
    if (!currentArtboard?.posterData) return;
    const selectedResolutions = Array.from(selectedRefineResolutions)
      .map((id) => REFINE_RESOLUTION_OPTIONS.find((option) => option.id === id))
      .filter(Boolean) as typeof REFINE_RESOLUTION_OPTIONS;
    if (selectedResolutions.length === 0) return;

    handleClosePosterModal();
    setIsResolutionModalOpen(false);
    setIsGeneratingResolutions(true);

    try {
      const posterImageUrl = currentArtboard.posterData.imageUrlMerged || currentArtboard.posterData.imageUrl;
      if (!posterImageUrl) {
        throw new Error('Missing poster image for resolution generation.');
      }
      const logoForPoster = currentArtboard.posterData.logoUrl ?? logoImage ?? null;
      const basePoster: PlanningStep = {
        topBanner: currentArtboard.posterData.topBanner || '',
        headline: currentArtboard.posterData.headline || '',
        subheadline: currentArtboard.posterData.subheadline || '',
        infoBlock: {
          orgName: currentArtboard.posterData.infoBlock?.orgName || '',
          details: currentArtboard.posterData.infoBlock?.details || '',
          credits: currentArtboard.posterData.infoBlock?.credits || ''
        },
        accentColor: currentArtboard.posterData.accentColor || '',
        visualPrompt: currentArtboard.posterData.visualPrompt || '',
        logoUrl: logoForPoster ?? undefined
      };

      const nextLayout = editableLayout
        || currentArtboard.posterData?.textLayout
        || buildDefaultTextLayout();

      let cursorX = currentArtboard.x + currentArtboard.width + ARTBOARD_GAP;
      const derivedIds = selectedResolutions.map((option) => {
        const displaySize = fitSizeToBox(option.width, option.height, currentArtboard.width, currentArtboard.height);
        const derivedId = createDerivedArtboard(
          currentArtboard,
          { ...currentArtboard.posterData!, status: 'generating' },
          {
            width: displaySize.width,
            height: displaySize.height,
            x: cursorX,
            y: currentArtboard.y,
            nameSuffix: option.label
          }
        );
        cursorX += displaySize.width + ARTBOARD_GAP;
        return { id: derivedId, option };
      });

      await Promise.all(derivedIds.map(async ({ id, option }) => {
        const imageUrl = await generatePosterResolutionFromImage(
          posterImageUrl,
          { width: option.width, height: option.height }
        );
        updatePosterArtboard(id, (ab) => ({
          ...ab,
          posterData: {
            ...ab.posterData!,
            ...basePoster,
            logoUrl: logoForPoster ?? undefined,
            imageUrl,
            imageUrlMerged: imageUrl,
            imageUrlNoText: undefined,
            textLayout: nextLayout,
            textStyles: editableStyles || ab.posterData?.textStyles,
            status: 'completed'
          }
        }));
      }));
    } catch (err) {
      console.error('[resolution] failed', err);
    } finally {
      setIsGeneratingResolutions(false);
    }
  };

  const startProduction = async () => {
    if (!theme.trim()) return;

    // Capture current values for this production run
    const currentTheme = theme;
    const currentCount = count;
    const currentStyleImages = [...styleImages];
    const currentLogoImage = logoImage;
    const currentFont = selectedServerFont;
    const currentFontReferenceImage = fontReferenceImage;
    const currentDesignGuidance = '';

    // Clear generator inputs immediately after submission
    resetGeneratorForm();

    // Create production asset pack IMMEDIATELY
    const groupId = `production-${Date.now()}`;
    const startIndex = artboards.length;
    const includeStyle = currentStyleImages.length > 0 && Boolean(currentStyleImages[0]);
    const includeLogo = Boolean(currentLogoImage);
    const includeFontReference = Boolean(currentFontReferenceImage);
    const metrics = computeProductionMetrics(
      currentCount,
      boardWidth,
      boardHeight,
      includeStyle,
      includeLogo,
      includeFontReference
    );
    const viewCenter = getViewCenterWorld();
    const baseXSeed = viewCenter.x - metrics.leftRel - metrics.width / 2;
    const baseYSeed = viewCenter.y - metrics.topRel - metrics.height / 2;

    const occupiedRects: Rect[] = [
      ...artboards.map(ab => ({
        left: ab.x,
        top: ab.y,
        right: ab.x + ab.width,
        bottom: ab.y + ab.height
      })),
      ...canvasAssets.map(asset => ({
        left: asset.x,
        top: asset.y,
        right: asset.x + asset.width,
        bottom: asset.y + asset.height
      }))
    ];

    const getBoundsForBase = (baseX: number, baseY: number): Rect => ({
      left: baseX + metrics.leftRel,
      top: baseY + metrics.topRel,
      right: baseX + metrics.rightRel,
      bottom: baseY + metrics.bottomRel
    });

    const isWithinBoard = (bounds: Rect) => (
      bounds.left >= BOARD_BOUNDS.minX &&
      bounds.right <= BOARD_BOUNDS.maxX &&
      bounds.top >= BOARD_BOUNDS.minY &&
      bounds.bottom <= BOARD_BOUNDS.maxY
    );

    const stepX = boardWidth + ARTBOARD_GAP;
    const stepY = boardHeight + ARTBOARD_GAP;
    const maxRadius = 12;
    let baseX = baseXSeed;
    let baseY = baseYSeed;
    let foundSpot = false;

    for (let radius = 0; radius <= maxRadius && !foundSpot; radius += 1) {
      for (let dx = -radius; dx <= radius && !foundSpot; dx += 1) {
        for (let dy = -radius; dy <= radius && !foundSpot; dy += 1) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const candidateX = baseXSeed + dx * stepX;
          const candidateY = baseYSeed + dy * stepY;
          const bounds = getBoundsForBase(candidateX, candidateY);
          if (!isWithinBoard(bounds)) continue;
          const overlaps = occupiedRects.some(rect => rectsOverlap(bounds, rect, BOARD_PADDING));
          if (!overlaps) {
            baseX = candidateX;
            baseY = candidateY;
            foundSpot = true;
          }
        }
      }
    }

    if (!foundSpot) {
      baseX = clampValue(baseXSeed, BOARD_BOUNDS.minX - metrics.leftRel, BOARD_BOUNDS.maxX - metrics.rightRel);
      baseY = clampValue(baseYSeed, BOARD_BOUNDS.minY - metrics.topRel, BOARD_BOUNDS.maxY - metrics.bottomRel);
    }

    const placementBounds = getBoundsForBase(baseX, baseY);
    const assetStartX = baseX - 300;
    let currentY = baseY + 40;
    const newAssets: Asset[] = [];
    const timeSeed = Date.now();

    // 1. Create note asset with user requirements
    const noteAsset: Asset = {
      id: `note-${timeSeed}`,
      type: 'note',
      x: assetStartX + 16,
      y: currentY,
      width: 200,
      height: 120,
      content: currentTheme,
      zIndex: 16,
      isProductionAsset: true,
      groupId
    };
    newAssets.push(noteAsset);
    currentY += 136;

    // 2. Create style reference image asset if provided
    if (currentStyleImages.length > 0 && currentStyleImages[0]) {
      const styleAsset: Asset = {
        id: `style-${timeSeed}-1`,
        type: 'image',
        x: assetStartX + 16,
        y: currentY,
        width: 200,
        height: 150,
        content: currentStyleImages[0],
        zIndex: 16,
        isProductionAsset: true,
        groupId
      };
      newAssets.push(styleAsset);
      currentY += 166;
    }

    // 3. Create logo image asset if provided
    if (currentLogoImage) {
      const logoAsset: Asset = {
        id: `logo-${timeSeed}-1`,
        type: 'image',
        x: assetStartX + 16,
        y: currentY,
        width: 200,
        height: 100,
        content: currentLogoImage,
        zIndex: 16,
        isProductionAsset: true,
        groupId
      };
      newAssets.push(logoAsset);
      currentY += 116;
    }

    if (currentFontReferenceImage) {
      const fontAsset: Asset = {
        id: `font-ref-${timeSeed}-1`,
        type: 'image',
        x: assetStartX + 16,
        y: currentY,
        width: 200,
        height: 100,
        content: currentFontReferenceImage,
        zIndex: 16,
        isProductionAsset: true,
        groupId
      };
      newAssets.push(fontAsset);
      currentY += 116;
    }

    // Calculate group background bounds
    const groupPadding = 16;
    const groupHeight = currentY - baseY + groupPadding;

    // Add group background
    const groupBgAsset: Asset = {
      id: `group-bg-${timeSeed}`,
      type: 'text',
      x: assetStartX,
      y: baseY,
      width: 232,
      height: groupHeight,
      content: '',
      zIndex: 14,
      isProductionAsset: true,
      groupId
    };

    // Create placeholder artboards IMMEDIATELY with 'planning' status
    const placeholderPosters: PosterDraft[] = Array.from({ length: currentCount }, (_, index) => ({
      id: `poster-${timeSeed}-${index}`,
      topBanner: '',
      headline: `Poster ${startIndex + index + 1}`,
      subheadline: '',
      infoBlock: { orgName: '', details: '', credits: '' },
      accentColor: '#6b7280',
      visualPrompt: '',
      logoUrl: currentLogoImage ?? undefined,
      status: 'planning' as const
    }));

    const placeholderArtboards: Artboard[] = placeholderPosters.map((poster, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      return {
        id: poster.id,
        name: poster.headline,
        x: baseX + col * (boardWidth + ARTBOARD_GAP),
        y: baseY + row * (boardHeight + ARTBOARD_GAP),
        width: boardWidth,
        height: boardHeight,
        assets: [],
        posterData: poster
      };
    });

    // Create connections immediately
    const newConnections: Connection[] = [];
    const productionAssetIds = [noteAsset.id, ...newAssets.filter(a => a.id !== noteAsset.id).map(a => a.id)];
    productionAssetIds.forEach(assetId => {
      placeholderArtboards.forEach(artboard => {
        newConnections.push({
          id: `conn-${assetId}-${artboard.id}`,
          fromId: assetId,
          fromType: 'asset',
          toId: artboard.id,
          toType: 'artboard',
          groupId
        });
      });
    });

    // Add everything to canvas IMMEDIATELY
    setCanvasAssets(prev => [...prev, groupBgAsset, ...newAssets]);
    setConnections(prev => [...prev, ...newConnections]);
    setArtboards(prev => [...prev, ...placeholderArtboards]);
    triggerArtboardFadeIn(placeholderArtboards.map((artboard) => artboard.id));
    smoothPanToWorld(
      (placementBounds.left + placementBounds.right) / 2,
      (placementBounds.top + placementBounds.bottom) / 2
    );

    // Save project snapshot with uploads
    if (activeProjectId && activeProject) {
      const snapshot = buildProjectSnapshot({}, { includeUploads: true });
      if (snapshot) {
        void saveProjectToBackend(activeProjectId, snapshot);
      }
    }

    // Run the generation in background (don't await, allow parallel submissions)
    void (async () => {
      try {
        const plans = await planPosters(currentTheme, currentCount, currentStyleImages, currentLogoImage);
        const fontReferenceUrl = await resolveFontReferenceUrl(currentFontReferenceImage, currentFont);

        // Update placeholder artboards with actual poster data
        plans.forEach((plan, index) => {
          const posterId = placeholderPosters[index].id;
          setArtboards(prev => prev.map(ab => {
            if (ab.id !== posterId) return ab;
            return {
              ...ab,
              name: plan.headline || ab.name,
              posterData: {
                ...ab.posterData!,
                ...plan,
                logoUrl: currentLogoImage ?? undefined,
                status: 'generating'
              }
            };
          }));
        });

        // Submit async tasks and start polling
        const logoForPoster = currentLogoImage ?? null;
        const taskSubmissions = await Promise.all(
          plans.map(async (plan, index) => {
            const posterId = placeholderPosters[index].id;
            try {
              const taskId = await generatePosterImageAsync(
                { ...plan, logoUrl: logoForPoster ?? undefined },
                currentStyleImages,
                logoForPoster,
                fontReferenceUrl,
                undefined,
                currentTheme,
                currentDesignGuidance
              );
              // Store taskId in posterData for recovery after refresh
              setArtboards(prev => prev.map(ab => {
                if (ab.id !== posterId) return ab;
                return {
                  ...ab,
                  posterData: {
                    ...ab.posterData!,
                    taskId
                  }
                };
              }));
              return { posterId, taskId, plan };
            } catch (err) {
              setArtboards(prev => prev.map(ab =>
                ab.id === posterId
                  ? { ...ab, posterData: { ...ab.posterData!, status: 'error' } }
                  : ab
              ));
              return null;
            }
          })
        );

        // Poll all tasks until completion
        const pollPromises = taskSubmissions
          .filter((t): t is NonNullable<typeof t> => t !== null)
          .map(async ({ posterId, taskId, plan }) => {
            try {
              // Poll until task completes
              while (true) {
                const result = await getAITaskStatus(taskId);

                if (result.status === 'completed') {
                  const imageUrl = extractImageFromTaskResult(result);
                  if (imageUrl) {
                    setArtboards(prev => prev.map(ab => {
                      if (ab.id !== posterId) return ab;
                      return {
                        ...ab,
                        posterData: {
                          ...ab.posterData!,
                          imageUrl,
                          imageUrlNoText: undefined,
                          textLayout: buildDefaultTextLayout(),
                          status: 'completed',
                          taskId: undefined // Clear taskId after completion
                        }
                      };
                    }));
                  } else {
                    throw new Error('No image in result');
                  }
                  break;
                } else if (result.status === 'error') {
                  throw new Error(result.error || 'Task failed');
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (err) {
              setArtboards(prev => prev.map(ab =>
                ab.id === posterId
                  ? { ...ab, posterData: { ...ab.posterData!, status: 'error', taskId: undefined } }
                  : ab
              ));
            }
          });

        await Promise.all(pollPromises);

        // Save final result
        if (activeProjectId && activeProject) {
          const snapshot = buildProjectSnapshot(
            { artboards: artboardsRef.current },
            { includeUploads: false }
          );
          if (snapshot) {
            await saveProjectToBackend(activeProjectId, snapshot);
          }
        }
      } catch (error) {
        // Mark all placeholders as error
        placeholderPosters.forEach(poster => {
          setArtboards(prev => prev.map(ab =>
            ab.id === poster.id
              ? { ...ab, posterData: { ...ab.posterData!, status: 'error' } }
              : ab
          ));
        });
        console.error('Production error:', error);
      }
    })();
  };

  const buildProjectSnapshot = (
    overrides: Partial<Project> = {},
    options: { includeUploads?: boolean } = {}
  ): Project | null => {
    if (!activeProject) return null;
    const includeUploads = options.includeUploads ?? false;
    const sanitizeUploadUrl = (value?: string | null) => {
      if (!value) return value ?? null;
      if (!includeUploads && value.startsWith('data:image/')) return undefined;
      return value;
    };
    const sanitizeUploadUrls = (values?: string[]) => {
      if (!values) return values;
      return values
        .map((value) => (sanitizeUploadUrl(value) as string | undefined))
        .filter((value): value is string => Boolean(value));
    };
    return {
      ...activeProject,
      artboards,
      canvasAssets,
      connections,
      styleImages: sanitizeUploadUrls(styleImages),
      logoImage: sanitizeUploadUrl(logoImage),
      fontReferenceImage: sanitizeUploadUrl(fontReferenceImage),
      view: {
        x: viewOffset.x,
        y: viewOffset.y,
        zoom
      },
      updatedAt: Date.now(),
      ...overrides
    };
  };

  const filteredProjects = projects.filter(project =>
    project.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if we're on the board route
  const isOnBoardRoute = route.startsWith('/board/');
  const isAdminRoute = route.startsWith('/admin');
  const adminSubroute = isAdminRoute ? route.replace('/admin', '') || '/' : '';
  const isLandingRoute = route === '/landing';
  const isLoginRoute = route === '/login';
  const isPersonalSpaceRoute = route === '/personal-space';

  useEffect(() => {
    if (!authReady || authUser) return;
    if (!isLandingRoute && !isLoginRoute) {
      handleNavigate('/landing');
    }
  }, [authReady, authUser, handleNavigate, isLandingRoute, isLoginRoute]);

  useEffect(() => {
    if (!authReady || !authUser) return;
    if (isLandingRoute || isLoginRoute) {
      handleNavigate('/');
    }
  }, [authReady, authUser, handleNavigate, isLandingRoute, isLoginRoute]);

  useEffect(() => {
    if (isLoginRoute && authMode !== 'login') {
      setAuthMode('login');
      setAuthError('');
    }
  }, [isLoginRoute, authMode]);

  useEffect(() => {
    if (!authUser?.is_admin) return;
    if (adminSubroute !== '/database') return;
    void fetchAdminDbTables();
  }, [authUser, adminSubroute, fetchAdminDbTables]);

  useEffect(() => {
    if (!authUser?.is_admin) return;
    if (adminSubroute !== '/database') return;
    if (!adminDbTable) return;
    void fetchAdminDbSchema(adminDbTable);
    void fetchAdminDbRows(adminDbTable, 0);
  }, [authUser, adminSubroute, adminDbTable, fetchAdminDbSchema, fetchAdminDbRows]);

  useEffect(() => {
    if (!isOnBoardRoute) return;
    return undefined;
  }, [isOnBoardRoute]);

  useEffect(() => {
    if (!isPosterModalOpen) return;
    return undefined;
  }, [isPosterModalOpen]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] text-gray-500">
        Checking session...
      </div>
    );
  }

  if (!authUser) {
    if (isLandingRoute) {
      return <LandingPage onStartCreating={() => handleNavigate('/login')} />;
    }

    if (isLoginRoute) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] px-4">
          <div className="w-full max-w-md bg-white border border-gray-100 shadow-xl rounded-3xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center font-bold">C</div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {authMode === 'login' ? 'Sign in' : 'Create account'}
                </h1>
              </div>
            </div>
            <p className="text-gray-500 mb-6">
              {authMode === 'login'
                ? 'Sign in to access your private artboards and models.'
                : 'Register in seconds and start creating posters.'}
            </p>
            <form onSubmit={handleAuthSubmit} className="space-y-4">
              <input
                type="text"
                autoComplete="username"
                placeholder="Username"
                value={authForm.username}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, username: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <input
                type="password"
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                placeholder="Password"
                value={authForm.password}
                onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              {authError && (
                <p className="text-sm text-red-600">{authError}</p>
              )}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full rounded-xl bg-black text-white py-3 font-semibold shadow-lg shadow-gray-200 transition-all disabled:opacity-60"
              >
                {authLoading ? 'Working...' : authMode === 'login' ? 'Sign in' : 'Register'}
              </button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] text-gray-500">
        Redirecting to landing page...
      </div>
    );
  }

  if (mustChangePassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] px-4">
        <div className="w-full max-w-md bg-white border border-gray-100 shadow-xl rounded-3xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center font-bold">C</div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Update Password</h1>
              <p className="text-sm text-gray-500 mt-1">Please change your temporary password.</p>
            </div>
          </div>
          <div className="space-y-4">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={passwordChangeForm.current}
              onChange={(event) => setPasswordChangeForm((prev) => ({ ...prev, current: event.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              value={passwordChangeForm.next}
              onChange={(event) => setPasswordChangeForm((prev) => ({ ...prev, next: event.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={passwordChangeForm.confirm}
              onChange={(event) => setPasswordChangeForm((prev) => ({ ...prev, confirm: event.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {passwordChangeError && (
              <p className="text-sm text-red-600">{passwordChangeError}</p>
            )}
            <button
              type="button"
              onClick={handlePasswordChange}
              disabled={passwordChangeLoading}
              className="w-full rounded-xl bg-black text-white py-3 font-semibold shadow-lg shadow-gray-200 transition-all disabled:opacity-60"
            >
              {passwordChangeLoading ? 'Updating...' : 'Update password'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isAdminRoute) {
    if (!authUser.is_admin) {
      handleNavigate('/');
      return null;
    }
    return (
      <div className="min-h-screen flex bg-[#fbfbfc]">
        <aside className="w-64 bg-white border-r border-gray-100 flex flex-col hidden lg:flex">
          <div className="p-8">
            <nav className="space-y-1">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-gray-500 hover:bg-gray-50 rounded-xl font-medium transition-colors"
                onClick={() => handleNavigate('/')}
              >
                Dashboard
              </button>
              <button
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${adminSubroute === '/' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                onClick={() => handleNavigate('/admin')}
              >
                Admin Home
              </button>
              <button
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${adminSubroute === '/database' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                onClick={() => handleNavigate('/admin/database')}
              >
                Database
              </button>
              <button
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${adminSubroute === '/register' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                onClick={() => handleNavigate('/admin/register')}
              >
                Register
              </button>
              <button
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${adminSubroute === '/playground' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                onClick={() => handleNavigate('/admin/playground')}
              >
                Playground
              </button>
            </nav>
          </div>
          <div className="mt-auto px-6 py-4 border-t border-gray-100">
            <div className="relative flex items-center justify-between bg-transparent px-1 py-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                  <span className="text-sm font-semibold">{authUser.username.slice(0, 1).toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight max-w-[120px] truncate">{authUser.username}</div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <span className="inline-block w-2.5 h-2.5 rounded-[4px] border border-emerald-400"></span>
                    0
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Account menu"
                title="Account menu"
                type="button"
              >
                <ArrowUpRight className="w-4 h-4 rotate-90" />
              </button>
              {isAccountMenuOpen && (
                <div className="absolute right-0 bottom-14 w-32 rounded-xl border border-slate-100 bg-white shadow-lg py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      handleLogout();
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 lg:py-12">
          <div className="max-w-4xl mx-auto">
            {adminSubroute === '/playground' ? (
              <div className="space-y-8">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Model Playground</h1>
                  <p className="text-gray-500 font-medium">Run the image model with a custom prompt and reference images.</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-3xl p-8 shadow-sm space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-500">Prompt</label>
                    <textarea
                      rows={6}
                      value={playgroundPrompt}
                      onChange={(event) => setPlaygroundPrompt(event.target.value)}
                      placeholder="Describe the image you want to generate..."
                      className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-500">Reference Images</label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePlaygroundImagesChange}
                      className="w-full text-[11px] text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-xs file:font-bold file:text-slate-700 hover:file:bg-slate-300"
                    />
                    {playgroundImages.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {playgroundImages.map((url, index) => (
                          <div key={`${url}-${index}`} className="relative group rounded-xl border border-gray-100 bg-white overflow-hidden">
                            <img src={url} alt="" className="w-full h-32 object-cover" />
                            <button
                              type="button"
                              onClick={() => handleRemovePlaygroundImage(index)}
                              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                              aria-label="Remove reference"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleRunPlayground}
                      disabled={playgroundLoading}
                      className="px-5 py-2.5 rounded-xl bg-black text-white text-sm font-semibold disabled:opacity-60"
                    >
                      {playgroundLoading ? 'Generating...' : 'Run Model'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlaygroundPrompt('');
                        setPlaygroundImages([]);
                        setPlaygroundResult(null);
                        setPlaygroundError('');
                      }}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
                    >
                      Clear
                    </button>
                  </div>
                  {playgroundError && (
                    <p className="text-sm text-red-600">{playgroundError}</p>
                  )}
                  {playgroundResult && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">Result</div>
                      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
                        <img src={playgroundResult} alt="Generated result" className="w-full h-auto" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : adminSubroute === '/register' ? (
              <div className="space-y-8">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Register</h1>
                  <p className="text-gray-500 font-medium">Generate a shareable account for collaborators.</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-3xl p-8 shadow-sm space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-gray-500">Username</label>
                    <input
                      type="text"
                      value={adminUsernameInput}
                      onChange={(event) => setAdminUsernameInput(event.target.value)}
                      placeholder="Enter a username"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleAdminRegister}
                      className="px-5 py-2.5 rounded-xl bg-black text-white text-sm font-semibold"
                    >
                      Create Account
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyAdminCredentials}
                      disabled={!adminGeneratedUser}
                      className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:text-gray-300 disabled:border-gray-100"
                    >
                      {adminCopyStatus === 'copied' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  {adminRegisterError && (
                    <p className="text-sm text-red-600">{adminRegisterError}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">Username</div>
                      <div className="text-sm font-semibold text-gray-900 mt-2">
                        {adminGeneratedUser?.username || '—'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-widest text-gray-400 font-bold">Password</div>
                      <div className="text-sm font-semibold text-gray-900 mt-2">
                        {adminGeneratedUser?.password || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : adminSubroute === '/database' ? (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Database</h1>
                  <p className="text-gray-500 font-medium">Edit tables and rows directly.</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
                  <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Tables</span>
                      <button
                        type="button"
                        onClick={() => fetchAdminDbTables()}
                        className="text-xs font-semibold text-gray-600 hover:text-gray-900"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="space-y-1 max-h-[520px] overflow-y-auto">
                      {adminDbTables.map((table) => (
                        <button
                          key={table}
                          type="button"
                          onClick={() => {
                            setAdminDbTable(table);
                            setAdminDbOffset(0);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium ${adminDbTable === table ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                        >
                          {table}
                        </button>
                      ))}
                      {adminDbTables.length === 0 && (
                        <div className="text-sm text-gray-400 py-2">No tables found.</div>
                      )}
                    </div>
                  </div>
                  <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{adminDbTable || 'Select a table'}</div>
                        <div className="text-xs text-gray-500">
                          {adminDbTotal} rows
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openAdminDbEditor('add')}
                          disabled={!adminDbTable}
                          className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-50"
                        >
                          Add Row
                        </button>
                        <button
                          type="button"
                          onClick={() => adminDbTable && fetchAdminDbRows(adminDbTable, adminDbOffset)}
                          disabled={!adminDbTable}
                          className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                    {adminDbError && (
                      <div className="mb-3 text-sm text-red-600">{adminDbError}</div>
                    )}
                    <div className="overflow-auto border border-gray-100 rounded-xl">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            {adminDbHasRowid && (
                              <th className="text-left px-3 py-2 font-semibold">rowid</th>
                            )}
                            {adminDbSchema.map((col) => (
                              <th key={col.name} className="text-left px-3 py-2 font-semibold">
                                {col.name}
                              </th>
                            ))}
                            <th className="text-left px-3 py-2 font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminDbRows.map((row, idx) => (
                            <tr key={row._rowid ?? idx} className="border-t border-gray-100">
                              {adminDbHasRowid && (
                                <td className="px-3 py-2 text-gray-400">{row._rowid ?? '—'}</td>
                              )}
                              {adminDbSchema.map((col) => (
                                <td key={col.name} className="px-3 py-2 text-gray-700">
                                  {row[col.name] === null || row[col.name] === undefined ? '—' : String(row[col.name])}
                                </td>
                              ))}
                              <td className="px-3 py-2 text-gray-600">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => openAdminDbEditor('edit', row)}
                                    className="text-xs font-semibold text-gray-700 hover:text-gray-900"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAdminDbDelete(row)}
                                    className="text-xs font-semibold text-red-600 hover:text-red-700"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {!adminDbLoading && adminDbRows.length === 0 && (
                            <tr>
                              <td colSpan={adminDbSchema.length + (adminDbHasRowid ? 2 : 1)} className="px-3 py-6 text-center text-gray-400">
                                No rows to display.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
                      <div>
                        Showing {Math.min(adminDbOffset + 1, adminDbTotal)}-{Math.min(adminDbOffset + ADMIN_DB_LIMIT, adminDbTotal)} of {adminDbTotal}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adminDbTable && fetchAdminDbRows(adminDbTable, Math.max(0, adminDbOffset - ADMIN_DB_LIMIT))}
                          disabled={adminDbOffset === 0}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-50"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextOffset = adminDbOffset + ADMIN_DB_LIMIT;
                            if (nextOffset < adminDbTotal) {
                              fetchAdminDbRows(adminDbTable, nextOffset);
                            }
                          }}
                          disabled={adminDbOffset + ADMIN_DB_LIMIT >= adminDbTotal}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    {adminDbLoading && (
                      <div className="mt-3 text-xs text-gray-400">Loading...</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-10">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin</h1>
                <p className="text-gray-500 font-medium">Admin tools and overview.</p>
              </div>
            )}
          </div>
        </main>
        {adminDbEditorOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 backdrop-blur-sm p-6">
            <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-gray-100 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    {adminDbEditorMode === 'add' ? 'Add Row' : 'Edit Row'}
                  </div>
                  <div className="text-lg font-bold text-gray-900">{adminDbTable}</div>
                </div>
                <button
                  type="button"
                  onClick={closeAdminDbEditor}
                  className="text-sm font-semibold text-gray-500 hover:text-gray-900"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto space-y-3">
                {adminDbSchema.map((column) => (
                  <div key={column.name} className="space-y-1">
                    <label className="text-xs font-semibold text-gray-500">
                      {column.name}
                      {column.pk ? ' (PK)' : ''}
                    </label>
                    <input
                      type="text"
                      value={adminDbEditorValues[column.name] ?? ''}
                      onChange={(event) => setAdminDbEditorValues((prev) => ({ ...prev, [column.name]: event.target.value }))}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                    {column.type && (
                      <div className="text-[10px] text-gray-400">Type: {column.type}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeAdminDbEditor}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAdminDbSave}
                  disabled={adminDbSaving}
                  className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {adminDbSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!isOnBoardRoute) {
    if (isPersonalSpaceRoute) {
      return (
        <div className="min-h-screen flex bg-[#fbfbfc]">
          <aside className="w-64 bg-white border-r border-gray-100 flex flex-col hidden lg:flex">
            <div className="p-8">
              <nav className="space-y-1">
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-gray-500 hover:bg-gray-50 rounded-xl font-medium transition-colors"
                  onClick={() => handleNavigate('/')}
                >
                  Dashboard
                </button>
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-xl font-medium transition-colors"
                  onClick={() => handleNavigate('/personal-space')}
                >
                  Personal Space
                </button>
                {authUser.is_admin && (
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-gray-500 hover:bg-gray-50 rounded-xl font-medium transition-colors"
                    onClick={() => handleNavigate('/admin')}
                  >
                    Admin
                  </button>
                )}
              </nav>
            </div>
            <div className="mt-auto px-6 py-4 border-t border-gray-100">
              <div className="relative flex items-center justify-between bg-transparent px-1 py-1">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    <span className="text-sm font-semibold">{authUser.username.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900 leading-tight max-w-[120px] truncate">{authUser.username}</div>
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <span className="inline-block w-2.5 h-2.5 rounded-[4px] border border-emerald-400"></span>
                      0
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                  className="text-slate-400 hover:text-slate-600"
                  aria-label="Account menu"
                  title="Account menu"
                  type="button"
                >
                  <ArrowUpRight className="w-4 h-4 rotate-90" />
                </button>
                {isAccountMenuOpen && (
                  <div className="absolute right-0 bottom-14 w-32 rounded-xl border border-slate-100 bg-white shadow-lg py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAccountMenuOpen(false);
                        handleLogout();
                      }}
                      className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>

          <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 lg:py-12">
            <PersonalSpacePage />
          </main>
        </div>
      );
    }

    // Dashboard view
    return (
      <div className="min-h-screen flex bg-[#fbfbfc]">
        <aside className="w-64 bg-white border-r border-gray-100 flex flex-col hidden lg:flex">
          <div className="p-8">
            <nav className="space-y-1">
              <button className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-xl font-medium transition-colors">
                Dashboard
              </button>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-gray-500 hover:bg-gray-50 rounded-xl font-medium transition-colors"
                onClick={() => handleNavigate('/personal-space')}
              >
                Personal Space
              </button>
              {authUser.is_admin && (
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-gray-500 hover:bg-gray-50 rounded-xl font-medium transition-colors"
                  onClick={() => handleNavigate('/admin')}
                >
                  Admin
                </button>
              )}
            </nav>
          </div>
          <div className="mt-auto px-6 py-4 border-t border-gray-100">
            <div className="relative flex items-center justify-between bg-transparent px-1 py-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                  <span className="text-sm font-semibold">{authUser.username.slice(0, 1).toUpperCase()}</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900 leading-tight max-w-[120px] truncate">{authUser.username}</div>
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <span className="inline-block w-2.5 h-2.5 rounded-[4px] border border-emerald-400"></span>
                    0
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Account menu"
                title="Account menu"
                type="button"
              >
                <ArrowUpRight className="w-4 h-4 rotate-90" />
              </button>
              {isAccountMenuOpen && (
                <div className="absolute right-0 bottom-14 w-32 rounded-xl border border-slate-100 bg-white shadow-lg py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAccountMenuOpen(false);
                      handleLogout();
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 lg:py-12">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">My Artboards</h1>
              </div>

              <div>
                <button
                  onClick={() => setIsNewProjectModalOpen(true)}
                  className="flex items-center justify-center gap-2 bg-black text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-gray-200 transition-all active:scale-95"
                >
                  <Plus size={20} />
                  Create New Canvas
                </button>
              </div>
            </div>

            

            

            {filteredProjects.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {filteredProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={handleOpenProject}
                    onDelete={handleDeleteProject}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-4">
                  <Search size={32} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">No projects found</h3>
                <p className="text-gray-500 font-medium mb-6">Create your first poster canvas.</p>
                <button
                  onClick={() => setIsNewProjectModalOpen(true)}
                  className="text-black font-bold hover:underline"
                >
                  Create a project now
                </button>
              </div>
            )}
          </div>
        </main>

        {isNewProjectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Canvas</h2>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Project Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Retro Night"
                    value={newProjectData.title}
                    onChange={(e) => setNewProjectData({ ...newProjectData, title: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:border-black focus:ring-4 focus:ring-gray-100 transition-all"
                    autoFocus
                  />
                </div>

              </div>

              <div className="flex gap-3 mt-10">
                <button
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="flex-1 py-4 bg-gray-50 text-gray-600 rounded-2xl font-bold hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={!newProjectData.title.trim()}
                  className="flex-1 py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-gray-100"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const selectedArtboard = artboards.find(ab => ab.id === selection.artboardId);
  const selectedAsset = selectedArtboard?.assets.find(a => a.id === selection.assetId);
  const canEditAssets = Boolean(selectedArtboard);
  const isGenerating = status === AppStatus.PLANNING || status === AppStatus.GENERATING;
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#f5f5f7] text-slate-900 select-none">
      <style>{`
        @keyframes ideaProgress {
          0% { transform: translateX(-60%); }
          50% { transform: translateX(20%); }
          100% { transform: translateX(120%); }
        }
      `}</style>
      <aside className="w-14 flex flex-col items-center py-4 border-r border-slate-200 bg-white z-50 shadow-sm">
        <div className="mb-8">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold">C</div>
        </div>
        <div className="flex flex-col space-y-4">
          <ToolButton icon={<Plus />} onClick={addArtboard} tooltip="New Board" />
          <div className="h-[1px] w-6 bg-slate-100 mx-auto" />
          <ToolButton
            icon={<TextIcon />}
            onClick={() => selection.artboardId && addAsset('text', selection.artboardId)}
            disabled={!canEditAssets}
            tooltip="Add Text"
          />
          <ToolButton
            icon={<ImageIcon />}
            onClick={() => selection.artboardId && addAsset('image', selection.artboardId)}
            disabled={!canEditAssets}
            tooltip="Add Image"
          />
          <ToolButton
            icon={<Trash2 className="text-red-400" />}
            onClick={deleteSelected}
            disabled={!selection.artboardId && !canvasSelectionId}
            tooltip="Delete"
          />
        </div>
        <div className="mt-auto flex flex-col space-y-2">
          <ToolButton icon={<ZoomIn className="w-4 h-4" />} onClick={() => setZoom(z => Math.min(z + 0.1, 2))} />
          <div className="text-[10px] font-bold text-slate-400 text-center">{Math.round(zoom * 100)}%</div>
          <ToolButton icon={<ZoomOut className="w-4 h-4" />} onClick={() => setZoom(z => Math.max(z - 0.1, 0.4))} />
        </div>
      </aside>

      <main
        ref={canvasRef}
        className={`flex-1 relative overflow-hidden ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
        onMouseDown={handleCanvasMouseDown}
        onWheel={handleCanvasWheel}
        onContextMenu={handleCanvasContextMenu}
        style={{
          backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${viewOffset.x % (24 * zoom)}px ${viewOffset.y % (24 * zoom)}px`
        }}
      >
        <div className="absolute left-5 top-5 z-40">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2 shadow-xl backdrop-blur">
            <button
              onClick={handleBackToDashboard}
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-600 hover:text-slate-900"
              type="button"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="w-px h-6 bg-slate-200" />
            {isRenamingProject ? (
              <input
                className="w-48 rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none"
                value={projectTitleDraft}
                onChange={(e) => setProjectTitleDraft(e.target.value)}
                onBlur={handleRenameProject}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleRenameProject();
                  }
                  if (e.key === 'Escape') {
                    setProjectTitleDraft(activeProject?.title || '');
                    setIsRenamingProject(false);
                  }
                }}
                autoFocus
                aria-label="Project title"
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800 max-w-[240px] truncate">
                  {activeProject?.title || 'Untitled Project'}
                </span>
                <button
                  type="button"
                  className="w-7 h-7 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center"
                  onClick={() => {
                    setProjectTitleDraft(activeProject?.title || '');
                    setIsRenamingProject(true);
                  }}
                  title="Edit title"
                  aria-label="Edit title"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="w-px h-6 bg-slate-200" />
          </div>
        </div>
        {isAutoSaving && (
          <div className="absolute right-5 top-5 z-40">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2 shadow-xl backdrop-blur">
              <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
              <span className="text-xs font-semibold text-slate-600">Saving…</span>
            </div>
          </div>
        )}
        {marqueeRect && (
          <div
            className="absolute border border-blue-500/80 bg-blue-200/20 rounded-sm pointer-events-none"
            style={{
              left: marqueeRect.x * zoom + viewOffset.x,
              top: marqueeRect.y * zoom + viewOffset.y,
              width: marqueeRect.width * zoom,
              height: marqueeRect.height * zoom
            }}
          />
        )}
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }}
        >
          <div
            className="absolute border-2 border-dashed border-slate-300 bg-white/60 shadow-[0_0_0_1px_rgba(148,163,184,0.2)]"
            style={{
              left: BOARD_BOUNDS.minX,
              top: BOARD_BOUNDS.minY,
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT
            }}
          />
          <div
            className="absolute"
            style={{
              left: BOARD_BOUNDS.minX,
              top: BOARD_BOUNDS.minY,
              width: BOARD_WIDTH,
              height: BOARD_HEIGHT,
              overflow: 'hidden'
            }}
          >
            <div
              className="absolute inset-0"
              style={{ transform: `translate(${-BOARD_BOUNDS.minX}px, ${-BOARD_BOUNDS.minY}px)` }}
            >
              {connections.map(conn => (
                <ConnectionLine
                  key={conn.id}
                  connection={conn}
                  canvasAssets={canvasAssets}
                  artboards={artboards}
                />
              ))}
            {canvasAssets.map(asset => (
              <CanvasAssetComponent
                key={asset.id}
                asset={asset}
                isSelected={canvasSelectionId === asset.id || multiSelectedCanvasAssets.includes(asset.id)}
                isFading={fadeInCanvasAssetIds.has(asset.id)}
                onSelect={(event) => {
                  if (event.ctrlKey) {
                    setMultiSelectedCanvasAssets((prev) => (
                      prev.includes(asset.id) ? prev.filter(id => id !== asset.id) : [...prev, asset.id]
                    ));
                    setCanvasSelectionId(asset.id);
                    setSelection({ artboardId: null, assetId: null });
                    return;
                  }
                  setMultiSelectedCanvasAssets([]);
                  setMultiSelectedArtboards([]);
                  setCanvasSelectionId(asset.id);
                  setSelection({ artboardId: null, assetId: null });
                }}
                onDrag={(dx, dy) => handleDragCanvasAsset(asset.id, dx, dy)}
                onResize={(dw, dh) => handleResizeCanvasAsset(asset.id, dw, dh)}
                onDelete={() => deleteCanvasAsset(asset.id)}
                onContextMenu={(event) => handleOpenAssetContextMenu(event, 'canvas', asset.id)}
                onUpdateContent={(content) => updateCanvasAssetContent(asset.id, content)}
              />
            ))}
            {artboards.map(ab => (
              <ArtboardComponent
                key={ab.id}
                artboard={ab}
                isSelected={selection.artboardId === ab.id || multiSelectedArtboards.includes(ab.id)}
                isFadingIn={fadeInArtboardIds.has(ab.id)}
                selectedAssetId={selection.assetId}
                onSelect={(assetId, event) => {
                  if (event.ctrlKey) {
                    setMultiSelectedArtboards((prev) => (
                      prev.includes(ab.id) ? prev.filter(id => id !== ab.id) : [...prev, ab.id]
                    ));
                    setSelection({ artboardId: ab.id, assetId });
                    setCanvasSelectionId(null);
                    return;
                  }
                  setMultiSelectedArtboards([]);
                  setMultiSelectedCanvasAssets([]);
                  setSelection({ artboardId: ab.id, assetId });
                  setCanvasSelectionId(null);
                }}
                onDragArtboard={(dx, dy) => handleDragArtboard(ab.id, dx, dy)}
                onResizeArtboard={(dw, dh) => handleResizeArtboard(ab.id, dw, dh)}
                onDragAsset={(assetId, dx, dy) => handleDragAsset(ab.id, assetId, dx, dy)}
                onResizeAsset={(assetId, dw, dh) => handleResizeAsset(ab.id, assetId, dw, dh)}
                onUpdateAssetContent={(assetId, content) => updateAssetContent(ab.id, assetId, content)}
                onOpenPoster={openPosterModal}
                onOpenAssetContextMenu={(assetId, event) => handleOpenAssetContextMenu(event, 'artboard', assetId, ab.id)}
                onOpenPosterContextMenu={(event) => handleOpenAssetContextMenu(event, 'poster', ab.id, ab.id)}
              />
              ))}
            </div>
          </div>
        </div>
        <div className="absolute left-1/2 bottom-6 -translate-x-1/2 z-40">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
            <button
              type="button"
              className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md"
              title="Select"
              aria-label="Select"
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <button
              type="button"
              className="w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <Undo2 className="w-4 h-4 mx-auto" />
            </button>
            <button
              type="button"
              className="w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <Redo2 className="w-4 h-4 mx-auto" />
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <button
              type="button"
              className="w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
              onClick={() => {
                imageUploadInputRef.current?.click();
              }}
              title="图片+"
              aria-label="图片+"
            >
              <ImagePlus className="w-4 h-4 mx-auto" />
            </button>
            <button
              type="button"
              className={`w-10 h-10 rounded-xl ${rightPanelMode === 'gallery' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setRightPanelMode((prev) => (prev === 'gallery' ? null : 'gallery'))}
              title="Project Gallery"
              aria-label="Project Gallery"
            >
              <Home className="w-4 h-4 mx-auto" />
            </button>
            <input
              ref={imageUploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleCanvasImageUpload}
            />
          </div>
        </div>
      </main>

      {rightPanelMode && (
        <aside className="w-80 max-h-screen overflow-y-auto border-l border-slate-200 bg-white p-5 flex flex-col space-y-6 z-50">
          {rightPanelMode === 'generator' ? (
            <motion.div layout className="space-y-3 rounded-2xl border border-slate-200 p-4 bg-slate-50">
              <motion.div layout className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                <Sparkles className="w-3.5 h-3.5" /> AI Poster Generator
              </motion.div>
              <motion.textarea
                layout
                className="w-full bg-white border border-slate-200 rounded-lg p-3 text-xs leading-relaxed focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                rows={4}
                placeholder="Describe the event, mood, and style..."
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
              <motion.div layout className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Reference Styles (optional)
                </label>
                {referenceStylesError && (
                  <div className="text-[10px] text-red-500">{referenceStylesError}</div>
                )}
                {referenceStylesLoading ? (
                  <div className="text-[11px] text-slate-400">Loading reference styles...</div>
                ) : referenceStyles.length > 0 ? (
                  <>
                    <AnimatePresence initial={false}>
                      {styleImages.length > 0 && (
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="relative group w-full"
                        >
                          <img src={styleImages[0]} alt="" className="w-full h-24 object-cover rounded-md border border-slate-200" />
                          <button
                            type="button"
                            onClick={() => handleRemoveStyleImage(0)}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove image"
                          >
                            ×
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="relative">
                      <div
                        ref={referenceStylesScrollRef}
                        className="overflow-x-auto scrollbar-hide"
                        onScroll={() => updateScrollIndicators(referenceStylesScrollRef, setRefStylesCanLeft, setRefStylesCanRight)}
                      >
                        <div
                          className="grid gap-2 pr-1"
                          style={{ gridAutoFlow: 'column', gridAutoColumns: 'calc((100% - 16px) / 3)' }}
                        >
                          {referenceStyles.map((item) => {
                            const isSelected = selectedReferenceStyleId === item.id;
                            const isLoading = referenceSelectLoadingId === item.id;
                            const thumbUrl = `${BACKEND_API}/reference/${item.thumbnail_path || item.file_path}`;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => void handleSelectReferenceStyle(item)}
                                disabled={isLoading}
                                className={`relative h-16 rounded-lg border overflow-hidden focus:outline-none focus:ring-2 focus:ring-blue-500 ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'} ${isLoading ? 'opacity-70' : ''}`}
                                aria-label={`Use ${item.original_name}`}
                                title={item.original_name}
                              >
                                <img src={thumbUrl} alt={item.original_name} className="w-full h-full object-cover" />
                                {isSelected && (
                                  <div className="absolute bottom-1 right-1 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                    Using
                                  </div>
                                )}
                                {isLoading && (
                                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                          <label className="h-16 rounded-lg border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                            <span className="text-base font-medium leading-none">+</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest">Add Image</span>
                            <input
                              ref={referenceStyleUploadRef}
                              type="file"
                              accept="image/*"
                              onChange={handleUploadReferenceStyle}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                      {refStylesCanLeft && (
                        <button
                          type="button"
                          onClick={() => scrollRow(referenceStylesScrollRef, 'left')}
                          className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                          aria-label="Scroll left"
                        >
                          ‹
                        </button>
                      )}
                      {refStylesCanRight && (
                        <button
                          type="button"
                          onClick={() => scrollRow(referenceStylesScrollRef, 'right')}
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                          aria-label="Scroll right"
                        >
                          ›
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    No reference styles found. Upload some in Personal Space.
                  </div>
                )}
              </motion.div>
              <motion.div layout className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Logo (optional)
                </label>
                {logoAssetsError && (
                  <div className="text-[10px] text-red-500">{logoAssetsError}</div>
                )}
                {logoAssetsLoading ? (
                  <div className="text-[11px] text-slate-400">Loading logos...</div>
                ) : logoAssets.length > 0 ? (
                  <>
                    <AnimatePresence initial={false}>
                      {logoImage && (
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="relative group w-full h-24 rounded-md border border-slate-200 bg-white flex items-center justify-center overflow-hidden"
                        >
                          <img src={logoImage} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                          <button
                            type="button"
                            onClick={handleRemoveLogo}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove logo"
                          >
                            ×
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="relative">
                      <div
                        ref={logoAssetsScrollRef}
                        className="overflow-x-auto scrollbar-hide"
                        onScroll={() => updateScrollIndicators(logoAssetsScrollRef, setLogosCanLeft, setLogosCanRight)}
                      >
                        <div
                          className="grid gap-2 pr-1"
                          style={{ gridAutoFlow: 'column', gridAutoColumns: 'calc((100% - 16px) / 3)' }}
                        >
                          {logoAssets.map((item) => {
                            const isSelected = selectedLogoAssetId === item.filename;
                            const isLoading = logoSelectLoadingId === item.filename;
                            const thumbUrl = `${BACKEND_API}${item.webp}`;
                            return (
                              <button
                                key={item.filename}
                                type="button"
                                onClick={() => void handleSelectLogoAsset(item)}
                                disabled={isLoading}
                                className={`relative h-16 rounded-lg border bg-white overflow-hidden focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isSelected ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-300'} ${isLoading ? 'opacity-70' : ''}`}
                                aria-label={`Use ${item.filename}`}
                                title={item.filename}
                              >
                                <img src={thumbUrl} alt={item.filename} className="w-full h-full object-contain p-1 bg-white" />
                                {isSelected && (
                                  <div className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                    Using
                                  </div>
                                )}
                                {isLoading && (
                                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                          <label className="h-16 rounded-lg border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                            <span className="text-base font-medium leading-none">+</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest">Add Image</span>
                            <input
                              ref={logoAssetUploadRef}
                              type="file"
                              accept="image/*"
                              onChange={handleUploadLogoAsset}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                      {logosCanLeft && (
                        <button
                          type="button"
                          onClick={() => scrollRow(logoAssetsScrollRef, 'left')}
                          className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                          aria-label="Scroll left"
                        >
                          ‹
                        </button>
                      )}
                      {logosCanRight && (
                        <button
                          type="button"
                          onClick={() => scrollRow(logoAssetsScrollRef, 'right')}
                          className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                          aria-label="Scroll right"
                        >
                          ›
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    No logo assets found. Upload some in Personal Space.
                  </div>
                )}
              </motion.div>
              <motion.div layout className="space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Font (optional)
                </label>
                {availableFonts.length > 0 ? (
                  <>
                    {!selectedServerFont && !fontReferenceImage && (
                      <select
                        value={selectedServerFont}
                        onChange={(e) => handleGeneratorFontChange(e.target.value)}
                        disabled={Boolean(fontReferenceImage)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-700 focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                      >
                        <option value="">Auto (default)</option>
                        {availableFonts.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    )}
                    {selectedServerFont && (
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                        <span className="font-semibold text-slate-700 truncate">{selectedServerFont}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedServerFont('')}
                          className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-600"
                        >
                          Change
                        </button>
                      </div>
                    )}
                    {selectedServerFont && (
                      <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
                        <img
                          src={buildAlphabetPreviewUrl(selectedServerFont)}
                          alt={`${selectedServerFont} alphabet preview`}
                          className="w-full h-32 object-contain bg-white"
                          loading="lazy"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-slate-400">Loading fonts...</div>
                )}
                {fontReferencesError && (
                  <div className="text-[10px] text-red-500">{fontReferencesError}</div>
                )}
                {fontReferencesLoading ? (
                  <div className="text-[11px] text-slate-400">Loading font references...</div>
                ) : fontReferences.length > 0 ? (
                  <>
                    <AnimatePresence initial={false}>
                      {fontReferenceImage && (
                        <motion.div
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="relative group w-full h-24 rounded-md border border-slate-200 bg-white flex items-center justify-center overflow-hidden"
                        >
                          <img src={fontReferenceImage} alt="Font reference preview" className="max-h-full max-w-full object-contain" />
                          <button
                            type="button"
                            onClick={handleClearFontReference}
                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                            aria-label="Remove font reference"
                          >
                            ×
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {!selectedServerFont && (
                      <div className="relative">
                        <div
                          ref={fontReferencesScrollRef}
                          className="overflow-x-auto scrollbar-hide"
                          onScroll={() => updateScrollIndicators(fontReferencesScrollRef, setFontRefsCanLeft, setFontRefsCanRight)}
                        >
                          <div
                            className="grid gap-2 pr-1"
                            style={{ gridAutoFlow: 'column', gridAutoColumns: 'calc((100% - 16px) / 3)' }}
                          >
                            {fontReferences.map((item) => {
                              const isSelected = selectedFontReferenceId === item.id;
                              const isLoading = fontReferenceSelectLoadingId === item.id;
                              const thumbUrl = `${BACKEND_API}/font-reference/${item.thumbnail_path || item.file_path}`;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => void handleSelectFontReference(item)}
                                  disabled={isLoading}
                                  className={`relative h-16 rounded-lg border bg-white overflow-hidden focus:outline-none focus:ring-2 focus:ring-indigo-500 ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:border-slate-300'} ${isLoading ? 'opacity-70' : ''}`}
                                  aria-label={`Use ${item.original_name}`}
                                  title={item.original_name}
                                >
                                  <img src={thumbUrl} alt={item.original_name} className="w-full h-full object-cover" />
                                  {isSelected && (
                                    <div className="absolute bottom-1 right-1 bg-indigo-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                      Using
                                    </div>
                                  )}
                                  {isLoading && (
                                    <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                                      <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                            <label className="h-16 rounded-lg border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-1 text-slate-400 hover:border-slate-400 hover:text-slate-600 transition-colors cursor-pointer">
                              <span className="text-base font-medium leading-none">+</span>
                              <span className="text-[9px] font-bold uppercase tracking-widest">Add Image</span>
                              <input
                                ref={fontReferenceUploadRef}
                                type="file"
                                accept="image/*"
                                onChange={handleUploadFontReference}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                        {fontRefsCanLeft && (
                          <button
                            type="button"
                            onClick={() => scrollRow(fontReferencesScrollRef, 'left')}
                            className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                            aria-label="Scroll left"
                          >
                            ‹
                          </button>
                        )}
                        {fontRefsCanRight && (
                          <button
                            type="button"
                            onClick={() => scrollRow(fontReferencesScrollRef, 'right')}
                            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 shadow-sm"
                            aria-label="Scroll right"
                          >
                            ›
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-slate-400">No font references found.</div>
                )}
              </motion.div>
              <motion.div layout className="grid grid-cols-4 gap-2">
                {[1, 2, 4, 6].map(num => (
                  <button
                    key={num}
                    onClick={() => setCount(num)}
                    className={`py-2 rounded-lg text-xs font-bold border ${count === num ? 'bg-black text-white border-black' : 'bg-white border-slate-200 text-slate-500'}`}
                  >
                    {num}
                  </button>
                ))}
              </motion.div>
              <motion.button
                layout
                onClick={startProduction}
                disabled={!theme.trim()}
                className="w-full bg-black text-white text-xs font-bold uppercase tracking-widest py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                Generate Posters
              </motion.button>
            </motion.div>
          ) : rightPanelMode === 'gallery' ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 bg-slate-50">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                <span>Project Images</span>
                <span className="text-[10px] text-slate-400">{galleryFileUrls.length}</span>
              </div>
              <div
                className="grid grid-cols-2 gap-3 max-h-[540px] overflow-y-auto pr-1"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 40) {
                    const total = galleryFileUrls.length;
                    setGalleryVisibleCount((prev) => Math.min(prev + 10, total));
                  }
                }}
              >
                {galleryFileUrls.slice(0, galleryVisibleCount).map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow text-left"
                    onClick={() => handleGalleryImageClick(url)}
                  >
                    <div className="h-24 bg-slate-100 flex items-center justify-center">
                      <img src={url} alt="Project asset" className="w-full h-full object-contain" />
                    </div>
                  </button>
                ))}
                {galleryLoading && (
                  <div className="col-span-2 text-xs text-slate-400 text-center py-6">Loading...</div>
                )}
                {!galleryLoading && galleryFileUrls.length === 0 && (
                  <div className="col-span-2 text-xs text-slate-400 text-center py-6">No images yet.</div>
                )}
                {galleryError && (
                  <div className="col-span-2 text-xs text-rose-500 text-center py-6">{galleryError}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-slate-200 p-4 bg-slate-50">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                <MessageCircle className="w-3.5 h-3.5" /> Comment
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 h-[380px] overflow-y-auto space-y-3">
                {commentMessages.length === 0 ? (
                  <div className="text-xs text-slate-400">
                    Start a conversation about the selected assets.
                  </div>
                ) : (
                  commentMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`text-xs leading-relaxed rounded-lg px-3 py-2 ${
                        message.role === 'user'
                          ? 'bg-blue-50 text-slate-800 border border-blue-100'
                          : 'bg-slate-50 text-slate-700 border border-slate-200'
                      }`}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 last:mb-0">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 last:mb-0">{children}</ol>,
                          li: ({ children }) => <li className="mb-1 last:mb-0">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({ children }) => (
                            <code className="px-1 py-0.5 rounded bg-slate-200 text-slate-700">{children}</code>
                          ),
                          pre: ({ children }) => (
                            <pre className="p-2 rounded bg-slate-900 text-slate-100 overflow-x-auto text-[11px]">{children}</pre>
                          ),
                          a: ({ children, href }) => (
                            <a href={href} className="text-blue-600 underline" target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          )
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ))
                )}
                {isCommentLoading && (
                  <div className="text-xs text-slate-400">Thinking...</div>
                )}
              </div>
              <div className="space-y-2">
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Pending Assets</div>
                  {commentAttachments.length === 0 ? (
                    <div className="text-xs text-slate-400">Select posters or images to attach.</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {commentAttachments.map((url, index) => (
                        <div key={`${url}-${index}`} className="w-full h-20 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                          <img src={url} alt="Attachment" className="w-full h-full object-contain" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <textarea
                  className="w-full bg-white border border-slate-200 rounded-lg p-3 text-xs leading-relaxed focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                  rows={3}
                  placeholder="Ask the model for feedback or ideas..."
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendComment();
                    }
                  }}
                />
                <button
                  type="button"
                  className={`w-full py-2 rounded-lg text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${
                    commentInput.trim() ? 'bg-black text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                  disabled={!commentInput.trim() || isCommentLoading}
                  onClick={handleSendComment}
                >
                  {isCommentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                  {isCommentLoading ? 'Sending' : 'Send'}
                </button>
              </div>
            </div>
          )}

        {rightPanelMode === 'generator' && null}
        </aside>
      )}

      <UploadingModal
        open={isReferenceUploading}
        title="Uploading reference"
        progress={referenceUploadProgress}
        barClassName="h-full bg-orange-500"
      />
      <UploadingModal
        open={isLogoUploading}
        title="Uploading logo"
        progress={logoUploadProgress}
        barClassName="h-full bg-emerald-500"
      />
      <UploadingModal
        open={isFontReferenceUploading}
        title="Uploading font reference"
        progress={fontReferenceUploadProgress}
        barClassName="h-full bg-indigo-500"
      />

      {isPosterModalOpen && activePoster && editablePoster && (
        <div
          className={`fixed inset-0 z-[60] flex items-start justify-center bg-black/50 backdrop-blur-sm p-6 overflow-y-auto transition-opacity duration-200 ${isPosterModalClosing ? 'opacity-0' : 'opacity-100'}`}
          onClick={handleClosePosterModal}
        >
          <div
            className={`bg-white rounded-3xl w-full max-w-5xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto transition-transform duration-200 ${isPosterModalClosing ? 'scale-[0.98]' : 'scale-100'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Refine Poster</h2>
                <p className="text-xs text-slate-500">Describe the changes you want to make.</p>
              </div>
              <button
                onClick={handleClosePosterModal}
                className="text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  <span>Original</span>
                  <span className="text-[9px] font-medium text-slate-400">Draw boxes or arrows to annotate</span>
                </div>
                <div
                  ref={annotatorRef}
                  className="relative mx-auto rounded-3xl border border-slate-200 bg-white overflow-hidden"
                  style={{
                    width: `min(100%, calc(70vh * ${annotatorAspectRatio}))`,
                    height: 'auto',
                    maxHeight: '70vh',
                    aspectRatio: annotatorAspectRatio
                  }}
                >
                  <img
                    src={activePoster.imageUrlMerged || activePoster.imageUrl}
                    alt="Poster Preview"
                    className="absolute left-0 top-0 w-full h-full pointer-events-none"
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      transform: (() => {
                        const transform = getAnnotatorTransform();
                        if (!transform) return undefined;
                        return `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${annotationZoom})`;
                      })(),
                      transformOrigin: '0 0'
                    }}
                    onLoad={(e) => {
                      console.log('[annotator] img element loaded', {
                        width: e.currentTarget.width,
                        height: e.currentTarget.height,
                        naturalWidth: e.currentTarget.naturalWidth,
                        naturalHeight: e.currentTarget.naturalHeight
                      });
                      setAnnotatorImage(e.currentTarget);
                      setAnnotatorLoaded(true);
                    }}
                    onError={() => {
                      console.warn('[annotator] img element error');
                      setAnnotatorImage(null);
                      setAnnotatorLoaded(false);
                    }}
                  />
                  <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-2 py-1 shadow-md backdrop-blur">
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      onClick={handleAnnotationUndo}
                      title="Undo (Ctrl+Z)"
                      aria-label="Undo"
                    >
                      <Undo2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
                      onClick={handleAnnotationRedo}
                      title="Redo (Ctrl+Y)"
                      aria-label="Redo"
                    >
                      <Redo2 className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-slate-200" />
                    <button
                      type="button"
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${annotationTool === 'pan' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                      onClick={() => setAnnotationTool('pan')}
                      title="Pan"
                      aria-label="Pan"
                    >
                      <Hand className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${annotationTool === 'rect' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                      onClick={() => setAnnotationTool('rect')}
                      title="Rectangle"
                      aria-label="Rectangle"
                    >
                      <Square className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${annotationTool === 'arrow' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                      onClick={() => setAnnotationTool('arrow')}
                      title="Arrow"
                      aria-label="Arrow"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </button>
                    <div className="w-px h-5 bg-slate-200" />
                    {(['red', 'green', 'purple'] as AnnotationColor[]).map(color => (
                      <button
                        key={color}
                        type="button"
                        className={`w-6 h-6 rounded-full border ${annotationColor === color ? 'border-slate-900' : 'border-slate-200'}`}
                        style={{ backgroundColor: color === 'red' ? '#ef4444' : color === 'green' ? '#22c55e' : '#a855f7' }}
                        onClick={() => setAnnotationColor(color)}
                        aria-label={`${color} marker`}
                        title={`${color} marker`}
                      />
                    ))}
                    <div className="w-px h-5 bg-slate-200" />
                    <button
                      type="button"
                      className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                      onClick={() => setAnnotationZoom(z => Math.min(3, z + 0.2))}
                      aria-label="Zoom in"
                      title="Zoom in"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                      onClick={() => setAnnotationZoom(z => Math.max(0.5, z - 0.2))}
                      aria-label="Zoom out"
                      title="Zoom out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                  </div>
                  <canvas
                    ref={annotatorCanvasRef}
                    className={`absolute left-0 top-0 pointer-events-auto ${annotationTool === 'pan' ? 'cursor-grab' : 'cursor-crosshair'}`}
                    width={annotatorImage ? (annotatorImage.naturalWidth || annotatorImage.width) : 0}
                    height={annotatorImage ? (annotatorImage.naturalHeight || annotatorImage.height) : 0}
                    style={{
                      width: '100%',
                      height: '100%',
                      transform: (() => {
                        const transform = getAnnotatorTransform();
                        if (!transform) return undefined;
                        return `translate(${transform.offsetX}px, ${transform.offsetY}px) scale(${annotationZoom})`;
                      })(),
                      transformOrigin: '0 0'
                    }}
                    onPointerDown={(event) => {
                      if (!isAnnotatorReady) {
                        console.warn('[annotator] pointer down ignored', { ready: isAnnotatorReady, size: annotatorSize, tick: annotatorReadyTick });
                        return;
                      }
                      event.currentTarget.setPointerCapture(event.pointerId);
                      handleAnnotatorMouseDown(event as unknown as React.MouseEvent);
                    }}
                    onPointerMove={(event) => {
                      if (!isAnnotatorReady) return;
                      handleAnnotatorMouseMove(event as unknown as React.MouseEvent);
                    }}
                    onPointerUp={(event) => {
                      if (!isAnnotatorReady) return;
                      event.currentTarget.releasePointerCapture(event.pointerId);
                      handleAnnotatorMouseUp();
                    }}
                    onPointerLeave={() => {
                      if (!isAnnotatorReady) return;
                      handleAnnotatorMouseUp();
                    }}
                    onWheel={(event) => {
                      event.preventDefault();
                      const delta = -event.deltaY;
                      setAnnotationZoom((prev) => {
                        const next = prev + (delta > 0 ? 0.1 : -0.1);
                        return Math.min(3, Math.max(0.5, next));
                      });
                    }}
                  />
                </div>
              </div>
              <div className="space-y-4">
                {annotations.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Annotation Notes</label>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2 cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const dataUrl = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result || ''));
                              reader.onerror = () => reject(new Error('Failed to read image.'));
                              reader.readAsDataURL(file);
                            });
                            setRefineReferenceImage(dataUrl);
                            event.target.value = '';
                          }}
                        />
                        <ImagePlus className="w-3.5 h-3.5" />
                        Add Reference
                      </label>
                    </div>
                    {!refineReferenceImage && (
                      <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-xs font-bold uppercase tracking-widest text-slate-600 bg-white hover:bg-slate-50 cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const dataUrl = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result || ''));
                              reader.onerror = () => reject(new Error('Failed to read image.'));
                              reader.readAsDataURL(file);
                            });
                            setRefineReferenceImage(dataUrl);
                            event.target.value = '';
                          }}
                        />
                        <ImagePlus className="w-4 h-4" />
                        Upload Reference Image
                      </label>
                    )}
                    {refineReferenceImage && (
                      <div className="relative w-full h-24 rounded-lg border border-slate-200 bg-white overflow-hidden">
                        <img src={refineReferenceImage} alt="Reference" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px]"
                          onClick={() => setRefineReferenceImage(null)}
                          aria-label="Remove reference image"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                      {annotations.map(annotation => (
                        <div key={annotation.id} className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Box {annotation.id}</label>
                          <textarea
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs leading-relaxed focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                            rows={2}
                            placeholder={`Describe changes for box ${annotation.id}...`}
                            value={annotationNotes[annotation.id] || ''}
                            onChange={(e) => setAnnotationNotes(prev => ({ ...prev, [annotation.id]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Feedback</label>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2 cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const dataUrl = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result || ''));
                              reader.onerror = () => reject(new Error('Failed to read image.'));
                              reader.readAsDataURL(file);
                            });
                            setRefineReferenceImage(dataUrl);
                            event.target.value = '';
                          }}
                        />
                        <ImagePlus className="w-3.5 h-3.5" />
                        Add Reference
                      </label>
                    </div>
                    {!refineReferenceImage && (
                      <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-slate-300 rounded-xl py-3 text-xs font-bold uppercase tracking-widest text-slate-600 bg-white hover:bg-slate-50 cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const dataUrl = await new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result || ''));
                              reader.onerror = () => reject(new Error('Failed to read image.'));
                              reader.readAsDataURL(file);
                            });
                            setRefineReferenceImage(dataUrl);
                            event.target.value = '';
                          }}
                        />
                        <ImagePlus className="w-4 h-4" />
                        Upload Reference Image
                      </label>
                    )}
                    {refineReferenceImage && (
                      <div className="relative w-full h-24 rounded-lg border border-slate-200 bg-white overflow-hidden">
                        <img src={refineReferenceImage} alt="Reference" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-900 text-white text-[10px]"
                          onClick={() => setRefineReferenceImage(null)}
                          aria-label="Remove reference image"
                        >
                          ×
                        </button>
                      </div>
                    )}
                    <textarea
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs leading-relaxed focus:ring-1 focus:ring-blue-500 outline-none resize-none"
                      rows={6}
                      placeholder="e.g. Make it more noir, emphasize neon reflections, update accent color to deep amber..."
                      value={posterFeedback}
                      onChange={(e) => setPosterFeedback(e.target.value)}
                    />
                    <button
                      type="button"
                      className="relative w-full overflow-hidden py-2 rounded-lg text-xs font-bold uppercase tracking-widest border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
                      onClick={handleFetchFeedbackIdeas}
                      disabled={isLoadingSuggestions}
                    >
                      {isLoadingSuggestions && (
                        <span className="absolute left-0 top-0 h-full w-full">
                          <span className="absolute inset-0 bg-slate-100/70" />
                          <span className="absolute left-0 top-0 h-full w-1/2 animate-[ideaProgress_1.2s_ease-in-out_infinite] bg-slate-300/60" />
                        </span>
                      )}
                      <span className="relative">
                        {isLoadingSuggestions ? ideaLoadingLabel : 'Give Me Ideas'}
                      </span>
                    </button>
                    {feedbackSuggestions.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          Suggestions
                        </div>
                        <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                          {feedbackSuggestions.map((idea, index) => (
                            <button
                              key={`${idea}-${index}`}
                              type="button"
                              className={`text-left w-full px-3 py-2 rounded-lg border text-xs transition-colors ${
                                selectedSuggestions.has(idea)
                                  ? 'border-blue-500 bg-blue-50 text-slate-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                              onClick={() => {
                                setSelectedSuggestions((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idea)) {
                                    next.delete(idea);
                                  } else {
                                    next.add(idea);
                                  }
                                  setPosterFeedback(Array.from(next).join('\n'));
                                  return next;
                                });
                              }}
                            >
                              {idea}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      className="w-full border border-slate-200 rounded-xl bg-white py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50"
                      onClick={handleOpenResolutionModal}
                    >
                      More Resolutions
                    </button>
                  </div>
                )}
                <button
                  onClick={handleRefinePoster}
                  disabled={isRefiningPoster || (annotations.length === 0 && !posterFeedback.trim())}
                  className="w-full bg-black text-white text-xs font-bold uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isRefiningPoster ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {isRefiningPoster ? 'Refining' : 'Apply Refinement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isResolutionModalOpen && activePoster && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
          onClick={() => setIsResolutionModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Select Resolutions</h3>
                <p className="text-xs text-slate-500">Derived posters will be generated and linked to the current poster.</p>
              </div>
              <button
                type="button"
                className="text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900"
                onClick={() => setIsResolutionModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {REFINE_RESOLUTION_OPTIONS.map((option) => {
                const isChecked = selectedRefineResolutions.has(option.id);
                return (
                  <label key={option.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      checked={isChecked}
                      onChange={() => {
                        setSelectedRefineResolutions((prev) => {
                          const next = new Set(prev);
                          if (next.has(option.id)) {
                            next.delete(option.id);
                          } else {
                            next.add(option.id);
                          }
                          return next;
                        });
                      }}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                className="flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border border-slate-200 text-slate-600 hover:bg-slate-50"
                onClick={() => setIsResolutionModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-widest bg-black text-white disabled:opacity-50"
                onClick={handleGenerateResolutions}
                disabled={selectedRefineResolutions.size === 0 || isGeneratingResolutions}
              >
                {isGeneratingResolutions ? 'Generating' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {assetContextMenu && (
        <div
          className="fixed inset-0 z-[80]"
          onClick={() => setAssetContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setAssetContextMenu(null);
          }}
        >
          <div
            className="absolute w-44 rounded-lg border border-slate-200 bg-white shadow-xl py-1"
            style={{ left: assetContextMenu.x, top: assetContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
              onClick={handleContextDownload}
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 hover:bg-rose-50"
              onClick={handleContextDelete}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      )}

      {canvasContextMenu && (
        <div
          className="fixed inset-0 z-[75]"
          onClick={() => setCanvasContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setCanvasContextMenu(null);
          }}
        >
          <div
            className="absolute w-36 rounded-lg border border-slate-200 bg-white shadow-xl py-1"
            style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                addCanvasNoteAssetAt(canvasContextMenu.worldX, canvasContextMenu.worldY);
                setCanvasContextMenu(null);
              }}
            >
              Add Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
const ProjectCard: React.FC<{
  project: Project;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ project, onOpen, onDelete }) => {
  const updatedDate = new Date(project.updatedAt).toLocaleDateString();
  const previewUrls = (project.artboards || [])
    .map((board) => board.posterData?.imageUrlMerged || board.posterData?.imageUrl || null)
    .filter((url): url is string => Boolean(url));
  const previewItems = Array.from(new Set(previewUrls)).slice(0, 4);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="h-40 bg-gradient-to-br from-slate-100 to-slate-200 text-gray-400 text-xs font-semibold overflow-hidden">
        {previewItems.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center">
            {project.title.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className={`h-full w-full grid ${previewItems.length > 1 ? 'grid-cols-2' : ''} ${previewItems.length > 2 ? 'grid-rows-2' : ''}`}>
            {previewItems.map((url, index) => (
              <img
                key={`${project.id}-preview-${index}`}
                src={url}
                alt={`Preview ${index + 1}`}
                className="w-full h-full object-cover"
              />
            ))}
          </div>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{project.title}</h3>
          <p className="text-[10px] text-gray-500">Updated {updatedDate}</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>{project.width}x{project.height}</span>
          <span>•</span>
          <span>{project.artboards?.length || 0} boards</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpen(project.id)}
            className="flex-1 py-2 bg-black text-white text-xs font-bold rounded-lg"
          >
            Open
          </button>
          <button
            onClick={() => onDelete(project.id)}
            className="py-2 px-3 border border-gray-200 text-gray-500 text-xs font-bold rounded-lg hover:bg-gray-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{ icon: React.ReactNode; onClick: () => void; disabled?: boolean; tooltip?: string }> = ({ icon, onClick, disabled, tooltip }) => (
  <button
    className="p-2.5 text-slate-400 hover:text-black hover:bg-slate-50 rounded-lg transition-all disabled:opacity-10 group relative border border-transparent hover:border-slate-100"
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
    {tooltip && (
      <span className="absolute left-full ml-3 px-2 py-1 bg-slate-900 text-white text-[9px] font-bold rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-[100] transition-opacity">
        {tooltip}
      </span>
    )}
  </button>
);

const ArtboardComponent: React.FC<ArtboardProps> = ({ artboard, isSelected, isFadingIn, selectedAssetId, onSelect, onDragArtboard, onResizeArtboard, onDragAsset, onResizeAsset, onUpdateAssetContent, onOpenPoster, onOpenAssetContextMenu, onOpenPosterContextMenu }) => {
  const isDraggingArtboard = useRef(false);
  const isResizingArtboard = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const isPosterArtboard = Boolean(artboard.posterData);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null, e);
    isDraggingArtboard.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingArtboard.current) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        onDragArtboard(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
      if (isResizingArtboard.current) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        onResizeArtboard(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };
    const handleMouseUp = () => { isDraggingArtboard.current = false; isResizingArtboard.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onDragArtboard, onResizeArtboard]);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null, e);
    isResizingArtboard.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  return (
    <div
      className={`absolute flex flex-col transition-shadow duration-300 ${isSelected ? 'z-40' : 'z-30 shadow-xl'} ${isFadingIn ? 'artboard-fade-in' : ''}`}
      style={{
        left: artboard.x,
        top: artboard.y,
        width: artboard.width,
        height: artboard.height
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(null, e); }}
    >
      <div
        className={`h-8 flex items-center justify-between px-3 rounded-t-lg cursor-grab active:cursor-grabbing border border-slate-200 border-b-0 ${isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500'}`}
        onMouseDown={handleHeaderMouseDown}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider truncate">{artboard.name}</span>
        <GripHorizontal className="w-3.5 h-3.5 opacity-40" />
      </div>

      <div className={`flex-1 relative overflow-hidden bg-white border border-slate-200 shadow-sm ${isSelected ? 'ring-2 ring-blue-500 border-transparent' : ''}`}>
        {isPosterArtboard ? (
          <button
            type="button"
            className="w-full h-full cursor-pointer bg-transparent p-0 border-0"
            onClick={(e) => { e.stopPropagation(); onSelect(null, e); onOpenPoster(artboard.id); }}
            onContextMenu={(e) => onOpenPosterContextMenu(e)}
          >
            <PosterCard poster={artboard.posterData!} onEdit={() => onOpenPoster(artboard.id)} isLarge />
          </button>
        ) : (
          artboard.assets.map(asset => (
            <AssetComponent
              key={asset.id}
              asset={asset}
              isSelected={selectedAssetId === asset.id}
              onSelect={(event) => onSelect(asset.id, event)}
              onDrag={(dx, dy) => onDragAsset(asset.id, dx, dy)}
              onResize={(dw, dh) => onResizeAsset(asset.id, dw, dh)}
              onContextMenu={(event) => onOpenAssetContextMenu(asset.id, event)}
              onUpdateContent={(content) => onUpdateAssetContent(asset.id, content)}
            />
          ))
        )}

        {isPosterArtboard && isSelected && (
          <div
            className="absolute -bottom-2 -right-2 w-10 h-10 cursor-nwse-resize z-[100]"
            onMouseDown={handleResizeMouseDown}
          >
            <div className="absolute bottom-2 right-2 w-3 h-3 rounded-sm bg-white/90 border border-slate-300 shadow" />
          </div>
        )}
      </div>
    </div>
  );
};

interface ArtboardProps {
  artboard: Artboard;
  isSelected: boolean;
  isFadingIn: boolean;
  selectedAssetId: string | null;
  onSelect: (assetId: string | null, event: React.MouseEvent) => void;
  onDragArtboard: (dx: number, dy: number) => void;
  onResizeArtboard: (dw: number, dh: number) => void;
  onDragAsset: (assetId: string, dx: number, dy: number) => void;
  onResizeAsset: (assetId: string, dw: number, dh: number) => void;
  onUpdateAssetContent: (assetId: string, content: string) => void;
  onOpenPoster: (artboardId: string) => void;
  onOpenAssetContextMenu: (assetId: string, event: React.MouseEvent) => void;
  onOpenPosterContextMenu: (event: React.MouseEvent) => void;
}

const AssetComponent: React.FC<AssetProps> = ({ asset, isSelected, onSelect, onDrag, onResize, onContextMenu, onUpdateContent }) => {
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const parseNoteContent = (content: string) => {
    const parts = content.split('\n');
    if (parts.length <= 1) {
      return { title: 'Note', body: content };
    }
    return { title: parts[0] || 'Note', body: parts.slice(1).join('\n') };
  };

  const composeNoteContent = (title: string, body: string) => {
    const safeTitle = title.trim() || 'Note';
    return `${safeTitle}\n${body ?? ''}`;
  };

  useEffect(() => {
    if (asset.type !== 'note') return;
    if (isEditingTitle || isEditingBody) return;
    const parsed = parseNoteContent(asset.content || '');
    setDraftTitle(parsed.title);
    setDraftBody(parsed.body);
  }, [asset.content, asset.type, isEditingTitle, isEditingBody]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isResizing.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const dx = (e.clientX - lastPos.current.x);
        const dy = (e.clientY - lastPos.current.y);
        onDrag(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
      if (isResizing.current) {
        const dx = (e.clientX - lastPos.current.x);
        const dy = (e.clientY - lastPos.current.y);
        onResize(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };
    const handleMouseUp = () => { isDragging.current = false; isResizing.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onDrag, onResize]);

  return (
    <div
      className={`absolute group cursor-move select-none ${isSelected ? 'ring-2 ring-blue-500 shadow-lg z-50' : 'hover:ring-1 hover:ring-blue-200'}`}
      style={{
        left: asset.x,
        top: asset.y,
        width: asset.width,
        height: asset.height,
        zIndex: asset.zIndex
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={(event) => {
        onSelect(event);
        onContextMenu(event);
      }}
    >
      {asset.type === 'text' ? (
        <div
          className="w-full h-full flex items-center justify-center text-center p-3 leading-tight"
          style={{ fontSize: asset.fontSize, color: asset.color, fontWeight: asset.fontWeight, whiteSpace: 'pre-wrap' }}
        >
          {asset.content}
        </div>
      ) : asset.type === 'note' ? (
        <div className="w-full h-full bg-amber-100 border border-amber-300 rounded-lg p-3 overflow-hidden shadow-sm">
          <div className="text-[9px] font-bold uppercase tracking-widest text-amber-600 mb-1.5 flex items-center gap-1">
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            {isEditingTitle ? (
              <input
                className="flex-1 bg-white/70 border border-amber-300 rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-700"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => {
                  onUpdateContent(composeNoteContent(draftTitle, draftBody));
                  setIsEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onUpdateContent(composeNoteContent(draftTitle, draftBody));
                    setIsEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    const parsed = parseNoteContent(asset.content || '');
                    setDraftTitle(parsed.title);
                    setIsEditingTitle(false);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const parsed = parseNoteContent(asset.content || '');
                  setDraftTitle(parsed.title);
                  setDraftBody(parsed.body);
                  setIsEditingTitle(true);
                }}
                title="Double click to edit title"
                className="cursor-text"
              >
                {parseNoteContent(asset.content || '').title}
              </span>
            )}
          </div>
          <div
            className="text-[11px] text-amber-900 leading-relaxed overflow-auto"
            style={{ maxHeight: 'calc(100% - 24px)', whiteSpace: 'pre-wrap' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const parsed = parseNoteContent(asset.content || '');
              setDraftTitle(parsed.title);
              setDraftBody(parsed.body);
              setIsEditingBody(true);
            }}
          >
            {isEditingBody ? (
              <textarea
                className="w-full h-full min-h-[60px] bg-white/70 border border-amber-300 rounded p-2 text-[11px] text-amber-900 leading-relaxed"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                onBlur={() => {
                  onUpdateContent(composeNoteContent(draftTitle, draftBody));
                  setIsEditingBody(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    const parsed = parseNoteContent(asset.content || '');
                    setDraftBody(parsed.body);
                    setIsEditingBody(false);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span title="Double click to edit note">{parseNoteContent(asset.content || '').body}</span>
            )}
          </div>
        </div>
      ) : asset.type === 'image' && asset.content ? (
        <img src={asset.content} className="w-full h-full object-contain bg-slate-50 pointer-events-none" alt="" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 bg-slate-100 border border-dashed border-slate-300">
          No image
        </div>
      )}

      {isSelected && (
        <div
          className="absolute -bottom-1 -right-1 w-6 h-6 bg-transparent cursor-nwse-resize z-[100]"
          onMouseDown={handleResizeMouseDown}
        ></div>
      )}
    </div>
  );
};

interface AssetProps {
  asset: Asset;
  isSelected: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onDrag: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onUpdateContent: (content: string) => void;
}

interface CanvasAssetProps {
  asset: Asset;
  isSelected: boolean;
  isFading: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onDrag: (dx: number, dy: number) => void;
  onResize: (dw: number, dh: number) => void;
  onDelete: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onUpdateContent: (content: string) => void;
}

const CanvasAssetComponent: React.FC<CanvasAssetProps> = ({ asset, isSelected, isFading, onSelect, onDrag, onResize, onDelete, onContextMenu, onUpdateContent }) => {
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingBody, setIsEditingBody] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    isResizing.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        onDrag(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
      if (isResizing.current) {
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        onResize(dx, dy);
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };
    const handleMouseUp = () => { isDragging.current = false; isResizing.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onDrag, onResize]);

  const isGroupBackground = asset.id.startsWith('group-bg-');

  const parseNoteContent = (content: string) => {
    const parts = content.split('\n');
    if (parts.length <= 1) {
      return { title: 'Note', body: content };
    }
    return { title: parts[0] || 'Note', body: parts.slice(1).join('\n') };
  };

  const composeNoteContent = (title: string, body: string) => {
    const safeTitle = title.trim() || 'Note';
    return `${safeTitle}\n${body ?? ''}`;
  };

  useEffect(() => {
    if (asset.type !== 'note') return;
    if (isEditingTitle || isEditingBody) return;
    const parsed = parseNoteContent(asset.content || '');
    setDraftTitle(parsed.title);
    setDraftBody(parsed.body);
  }, [asset.content, asset.type, isEditingTitle, isEditingBody]);

  const renderContent = () => {
    // Group background container
    if (isGroupBackground) {
      return (
        <div className="w-full h-full bg-slate-100 border-2 border-slate-300 rounded-xl overflow-hidden shadow-lg">
          <div className="h-8 bg-slate-200 border-b border-slate-300 flex items-center justify-between px-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-2">
              <span className="w-2 h-2 bg-slate-500 rounded-full" />
              Group
            </div>
            <div className="flex gap-0.5 opacity-40">
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
              <span className="w-1 h-1 bg-slate-500 rounded-full" />
            </div>
          </div>
        </div>
      );
    }
    if (asset.type === 'note') {
      return (
        <div className="w-full h-full bg-amber-100 border border-amber-300 rounded-lg p-3 overflow-hidden shadow-md">
          <div className="text-[9px] font-bold uppercase tracking-widest text-amber-600 mb-1.5 flex items-center gap-1">
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            {isEditingTitle ? (
              <input
                className="flex-1 bg-white/70 border border-amber-300 rounded px-1 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-700"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => {
                  onUpdateContent(composeNoteContent(draftTitle, draftBody));
                  setIsEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onUpdateContent(composeNoteContent(draftTitle, draftBody));
                    setIsEditingTitle(false);
                  } else if (e.key === 'Escape') {
                    const parsed = parseNoteContent(asset.content || '');
                    setDraftTitle(parsed.title);
                    setIsEditingTitle(false);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const parsed = parseNoteContent(asset.content || '');
                  setDraftTitle(parsed.title);
                  setDraftBody(parsed.body);
                  setIsEditingTitle(true);
                }}
                title="Double click to edit title"
                className="cursor-text"
              >
                {parseNoteContent(asset.content || '').title}
              </span>
            )}
          </div>
          <div
            className="text-[11px] text-amber-900 leading-relaxed overflow-auto"
            style={{ maxHeight: 'calc(100% - 24px)', whiteSpace: 'pre-wrap' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const parsed = parseNoteContent(asset.content || '');
              setDraftTitle(parsed.title);
              setDraftBody(parsed.body);
              setIsEditingBody(true);
            }}
          >
            {isEditingBody ? (
              <textarea
                className="w-full h-full min-h-[60px] bg-white/70 border border-amber-300 rounded p-2 text-[11px] text-amber-900 leading-relaxed"
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                onBlur={() => {
                  onUpdateContent(composeNoteContent(draftTitle, draftBody));
                  setIsEditingBody(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    const parsed = parseNoteContent(asset.content || '');
                    setDraftBody(parsed.body);
                    setIsEditingBody(false);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                autoFocus
              />
            ) : (
              <span title="Double click to edit note">{parseNoteContent(asset.content || '').body}</span>
            )}
          </div>
        </div>
      );
    }
    if (asset.type === 'image' && asset.content) {
      const isLogo = asset.groupId?.includes('logo');
      return (
        <div className={`w-full h-full rounded-lg overflow-hidden shadow-md border ${isLogo ? 'border-purple-300 bg-purple-50' : 'border-blue-300 bg-blue-50'}`}>
          <div className={`text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 flex items-center gap-1 ${isLogo ? 'text-purple-600 bg-purple-100' : 'text-blue-600 bg-blue-100'}`}>
            <span className={`w-2 h-2 rounded-full ${isLogo ? 'bg-purple-400' : 'bg-blue-400'}`} />
            {isLogo ? 'Logo' : 'Uploaded'}
          </div>
          <img src={asset.content} className="w-full h-[calc(100%-28px)] object-contain bg-white" alt="" />
        </div>
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 bg-slate-100 border border-dashed border-slate-300 rounded-lg">
        No content
      </div>
    );
  };

  return (
    <div
      className={`absolute group select-none ${isGroupBackground ? 'cursor-grab active:cursor-grabbing' : 'cursor-move hover:ring-2 hover:ring-blue-400'} ${isSelected ? 'ring-2 ring-blue-500 shadow-lg z-40' : ''} ${isFading ? 'artboard-fade-in' : ''}`}
      style={{
        left: asset.x,
        top: asset.y,
        width: asset.width,
        height: asset.height,
        zIndex: asset.zIndex
      }}
      onMouseDown={handleMouseDown}
      onContextMenu={(event) => {
        onSelect(event);
        onContextMenu(event);
      }}
    >
      {renderContent()}
      {!isGroupBackground && (
        <>
          <button
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Delete"
          >
            ×
          </button>
          <div
            className="absolute -bottom-1 -right-1 w-5 h-5 bg-transparent cursor-nwse-resize opacity-0 group-hover:opacity-100"
            onMouseDown={handleResizeMouseDown}
          >
            <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-slate-400" />
          </div>
        </>
      )}
    </div>
  );
};

interface ConnectionLineProps {
  connection: Connection;
  canvasAssets: Asset[];
  artboards: Artboard[];
}

const ConnectionLine: React.FC<ConnectionLineProps> = ({ connection, canvasAssets, artboards }) => {
  const getElementRect = (id: string, type: 'asset' | 'artboard') => {
    if (type === 'asset') {
      const asset = canvasAssets.find(a => a.id === id);
      if (asset) return { x: asset.x, y: asset.y, width: asset.width, height: asset.height };
    } else {
      const artboard = artboards.find(a => a.id === id);
      if (artboard) return { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height };
    }
    return null;
  };

  const fromRect = getElementRect(connection.fromId, connection.fromType);
  const toRect = getElementRect(connection.toId, connection.toType);

  if (!fromRect || !toRect) return null;

  // Calculate connection points - from right edge of source to left edge of target
  const fromX = fromRect.x + fromRect.width;
  const fromY = fromRect.y + fromRect.height / 2;
  const toX = toRect.x;
  const toY = toRect.y + toRect.height / 2;

  // Create orthogonal path with 90-degree turns
  const midX = fromX + (toX - fromX) / 2;

  // Build SVG path for orthogonal routing
  const path = `M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX - 8}`;

  // Arrow head points
  const arrowSize = 6;
  const arrowPath = `M ${toX - 8} ${toY - arrowSize} L ${toX} ${toY} L ${toX - 8} ${toY + arrowSize}`;

  // Calculate SVG viewBox bounds
  const minX = Math.min(fromX, toX) - 20;
  const minY = Math.min(fromY, toY) - 20;
  const maxX = Math.max(fromX, toX) + 20;
  const maxY = Math.max(fromY, toY) + 20;
  const svgWidth = maxX - minX;
  const svgHeight = maxY - minY;

  return (
    <svg
      className="absolute pointer-events-none"
      style={{
        left: minX,
        top: minY,
        width: svgWidth,
        height: svgHeight,
        zIndex: 10,
        overflow: 'visible'
      }}
    >
      <g transform={`translate(${-minX}, ${-minY})`}>
        <path
          d={path}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={arrowPath}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

const FontsPreview: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog 0123456789');
  const [filterText, setFilterText] = useState('');
  const [fonts, setFonts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadFonts = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await fetch(`${FONT_PREVIEW_API}/fonts`);
        if (!response.ok) {
          throw new Error(`Font service error: ${response.status}`);
        }
        const data = await response.json() as { fonts?: string[] };
        setFonts(data.fonts || []);
      } catch (err) {
        setError('Failed to load fonts from backend.');
      } finally {
        setLoading(false);
      }
    };
    loadFonts();
  }, []);

  const filteredFonts = fonts.filter(entry =>
    entry.toLowerCase().includes(filterText.trim().toLowerCase())
  );

  const buildPreviewUrl = (fontName: string) => {
    const params = new URLSearchParams({
      font: fontName,
      text: sampleText || 'Sample text...',
      size: '72',
      width: '1200',
      height: '360',
      padding: '40',
      color: '#111827',
      background: '#ffffff'
    });
    return `${FONT_PREVIEW_API}/fonts/preview?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#fbfbfc] text-slate-900">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Fonts Preview</div>
            <h1 className="text-2xl font-bold text-slate-900">Backend Font Library</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-50"
            >
              Back to App
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,280px] gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sample Text</label>
            <textarea
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm leading-relaxed focus:ring-1 focus:ring-blue-500 outline-none resize-none"
              rows={3}
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Filter</label>
            <input
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
              placeholder="Search by filename..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading fonts from backend...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-600">
            {error}
          </div>
        ) : filteredFonts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No fonts found in backend.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredFonts.map(entry => (
              <div key={entry} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{entry}</div>
                    <div className="text-[11px] text-slate-500">{entry}</div>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <img src={buildPreviewUrl(entry)} alt={`${entry} preview`} className="w-full h-auto block" />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
