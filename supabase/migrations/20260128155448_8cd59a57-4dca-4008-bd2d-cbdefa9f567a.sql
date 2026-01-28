-- Add video_url column to lessons table for SharePoint video URLs
ALTER TABLE public.lessons
ADD COLUMN video_url text;