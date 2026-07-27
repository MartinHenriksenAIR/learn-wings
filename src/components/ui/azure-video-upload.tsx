import * as React from 'react';
import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import {
  checkUploadFileType,
  checkUploadPayloadSize,
  effectiveMaxSizeMB,
  formatSizeMB,
  UPLOAD_ACCEPT_ATTRIBUTE,
  type UploadMessage,
} from '@/lib/upload-limits';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Upload, X, Video, Loader2, Cloud, CheckCircle2 } from 'lucide-react';

interface AzureVideoUploadProps {
  value?: string | null;
  onChange: (blobPath: string | null) => void;
  className?: string;
  disabled?: boolean;
}

export function AzureVideoUpload({
  value,
  onChange,
  className,
  disabled = false,
}: AzureVideoUploadProps) {
  const { t } = useTranslation();
  // Via the clamp helper rather than UPLOAD_MAX_MB directly, so every call site
  // in the app reaches the server cap through exactly one code path.
  const capMB = effectiveMaxSizeMB('video');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const loadPreview = async () => {
      if (!value) {
        setPreviewUrl(null);
        return;
      }

      try {
        const data = await callApi<{ viewUrl: string }>('/api/azure-view-url', { blobPath: value });
        if (data?.viewUrl) {
          setPreviewUrl(data.viewUrl);
        }
      } catch (err) {
        console.error('Error loading preview:', err);
      }
    };

    loadPreview();
  }, [value]);

  const showMessage = (message: UploadMessage) => setError(t(message.key, message.values));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clearing the input is the single exit path for every branch below: a
    // `change` event only fires when the value changes, so a rejected file left
    // in the input makes re-picking it a no-op.
    try {
      // Mirrors the server's mint-time allow-list rather than a bare `video/`
      // prefix, so .mkv/.avi/.wmv are refused here — naming the formats —
      // instead of by the server with a bare "File type not allowed".
      const typeError = checkUploadFileType('video', file);
      if (typeError) {
        showMessage(typeError);
        return;
      }

      // Validate file size against the server cap (#276). This component used to
      // have no size check at all and advertised "Unlimited file size"; without it
      // an oversized video uploads for minutes and only then fails the save with a
      // 413, having already cost the user (and the storage account) the transfer.
      const sizeError = checkUploadPayloadSize(file.size, capMB);
      if (sizeError) {
        showMessage(sizeError);
        return;
      }

      setError(null);
      setUploading(true);
      setProgress(0);
      setFileName(file.name);

      try {
        const uploadData = await callApi<{ uploadUrl: string; blobPath: string; contentType: string }>('/api/azure-upload-url', {
          fileName: file.name,
          contentType: file.type,
        });

        if (!uploadData?.uploadUrl) {
          throw new Error('Failed to get upload URL');
        }

        const { uploadUrl, blobPath, contentType } = uploadData;

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percentComplete = Math.round((event.loaded / event.total) * 100);
              setProgress(percentComplete);
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Upload failed'));
          xhr.ontimeout = () => reject(new Error('Upload timed out'));

          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', contentType);
          xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
          xhr.send(file);
        });

        setProgress(100);
        onChange(blobPath);
      } catch (err) {
        // The thrown text is diagnostic, not actionable, and is the one string
        // no translation could reach — log it and show the translated summary.
        console.error('Video upload failed:', err);
        setError(t('fileUpload.errorUploadFailed'));
        // Deliberately NO `onChange(null)` here — same rule as FileUpload.
        // Nothing was stored, so the parent's current value still names a live
        // blob, and since #275 saving a null is what DELETES it. A failed
        // replacement must not destroy the video it failed to replace, so
        // `onChange(null)` means only one thing: the user removed the video.
        setFileName(null);
      } finally {
        setUploading(false);
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = () => {
    onChange(null);
    setFileName(null);
    setProgress(0);
    setPreviewUrl(null);
  };

  const triggerUpload = () => {
    inputRef.current?.click();
  };

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE.video}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="relative border rounded-lg overflow-hidden">
          <div className="aspect-video bg-muted relative">
            {previewUrl ? (
              <video
                src={previewUrl}
                controls
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Video className="mx-auto h-12 w-12 mb-2" />
                  <p className="text-sm">{t('fileUpload.loadingPreview')}</p>
                </div>
              </div>
            )}
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
          <div className="p-3 bg-muted/50 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm text-muted-foreground">
              {t('fileUpload.videoUploadedToAzure')}
            </span>
          </div>
        </div>
      ) : (
        <div
          onClick={!disabled && !uploading ? triggerUpload : undefined}
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            'hover:border-primary/50 hover:bg-muted/50',
            disabled && 'opacity-50 cursor-not-allowed',
            uploading && 'cursor-wait'
          )}
        >
          {uploading ? (
            <div className="space-y-4">
              <Cloud className="h-12 w-12 mx-auto text-primary animate-pulse" />
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('fileUpload.uploadingToAzure')}</p>
                <p className="text-xs text-muted-foreground">{fileName}</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
                <p className="text-xs text-muted-foreground">{progress}%</p>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium">{t('fileUpload.ctaVideo')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('fileUpload.maxSize', { size: formatSizeMB(capMB) })}
                {' • '}
                {t('fileUpload.videoFormats')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('fileUpload.directToAzure')}
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
