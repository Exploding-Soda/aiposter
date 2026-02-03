
import { PlanningStep } from "../types";
import { fetchWithAuth } from "./authService";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

const ensureDataUrl = async (value: string): Promise<string> => {
  if (value.startsWith("data:image/")) return value;
  const response = await fetch(value);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for chat: ${response.status}`);
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image as data URL."));
    reader.readAsDataURL(blob);
  });
};

const BACKEND_API = import.meta.env.VITE_BACKEND_API || "http://localhost:8001";

// Async task types
export type AITaskStatus = 'pending' | 'running' | 'completed' | 'error';

export type AITaskResult = {
  taskId: string;
  status: AITaskStatus;
  result?: PoloResponse;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type PendingTask = {
  taskId: string;
  taskType: string;
  status: AITaskStatus;
  createdAt: string;
  startedAt?: string;
};

// Submit an async AI task
export const submitAITask = async (payload: Record<string, unknown>): Promise<string> => {
  const response = await fetchWithAuth(`${BACKEND_API}/ai/task/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskType: "chat",
      payload
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to submit AI task: ${response.status}`);
  }

  const data = await response.json();
  return data.taskId;
};

// Poll for task status
export const getAITaskStatus = async (taskId: string): Promise<AITaskResult> => {
  const response = await fetchWithAuth(`${BACKEND_API}/ai/task/${taskId}/status`);

  if (!response.ok) {
    throw new Error(`Failed to get task status: ${response.status}`);
  }

  return response.json();
};

// Get all pending tasks for current user
export const getPendingAITasks = async (): Promise<PendingTask[]> => {
  const response = await fetchWithAuth(`${BACKEND_API}/ai/tasks/pending`);

  if (!response.ok) {
    throw new Error(`Failed to get pending tasks: ${response.status}`);
  }

  const data = await response.json();
  return data.tasks || [];
};

// Poll until task completes or times out
export const waitForAITask = async (
  taskId: string,
  onProgress?: (status: AITaskResult) => void,
  pollIntervalMs = 2000,
  timeoutMs = 300000 // 5 minutes default
): Promise<AITaskResult> => {
  const startTime = Date.now();

  while (true) {
    const result = await getAITaskStatus(taskId);
    onProgress?.(result);

    if (result.status === 'completed' || result.status === 'error') {
      return result;
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Task timeout');
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
};

type PoloMessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

type PoloResponse = {
  choices?: Array<{
    message?: {
      content?: PoloMessageContent;
    };
  }>;
};

const extractTextContent = (content: PoloMessageContent | undefined): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  const textPart = content.find((part) => part.type === "text");
  return textPart?.text || "";
};

const sanitizeJsonResponse = (content: string): string => {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
};

const extractImageUrl = (content: PoloMessageContent | undefined): string | null => {
  if (!content) return null;
  if (Array.isArray(content)) {
    const imagePart = content.find((part) => part.type === "image_url");
    return imagePart?.image_url?.url || null;
  }
  if (typeof content === "string" && content.startsWith("data:image/")) {
    return content;
  }
  if (typeof content === "string") {
    const markdownImage = content.match(/!\[[^\]]*]\((data:image\/[^)]+)\)/i);
    if (markdownImage?.[1]) {
      return markdownImage[1];
    }
    try {
      const parsed = JSON.parse(content) as { image_url?: { url?: string } };
      return parsed?.image_url?.url || null;
    } catch {
      return null;
    }
  }
  return null;
};

const callPoloApi = async (payload: Record<string, unknown>): Promise<PoloResponse> => {
  const response = await fetchWithAuth(`${BACKEND_API}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json().catch(() => ({}))) as PoloResponse;
  if (!response.ok) {
    const errorText = JSON.stringify(data);
    throw new Error(`PoloAPI request failed (${response.status}): ${errorText}`);
  }

  return data;
};

export const planPosters = async (
  userInput: string,
  count: number,
  styleImages: string[] = [],
  logoUrl?: string | null
): Promise<PlanningStep[]> => {
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: `You are an elite creative director and professional poster designer.

The user provided the following requirements for a poster: "${userInput}".

Parse and extract all specific details, including:
- Event name/theme.
- Location and dates/times.
- Artistic style references (e.g., minimalist, cyberpunk, retro, WONG Kar-wai).
- Required copy/text.
- Mood/emotional tone.

The user may provide style reference images. Use them only as style guidance and do NOT copy the exact image content.
The user may also provide a brand logo reference image. If provided, account for tasteful logo placement but do not describe or alter the logo content.

Create ${count} distinct, professional poster concepts that strictly follow every requirement.
The overall layout should feel like high-end theatrical or cinematic posters.

Output JSON only. Each item must include:
- visualPrompt: a SHORT 1-2 sentence description (max 25 words) for the background image only (no typography or text described). Example: "The poster includes Easter eggs, a rabbit, and spring elements. The text wishes a happy Easter and focuses on renewal and celebration."
- topBanner: short all-caps banner copy.
- headline: main title.
- subheadline: secondary title/description.
- infoBlock: object with orgName, details (date/time/location), and credits.
- accentColor: a professional hex color code (e.g., #A11F2B).

Return ONLY a valid JSON array with ${count} items. No extra commentary, no markdown.`
    }
  ];

  styleImages.forEach((url) => {
    if (url && url.startsWith("data:image/")) {
      messageContent.push({ type: "image_url", image_url: { url } });
    }
  });
  if (logoUrl && logoUrl.startsWith("data:image/")) {
    messageContent.push({ type: "image_url", image_url: { url: logoUrl } });
  }

  const response = await callPoloApi({
    model: "gemini-2.5-flash",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  });

  try {
    const content = extractTextContent(response.choices?.[0]?.message?.content);
    const sanitized = sanitizeJsonResponse(content || "[]");
    return JSON.parse(sanitized || "[]");
  } catch (e) {
    console.error("Failed to parse planning response", e);
    return [];
  }
};

const buildImagePrompt = (
  poster: PlanningStep,
  logoUrl?: string | null,
  fontReferenceUrl?: string | null,
  targetSize?: { width: number; height: number; label?: string }
): string => {
  return poster.visualPrompt?.trim() || "";
};

export const generatePosterImage = async (
  poster: PlanningStep,
  styleImages: string[] = [],
  logoUrl?: string | null,
  fontReferenceUrl?: string | null,
  targetSize?: { width: number; height: number; label?: string },
  userPrompt?: string,
  extraPrompt?: string
): Promise<string> => {
  const payload = buildGeneratePosterPayload(
    poster,
    styleImages,
    logoUrl,
    fontReferenceUrl,
    targetSize,
    userPrompt,
    extraPrompt
  );
  const response = await callPoloApi(payload);

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    return imageUrl;
  }
  throw new Error("No image data received");
};

// Build the payload for generatePosterImage (shared between sync and async versions)
const buildGeneratePosterPayload = (
  poster: PlanningStep,
  styleImages: string[] = [],
  logoUrl?: string | null,
  fontReferenceUrl?: string | null,
  targetSize?: { width: number; height: number; label?: string },
  userPrompt?: string,
  extraPrompt?: string
): Record<string, unknown> => {
  const userPrefix = userPrompt?.trim() ? `${userPrompt.trim()} ` : "";
  const fontPrefix = fontReferenceUrl && fontReferenceUrl.startsWith("data:image/")
    ? "Generate a new poster using the font style shown in Image 2. "
    : "";
  const hasStyleReference = styleImages.some((url) => url && url.startsWith("data:image/"));
  const styleInstruction = hasStyleReference
    ? "Match the poster style shown in Image 1."
    : "";
  const extraInstruction = extraPrompt?.trim()
    ? `Additional design guidance: ${extraPrompt.trim()}`
    : "";
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: [
        `${userPrefix}${fontPrefix}`.trim(),
        "Create a vertical 9:16 poster.",
        buildImagePrompt(poster, logoUrl, fontReferenceUrl, targetSize),
        styleInstruction,
        extraInstruction
      ]
        .filter(Boolean)
        .join(" ")
    }
  ];

  styleImages.forEach((url) => {
    if (url && url.startsWith("data:image/")) {
      messageContent.push({ type: "image_url", image_url: { url } });
    }
  });
  if (logoUrl && logoUrl.startsWith("data:image/")) {
    messageContent.push({ type: "image_url", image_url: { url: logoUrl } });
  }
  if (fontReferenceUrl && fontReferenceUrl.startsWith("data:image/")) {
    messageContent.push({ type: "image_url", image_url: { url: fontReferenceUrl } });
  }

  return {
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  };
};

// Async version: submit task and return taskId immediately
export const generatePosterImageAsync = async (
  poster: PlanningStep,
  styleImages: string[] = [],
  logoUrl?: string | null,
  fontReferenceUrl?: string | null,
  targetSize?: { width: number; height: number; label?: string },
  userPrompt?: string,
  extraPrompt?: string
): Promise<string> => {
  const payload = buildGeneratePosterPayload(
    poster,
    styleImages,
    logoUrl,
    fontReferenceUrl,
    targetSize,
    userPrompt,
    extraPrompt
  );
  return submitAITask(payload);
};

// Extract image URL from task result
export const extractImageFromTaskResult = (result: AITaskResult): string | null => {
  if (result.status !== 'completed' || !result.result) {
    return null;
  }
  return extractImageUrl(result.result.choices?.[0]?.message?.content);
};

export const generatePosterNoTextImage = async (posterImageUrl: string): Promise<string> => {
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: "Remove all poster elements from the provided image and keep only the background environment. Eliminate all text, logos, banners, overlays, and graphic elements so the result is a clean background-only scene. Preserve composition, lighting, and colors. Output a clean background-only version with strictly NO TEXT."
    },
    {
      type: "image_url",
      image_url: { url: posterImageUrl }
    }
  ];

  const response = await callPoloApi({
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  });

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    return imageUrl;
  }
  throw new Error("No image data received");
};

export const generatePosterMergedImage = async (
  originalImageUrl: string,
  layoutImageUrl: string
): Promise<string> => {
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: "Replace the text in image 1 using only the letterforms from image 2 (font shape, weight, size, color, tracking, line breaks). Keep all text boxes, panels, background patterns, and textures exactly as in image 1. Do NOT add new decorations; only swap the glyphs."
    },
    {
      type: "image_url",
      image_url: { url: originalImageUrl }
    },
    {
      type: "image_url",
      image_url: { url: layoutImageUrl }
    }
  ];

  const response = await callPoloApi({
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  });

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    return imageUrl;
  }
  throw new Error("No image data received");
};

export const generateImageFromPrompt = async (
  prompt: string,
  referenceImages: string[] = []
): Promise<string> => {
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: prompt.trim()
    }
  ];

  referenceImages.forEach((url) => {
    if (url && url.startsWith("data:image/")) {
      messageContent.push({ type: "image_url", image_url: { url } });
    }
  });

  const response = await callPoloApi({
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  });

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    return imageUrl;
  }
  throw new Error("No image data received");
};

export const refinePoster = async (
  currentPoster: PlanningStep,
  feedback: string
): Promise<PlanningStep> => {
  /**
   * CRITICAL: Strip the base64 image data and other unnecessary UI state properties 
   * before sending the object to the model. Base64 strings can contain millions 
   * of characters, which translates to millions of tokens, exceeding the API's 
   * input token limit and causing 400 errors.
   */
  const { 
    imageUrl, 
    logoUrl,
    id, 
    status, 
    error, 
    ...cleanPosterMetadata 
  } = currentPoster as any;

  const response = await callPoloApi({
    model: "gemini-2.5-flash",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Refine this poster design based on feedback.
Current Design Metadata: ${JSON.stringify(cleanPosterMetadata)}
User Feedback/Request: ${feedback}

Preserve all core requirements (like location/dates) unless the user explicitly asks to change them.
    Make incremental updates to visualPrompt, accentColor, and copy fields when requested.
Provide ONLY the updated full design JSON object, no extra commentary or markdown.`
          }
        ]
      }
    ]
  });

  try {
    const content = extractTextContent(response.choices?.[0]?.message?.content);
    const sanitized = sanitizeJsonResponse(content || "{}");
    return JSON.parse(sanitized || "{}");
  } catch (e) {
    console.error("Failed to parse refinement response", e);
    throw new Error("Failed to iterate design. Please try again.");
  }
};

export const editPosterWithMarkup = async (
  originalImageUrl: string,
  markedImageUrl: string,
  instructions: string,
  referenceImageUrl?: string | null
): Promise<string> => {
  const originalDataUrl = await ensureDataUrl(originalImageUrl);
  const markedDataUrl = await ensureDataUrl(markedImageUrl);
  const referenceDataUrl = referenceImageUrl ? await ensureDataUrl(referenceImageUrl) : null;
  console.log('[edit] sending markup edit', {
    originalLength: originalDataUrl?.length,
    markedLength: markedDataUrl?.length,
    instructions,
    hasReference: Boolean(referenceDataUrl)
  });
  const referenceBlock = referenceDataUrl
    ? "Image 3 is an optional reference provided by the user. Use it as guidance for the requested changes, but do not copy it directly."
    : "";
  const response = await callPoloApi({
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You will receive two images: image 1 is the original poster, image 2 is the same poster with numbered boxes/arrows. ${referenceBlock} Apply the requested edits to the original while preserving overall composition and typography unless specified. The final output must NOT include any annotation boxes, arrows, or numbers. ${instructions}`
          },
          {
            type: "image_url",
            image_url: { url: originalDataUrl }
          },
          {
            type: "image_url",
            image_url: { url: markedDataUrl }
          },
          ...(referenceDataUrl ? [{
            type: "image_url",
            image_url: { url: referenceDataUrl }
          }] : [])
        ]
      }
    ]
  });

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    console.log('[edit] received edited image');
    return imageUrl;
  }
  throw new Error("No image data received");
};

export const generatePosterResolutionFromImage = async (
  posterImageUrl: string,
  targetSize: { width: number; height: number }
): Promise<string> => {
  const dataUrl = await ensureDataUrl(posterImageUrl);
  const messageContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    {
      type: "text",
      text: `Resize the provided image to ${targetSize.width}x${targetSize.height}. Do not change any content, text, colors, or composition. Only scale to fit; do not crop. If aspect ratio differs, add neutral padding to preserve the full image.`
    },
    {
      type: "image_url",
      image_url: { url: dataUrl }
    }
  ];

  const response = await callPoloApi({
    model: "gemini-3-pro-image-preview",
    stream: false,
    messages: [
      {
        role: "user",
        content: messageContent
      }
    ]
  });

  const imageUrl = extractImageUrl(response.choices?.[0]?.message?.content);
  if (imageUrl) {
    return imageUrl;
  }
  throw new Error("No image data received");
};

export const chatWithModel = async (messages: ChatMessage[]): Promise<string> => {
  const resolvedMessages = await Promise.all(
    messages.map(async (message) => {
      const images = message.images || [];
      if (images.length === 0) return message;
      const resolvedImages = await Promise.all(images.map(ensureDataUrl));
      return { ...message, images: resolvedImages };
    })
  );
  const response = await callPoloApi({
    model: "gemini-2.5-flash",
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: "You are a concise, helpful creative assistant for poster projects. Keep responses short, clear, and actionable."
          }
        ]
      },
      ...resolvedMessages.map((message) => ({
        role: message.role,
        content: [
          {
            type: "text",
            text: message.content
          },
          ...(message.images || []).map((url) => ({
            type: "image_url",
            image_url: { url }
          }))
        ]
      }))
    ]
  });

  const content = extractTextContent(response.choices?.[0]?.message?.content);
  return content || "";
};
