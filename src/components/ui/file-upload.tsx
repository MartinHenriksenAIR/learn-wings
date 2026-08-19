import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { mintedUpload, releaseUpload, type MintedUpload } from '@/lib/blob-release';
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
  assetType?: 'org-logo' | 'avatar';
  folder?: string;
  accept?: UploadAccept;
  value?: string | null;
  onChange: (url: string | null, storagePath: string | null) => void;
  maxSizeMB?: number;
  className?: string;
  disabled?: boolean;
  id?: string;
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
  id,
}: FileUploadProps) {
  const { t } = useTranslation();
  const capMB = effectiveMaxSizeMB(accept, maxSizeMB);
  const maxEdge = maxEdgeForUpload(accept, assetType);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; forValue: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mintedRef = useRef<MintedUpload | null>(null);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  useEffect(() => {
    if (preview && preview.forValue !== value) setPreview(null);
  }, [value, preview]);

  const showMessage = (message: UploadMessage) => setError(t(message.key, message.values));

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const typeError = checkUploadFileType(accept, file);
      if (typeError) {
        showMessage(typeError);
        return;
      }

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
        const upload = maxEdge === null ? file : await downscaleImageFile(file, maxEdge);

        const payloadError = checkUploadPayloadSize(upload.size, capMB);
        if (payloadError) {
          showMessage(payloadError);
          setFileName(null);
          return;
        }

        const uploadData = await callApi<{ uploadUrl: string; blobPath: string; contentType: string; releaseToken?: string | null }>(
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
          setPreview({ url: URL.createObjectURL(upload), forValue: uploadData.blobPath });
        }
        const superseded = mintedRef.current;
        mintedRef.current = mintedUpload(uploadData);
        releaseUpload(superseded);
        onChange(uploadData.blobPath, uploadData.blobPath);
      } catch (err) {
        console.error('Upload failed:', err);
        setError(t('fileUpload.errorUploadFailed'));
        setFileName(null);
      } finally {
        setUploading(false);
      }
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    const discarded = mintedRef.current;
    mintedRef.current = null;
    releaseUpload(discarded);
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
        id={id}
        type="file"
        accept={UPLOAD_ACCEPT_ATTRIBUTE[accept]}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value && !uploading ? (
        <div
          onClick={!disabled ? triggerUpload : undefined}
          className={cn(
            'relative border rounded-lg overflow-hidden',
            !disabled && 'cursor-pointer transition-colors hover:border-primary/50'
          )}
        >
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove();
                  }}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove();
                  }}
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
