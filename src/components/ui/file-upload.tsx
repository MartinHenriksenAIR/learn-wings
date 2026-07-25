import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { downscaleImageFile, maxEdgeForUpload, type UploadAccept } from '@/lib/image-downscale';
import {
  checkSelectedFileSize,
  checkUploadFileType,
  checkUploadPayloadSize,
  effectiveMaxSizeMB,
  formatSizeMB,
  willDownscale,
  UPLOAD_ACCEPT_ATTRIBUTE,
  type UploadMessage,
} from '@/lib/upload-limits';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Upload, X, FileText, Video, Image as ImageIcon, Loader2 } from 'lucide-react';

interface FileUploadProps {
  /**
   * Declares upload intent so the backend routes the blob to the right
   * container. `org-logo`/`avatar` go to the public branding container;
   * omitted → the private default (videos, documents, thumbnails).
   */
  assetType?: 'org-logo' | 'avatar';
  folder?: string;
  accept?: UploadAccept;
  value?: string | null;
  onChange: (url: string | null, storagePath: string | null) => void;
  /**
   * Tightens the limit below the server cap for this call site (avatars ask for
   * 2 MB). Never widens it: `effectiveMaxSizeMB` clamps to the cap the backend
   * enforces, so the UI can't promise something the save would 413 on. Defaults
   * to the server cap for `accept`.
   */
  maxSizeMB?: number;
  className?: string;
  disabled?: boolean;
}

const fileIcons: Record<UploadAccept, React.ReactNode> = {
  image: <ImageIcon className="h-8 w-8 text-muted-foreground" />,
  video: <Video className="h-8 w-8 text-muted-foreground" />,
  document: <FileText className="h-8 w-8 text-muted-foreground" />,
};

const ctaKeys: Record<UploadAccept, string> = {
  image: 'fileUpload.ctaImage',
  video: 'fileUpload.ctaVideo',
  document: 'fileUpload.ctaDocument',
};

export function FileUpload({
  assetType,
  folder = '',
  accept = 'image',
  value,
  onChange,
  maxSizeMB,
  className,
  disabled = false,
}: FileUploadProps) {
  const { t } = useTranslation();
  const capMB = effectiveMaxSizeMB(accept, maxSizeMB);
  const maxEdge = maxEdgeForUpload(accept, assetType);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // Local preview of the just-uploaded image: the stored value is a raw blob
  // path, which <img> can't load without a signed URL (#158). `forValue` ties
  // the preview to the value it belongs to, so a parent-supplied value (e.g. a
  // pre-signed URL, or a reset) is never shadowed by a stale preview.
  const [preview, setPreview] = useState<{ url: string; forValue: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  // Drop the preview once the parent adopts a different value than the one it
  // was made for — e.g. a post-save refetch re-signs the path, or a consumer
  // stores a public URL instead of the blob path. Without this the object URL
  // lingers (invisibly) until unmount; clearing it lets the effect above revoke
  // it now. Safe because setPreview and the parent's onChange→value update batch
  // into one render, so a live preview is never seen as diverged.
  useEffect(() => {
    if (preview && preview.forValue !== value) setPreview(null);
  }, [value, preview]);

  const showMessage = (message: UploadMessage) => setError(t(message.key, message.values));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clearing the input is the single exit path for EVERY branch below,
    // including the early returns. A `change` event only fires when the value
    // changes, so leaving a rejected file in the input means re-picking the same
    // file after fixing nothing does nothing at all — the control looks dead.
    try {
      // Refuse what the server's mint endpoint would refuse, but with a message
      // that names the formats — the server's own answer is a bare
      // "File type not allowed".
      const typeError = checkUploadFileType(accept, file);
      if (typeError) {
        showMessage(typeError);
        return;
      }

      // Size is validated in TWO places, and the split is the point (#276/#278).
      // Here we only reject what could never work: for a file that is about to be
      // downscaled the bar is the decode ceiling, not the upload cap, because a
      // 15 MB photo destined to become a 200 KB thumbnail must be shrunk rather
      // than refused. The cap itself is applied further down, to the bytes that
      // will actually be PUT.
      const downscalable = willDownscale(accept, file.type);
      const selectionError = checkSelectedFileSize(file.size, capMB, downscalable);
      if (selectionError) {
        showMessage(selectionError);
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);
      setFileName(file.name);

      try {
        // Shrink oversized images before the PUT (#278). This runs first, while
        // the spinner is already showing and before the short-lived SAS URL is
        // minted, so a slow decode can't eat into that URL's validity window.
        // downscaleImageFile never throws, never hangs, and returns the original
        // file whenever downscaling is impossible, unprofitable or unsafe, so
        // `upload` is always safe — and its name/MIME type always match the
        // original, keeping the contentType handshake below unchanged.
        const upload = maxEdge === null ? file : await downscaleImageFile(file, maxEdge);

        // The cap, applied to what will ACTUALLY be uploaded — this is the check
        // that mirrors the server's post-upload HEAD, so clearing it is what makes
        // the eventual save succeed. It can still fire after a downscale: a format
        // we don't re-encode (animated GIF, SVG), a browser without a canvas
        // encoder, or a re-encode that came out no smaller all leave `upload ===
        // file`. Bailing here costs the user nothing — no SAS URL has been minted
        // and no bytes have been sent.
        const payloadError = checkUploadPayloadSize(upload.size, capMB);
        if (payloadError) {
          showMessage(payloadError);
          // Nothing was stored, so drop the name we optimistically adopted — with a
          // value already present the tile would otherwise label the OLD blob with
          // the REJECTED file's name.
          setFileName(null);
          return;
        }

        const uploadData = await callApi<{ uploadUrl: string; blobPath: string; contentType: string }>(
          '/api/azure-upload-url',
          { fileName: file.name, contentType: file.type, ...(assetType && { assetType }) }
        );

        if (!uploadData?.uploadUrl) throw new Error('Failed to get upload URL');

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
          };
          xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed with status ${xhr.status}`)));
          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.open('PUT', uploadData.uploadUrl);
          xhr.setRequestHeader('Content-Type', uploadData.contentType);
          xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
          xhr.send(upload);
        });

        setProgress(100);
        if (accept === 'image') {
          // Preview the bytes we actually stored, so what the user sees is what
          // the blob holds (identical to `file` when no downscale happened).
          setPreview({ url: URL.createObjectURL(upload), forValue: uploadData.blobPath });
        }
        onChange(uploadData.blobPath, uploadData.blobPath);
      } catch (err) {
        // The thrown text is diagnostic, not actionable, and is the one string
        // no translation could reach — log it and show the translated summary.
        console.error('Upload failed:', err);
        setError(t('fileUpload.errorUploadFailed'));
        // Deliberately NO `onChange(null, null)` here. Nothing was stored, so
        // whatever value the parent already holds still names a live blob — and
        // since #275 a persisted null is what DELETES that blob, so reporting a
        // dropped connection as "the field is now empty" would destroy the very
        // image the retry was meant to replace. `onChange(null, null)` therefore
        // has exactly ONE meaning in this component: the user cleared the field
        // (handleRemove). That is the distinction the save paths rely on.
        //
        // Drop the optimistically-adopted name for the same reason the
        // payload-cap bail above does: with a value still present, the tile would
        // otherwise label the OLD blob with the REJECTED file's name.
        setFileName(null);
      } finally {
        setUploading(false);
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setPreview(null);
    onChange(null, null);
    setFileName(null);
    setProgress(0);
  };

  const triggerUpload = () => {
    inputRef.current?.click();
  };

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE[accept]}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="relative border rounded-lg overflow-hidden">
          {accept === 'image' ? (
            <div className="relative aspect-video bg-muted">
              <img
                src={preview && preview.forValue === value ? preview.url : value}
                alt={t('fileUpload.uploadedFile')}
                className="w-full h-full object-cover"
              />
              {!disabled && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8"
                  onClick={handleRemove}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-4 bg-muted/50">
              {fileIcons[accept]}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fileName || t('fileUpload.uploadedFile')}</p>
                <p className="text-xs text-muted-foreground">{t('fileUpload.clickToReplace')}</p>
              </div>
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={handleRemove}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={!disabled && !uploading ? triggerUpload : undefined}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-muted/50',
            disabled && 'opacity-50 cursor-not-allowed',
            uploading && 'cursor-wait'
          )}
        >
          {uploading ? (
            <div className="space-y-3">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {t('fileUpload.uploading', { name: fileName })}
                </p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">{t(ctaKeys[accept])}</p>
              {/* States what the resize actually does — it caps DIMENSIONS for
                  three formats. The old "larger images are resized
                  automatically" promised more than the feature delivers: a
                  small-but-heavy PNG under the edge cap is not resized at all
                  and is then refused by the very cap printed beside it, and GIF
                  and SVG are never resized in any case. */}
              <p className="text-xs text-muted-foreground mt-1">
                {t('fileUpload.maxSize', { size: formatSizeMB(capMB) })}
                {maxEdge !== null && ` • ${t('fileUpload.imageResizeHint', { maxEdge })}`}
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
