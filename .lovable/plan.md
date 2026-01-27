
# Implementation Plan: Platform Admin Priority Features

## Overview
This plan covers three priority areas you identified as blockers:
1. **Organization Management** - Edit org details (name, logo), delete orgs, assign initial admin
2. **Course Access Control** - Already implemented but may need enhancements
3. **File Uploads** - Video/document uploads for lessons, course thumbnails

---

## 1. Organization Management Enhancements

### Current State
- ✅ Organization edit (name, slug) - Already implemented in `OrganizationDetail.tsx`
- ✅ Organization delete - Already implemented
- ✅ Reactivate disabled members - Already implemented
- ✅ Change user roles - Already implemented
- ✅ Logo upload - IMPLEMENTED
- ✅ Assign initial org admin on creation - IMPLEMENTED

### Implementation - COMPLETE

#### A. Organization Logo Upload ✅
- Created `org-logos` storage bucket with public read access
- Added RLS policies for platform admin upload/manage
- Added `FileUpload` component to Create Organization dialog
- Added logo display in org list (shows uploaded logo or Building2 icon fallback)
- Added logo upload to Edit Organization dialog in OrganizationDetail

#### B. Assign Initial Org Admin on Creation ✅
- Added tabs in Create Organization dialog: "Existing User" or "Send Invite"
- Existing User: Select from dropdown of all profiles
- Send Invite: Enter email to create invitation with org_admin role
- Automatically creates membership or invitation record after org creation

---

## 2. Course Access Control

### Current State
The `CourseAccessManager.tsx` is fully functional:
- ✅ Toggle course access per organization
- ✅ Enable all courses for an organization
- ✅ Filter by organization

**No changes needed** - this feature is complete.

---

## 3. File Uploads (Video/Document/Thumbnails)

### Current State - ALL IMPLEMENTED
- ✅ Course thumbnails - IMPLEMENTED
- ✅ Video uploads for lessons - IMPLEMENTED
- ✅ Document uploads for lessons - IMPLEMENTED
- ✅ Storage bucket `lms-assets` exists with proper RLS policies
- ✅ Database columns exist: `video_storage_path`, `document_storage_path`, `thumbnail_url`

### Implementation - COMPLETE

#### A. Storage RLS Policies ✅
Added to both `lms-assets` and `org-logos` buckets:
- Platform admins can INSERT, UPDATE, DELETE
- Authenticated users can read `lms-assets`
- Anyone can read `org-logos` (public bucket for display)

#### B. Reusable File Upload Component ✅
Created `src/components/ui/file-upload.tsx`:
- Accepts file type restrictions (image, video, document)
- Shows upload progress with Progress component
- Returns both public URL and storage path
- Displays image preview or file indicator
- Handles errors and size limits
- Click to upload/replace functionality

#### C. Course Thumbnail Upload ✅
- Added to Create Course dialog in `CoursesManager.tsx`
- Added to Course Details card in `CourseEditor.tsx`
- Course cards now show uploaded thumbnail or gradient fallback

#### D. Lesson Video/Document Upload ✅
- Updated Lesson Dialog in `CourseEditor.tsx`:
  - For `video` type: Shows video file upload field
  - For `document` type: Shows document file upload field
- Stores paths in `video_storage_path` or `document_storage_path`

---

## Technical Details

### New Components
| Component | Purpose | Status |
|-----------|---------|--------|
| `src/components/ui/file-upload.tsx` | Reusable file upload with progress | ✅ Created |

### Database Changes
| Change | Details | Status |
|--------|---------|--------|
| Storage policies | INSERT/UPDATE/DELETE for platform admins on `lms-assets` | ✅ Applied |
| New bucket | `org-logos` for organization logo images (public) | ✅ Created |

### Files Modified
| File | Changes | Status |
|------|---------|--------|
| `OrganizationsManager.tsx` | Logo upload + initial admin assignment to create dialog | ✅ Complete |
| `OrganizationDetail.tsx` | Logo upload to edit dialog, logo display in header | ✅ Complete |
| `CoursesManager.tsx` | Thumbnail upload to create dialog, show thumbnails in cards | ✅ Complete |
| `CourseEditor.tsx` | Thumbnail upload to details card, video/document upload to lesson dialog | ✅ Complete |

---

## Security Considerations

- All uploads are restricted to platform admins via RLS ✅
- `lms-assets` bucket: private with authenticated read access
- `org-logos` bucket: public for display purposes
- Existing `can_access_lms_asset()` function validates course access for learners
- File type validation on client side (accept attribute) and size limits

---

## Summary

All three priority features have been implemented:

1. **Organization Management** ✅
   - Logo upload on create and edit
   - Initial admin assignment (existing user or email invite)

2. **Course Access Control** ✅
   - Already functional, no changes needed

3. **File Uploads** ✅
   - Reusable FileUpload component
   - Course thumbnails
   - Lesson video and document uploads
   - Storage RLS policies
