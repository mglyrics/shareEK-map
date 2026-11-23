import { supabase } from '../integrations/supabase/client';

export type PrivateBucketName = 'property-images' | 'property-documents' | 'admin-reports';

const SIGNED_URL_TTL_SECONDS = 1800; // 30 minutes
const CACHE_BUFFER_MS = 60_000;

interface CachedSignedUrl {
  url: string;
  expiresAt: number;
}

const signedUrlCache = new Map<string, CachedSignedUrl>();

function isDirectStaticUrl(path: string): boolean {
  return (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('/src/') ||
    path.startsWith('/assets/') ||
    path.startsWith('data:')
  );
}

export async function getSignedUrl(
  bucket: PrivateBucketName,
  path: string | null | undefined,
  expiresInSeconds = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  if (!path) return '';
  if (isDirectStaticUrl(path)) return path;
  if (!supabase) return '';

  const cacheKey = `${bucket}:${path}`;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt - CACHE_BUFFER_MS > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return '';
  }

  signedUrlCache.set(cacheKey, {
    url: data.signedUrl,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });

  return data.signedUrl;
}

export async function getSignedUrlsBatch(
  bucket: PrivateBucketName,
  paths: string[],
  expiresInSeconds = SIGNED_URL_TTL_SECONDS
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  const toFetch: string[] = [];

  for (const p of uniquePaths) {
    if (isDirectStaticUrl(p)) {
      result[p] = p;
      continue;
    }
    const cacheKey = `${bucket}:${p}`;
    const cached = signedUrlCache.get(cacheKey);
    if (cached && cached.expiresAt - CACHE_BUFFER_MS > Date.now()) {
      result[p] = cached.url;
    } else {
      toFetch.push(p);
    }
  }

  if (toFetch.length === 0 || !supabase) {
    return result;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(toFetch, expiresInSeconds);

  if (error || !data) {
    return result;
  }

  const expMs = Date.now() + expiresInSeconds * 1000;
  for (const item of data) {
    if (item.path && item.signedUrl) {
      result[item.path] = item.signedUrl;
      signedUrlCache.set(`${bucket}:${item.path}`, {
        url: item.signedUrl,
        expiresAt: expMs,
      });
    }
  }

  return result;
}

export interface PreparedPropertyImage {
  mainBlob: Blob;
  thumbBlob: Blob;
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
  extension: 'webp' | 'jpg' | 'png';
  widthPx: number;
  heightPx: number;
  fileSizeBytes: number;
}

const ALLOWED_IMAGE_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('تعذر قراءة ملف الصورة. تأكد من سلامة الصورة.'));
    };
    img.src = objectUrl;
  });
}

function renderScaledCanvas(
  img: HTMLImageElement,
  maxDimension: number,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('المتصفح لا يدعم معالجة الصور.'));
      return;
    }

    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('فشل ضغط الصورة قبل الرفع.'));
          return;
        }
        resolve({ blob, width, height });
      },
      mimeType,
      quality
    );
  });
}

export async function preparePropertyImageFile(file: File): Promise<PreparedPropertyImage> {
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    throw new Error('يُسمح فقط بصور WebP أو JPEG أو PNG.');
  }
  if (file.size > MAX_IMAGE_BYTES * 2) {
    throw new Error('حجم الصورة كبير جداً قبل المعالجة (الحد الأقصى 10 ميجابايت قبل الضغط).');
  }

  const img = await loadImageElement(file);
  // Output WebP (or fallback JPEG) constrained strictly within <= 1600px for schema check constraints
  let targetMime: 'image/webp' | 'image/jpeg' = 'image/webp';
  let extension: 'webp' | 'jpg' = 'webp';

  let main = await renderScaledCanvas(img, 1600, targetMime, 0.84);
  if (main.blob.type !== 'image/webp') {
    targetMime = 'image/jpeg';
    extension = 'jpg';
    main = await renderScaledCanvas(img, 1600, targetMime, 0.85);
  }

  if (main.blob.size > MAX_IMAGE_BYTES) {
    main = await renderScaledCanvas(img, 1280, targetMime, 0.72);
  }

  if (main.blob.size > MAX_IMAGE_BYTES) {
    throw new Error('حجم الصورة بعد الضغط لا يزال يتجاوز 5 ميجابايت.');
  }

  const thumb = await renderScaledCanvas(img, 480, targetMime, 0.75);

  return {
    mainBlob: main.blob,
    thumbBlob: thumb.blob,
    mimeType: targetMime,
    extension,
    widthPx: main.width,
    heightPx: main.height,
    fileSizeBytes: main.blob.size,
  };
}

export interface UploadedPropertyImage {
  storagePath: string;
  thumbnailPath: string;
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png';
  fileSizeBytes: number;
  widthPx: number;
  heightPx: number;
  signedUrl: string;
}

export async function uploadPropertyImagePair(
  userId: string,
  propertyId: string,
  file: File
): Promise<UploadedPropertyImage> {
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const prepared = await preparePropertyImageFile(file);
  const fileId = crypto.randomUUID();
  const storagePath = `${userId}/${propertyId}/${fileId}.${prepared.extension}`;
  const thumbnailPath = `${userId}/${propertyId}/${fileId}_thumb.${prepared.extension}`;

  const { error: mainErr } = await supabase.storage
    .from('property-images')
    .upload(storagePath, prepared.mainBlob, {
      contentType: prepared.mimeType,
      upsert: false,
    });

  if (mainErr) {
    throw new Error(`فشل رفع الصورة: ${mainErr.message}`);
  }

  const { error: thumbErr } = await supabase.storage
    .from('property-images')
    .upload(thumbnailPath, prepared.thumbBlob, {
      contentType: prepared.mimeType,
      upsert: false,
    });

  if (thumbErr) {
    await supabase.storage.from('property-images').remove([storagePath]);
    throw new Error(`فشل رفع الصورة المصغرة: ${thumbErr.message}`);
  }

  const signedUrl = await getSignedUrl('property-images', storagePath);

  return {
    storagePath,
    thumbnailPath,
    mimeType: prepared.mimeType,
    fileSizeBytes: prepared.fileSizeBytes,
    widthPx: prepared.widthPx,
    heightPx: prepared.heightPx,
    signedUrl,
  };
}

const ALLOWED_DOC_MIMES = new Set([
  'application/pdf',
  'image/webp',
  'image/jpeg',
  'image/png',
]);

export async function uploadPrivateDocument(
  userId: string,
  subfolder: 'authorizations' | 'receipts',
  file: File
): Promise<string> {
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }
  if (!ALLOWED_DOC_MIMES.has(file.type)) {
    throw new Error('يُسمح فقط بملفات PDF أو صور JPEG/PNG/WEBP للمستندات والإيصالات.');
  }
  if (file.size <= 0 || file.size > MAX_DOC_BYTES) {
    throw new Error('حجم المستند يجب أن يكون بين 1 بايت و 10 ميجابايت.');
  }

  const extMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
  };
  const ext = extMap[file.type] || 'bin';
  const storagePath = `${userId}/${subfolder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('property-documents')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`فشل رفع المستند: ${error.message}`);
  }

  return storagePath;
}

export async function removeStorageObjects(
  bucket: PrivateBucketName,
  paths: string[]
): Promise<void> {
  if (!supabase || paths.length === 0) return;
  const cleanPaths = paths.filter((p) => p && !isDirectStaticUrl(p));
  if (cleanPaths.length === 0) return;
  await supabase.storage.from(bucket).remove(cleanPaths);
}
