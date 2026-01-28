-- Add azure_blob_path column to lessons table for Azure Blob Storage video hosting
ALTER TABLE public.lessons ADD COLUMN azure_blob_path text;