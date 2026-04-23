
export interface LogoPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PosterDraft {
  id: string;
  topBanner: string; // 顶部条文字
  headline: string;
  subheadline: string;
  infoBlock: {
    orgName: string;
    details: string; // 日期/地点
    credits: string; // 创作者
  };
  accentColor: string; // 强调色 (如：#7c2d12)
  visualPrompt: string;
  logoUrl?: string;
  logoPlacement?: LogoPlacement;
  imageUrl?: string;
  imageUrlNoText?: string;
  imageUrlMerged?: string;
  textLayout?: TextLayout;
  textStyles?: TextStyleMap;
  generationColorTune?: {
    enabled: boolean;
    colorGroupId?: string | null;
    colors?: string[];
    threshold?: number;
  };
  status: 'planning' | 'generating' | 'completed' | 'error';
  error?: string;
  taskId?: string; // Backend task ID for async generation tracking
}

export interface PlanningStep {
  topBanner: string;
  headline: string;
  subheadline: string;
  infoBlock: {
    orgName: string;
    details: string;
    credits: string;
  };
  accentColor: string;
  visualPrompt: string;
  logoUrl?: string;
  logoPlacement?: LogoPlacement;
}

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayout {
  topBanner: TextBox;
  headline: TextBox;
  subheadline: TextBox;
  infoBlock: TextBox;
}

export interface TextStyle {
  fontSize: number;
  color: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textDecoration: 'none' | 'underline';
  textAlign: 'left' | 'center' | 'right';
}

export interface TextStyleMap {
  topBanner: TextStyle;
  headline: TextStyle;
  subheadline: TextStyle;
  infoBlock: TextStyle;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PLANNING = 'PLANNING',
  GENERATING = 'GENERATING',
  READY = 'READY'
}

export interface Project {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  artboards?: Artboard[];
  styleImages?: string[];
  logoImage?: string | null;
  fontReferenceImage?: string | null;
  selectedReferenceStyleId?: string | null;
  selectedReferenceStyleStrength?: ReferenceStyleStrength;
  selectedRuleIds?: string[];
  selectedLogoAssetId?: string | null;
  selectedFontReferenceId?: string | null;
  canvasAssets?: Asset[];
  connections?: Connection[];
  view?: {
    x: number;
    y: number;
    zoom: number;
  };
}

export type ReferenceStyleStrength = 'low' | 'medium' | 'high';

export type LogoHandlingMode = 'model' | 'paste';

export interface ServerConfig {
  logoHandlingMode: LogoHandlingMode;
}

export type AssetType = 'text' | 'image' | 'note';

export interface Asset {
  id: string;
  type: AssetType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontSize?: number;
  color?: string;
  fontWeight?: string;
  zIndex: number;
  isProductionAsset?: boolean;
  groupId?: string;
}

export interface Connection {
  id: string;
  fromId: string;
  fromType: 'asset' | 'artboard';
  toId: string;
  toType: 'asset' | 'artboard';
  groupId?: string;
}

export interface Artboard {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assets: Asset[];
  posterData?: PosterDraft;
}

export interface Selection {
  artboardId: string | null;
  assetId: string | null;
}
