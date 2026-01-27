import * as React from 'react';
import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Upload, X, FileText, Video, Image as ImageIcon, Loader2 } from 'lucide-react';

export type FileUploadType = 'image' | 'video' | 'document';

interface FileUploadProps {
  bucket: string;
  folder?: string;
  accept?: FileUploadType;
  value?: string | null;
  onChange: (url: string | null, storagePath: string | null) => void;
  maxSizeMB?: number;
  className?: string;
  disabled?: boolean;
}

const acceptTypes: Record<FileUploadType, string> = {
  image: 'image/png,image/jpeg,image/gif,image/webp',
  video: 'video/mp4,video/webm,video/quicktime',
  document: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const fileIcons: Record<FileUploadType, React.ReactNode> = {
  image: <ImageIcon className="h-8 w-8 text-muted-foreground" />,
  video: <Video className="h-8 w-8 text-muted-foreground" />,
  document: <FileText className="h-8 w-8 text-muted-foreground" />,
};

export function FileUpload({
  bucket,
  folder = '',
  accept = 'image',
  value,
  onChange,
  maxSizeMB = 50,
  className,
  disabled = false,
}: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size
    if (file.size > maxSizeMB * 1024 * 1024) {
      setError(`File size must be less than ${maxSizeMB}MB`);
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);
    setFileName(file.name);

    try {
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const storagePath = folder ? `${folder}/${uniqueName}` : uniqueName;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(storagePath);

      setProgress(100);
      onChange(urlData.publicUrl, storagePath);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      onChange(null, null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
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
        accept={acceptTypes[accept]}
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || uploading}
      />

      {value ? (
        <div className="relative border rounded-lg overflow-hidden">
          {accept === 'image' ? (
            <div className="relative aspect-video bg-muted">
              <img
                src={value}
                alt="Uploaded file"
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
                <p className="text-sm font-medium truncate">{fileName || 'Uploaded file'}</p>
                <p className="text-xs text-muted-foreground">Click to replace</p>
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
                <p className="text-sm text-muted-foreground">Uploading {fileName}...</p>
                <Progress value={progress} className="h-2 w-full max-w-xs mx-auto" />
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Click to upload {accept === 'image' ? 'an image' : accept === 'video' ? 'a video' : 'a document'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Max size: {maxSizeMB}MB
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
