
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
- ❌ Logo upload - Not implemented
- ❌ Assign initial org admin on creation - Not implemented

### Implementation

#### A. Organization Logo Upload
Add the ability to upload organization logos when creating or editing an organization.

**Changes Required:**
1. Create storage RLS policies for a new `org-logos` bucket (public read access)
2. Add file upload component to:
   - Create Organization dialog in `OrganizationsManager.tsx`
   - Edit Organization dialog in `OrganizationDetail.tsx`
3. Store the logo URL in the existing `logo_url` column in the `organizations` table

#### B. Assign Initial Org Admin on Creation
When creating an organization, allow the platform admin to optionally select an existing user or send an invitation to become the first org admin.

**Changes Required:**
1. Modify the Create Organization dialog to add:
   - Option to select existing user OR enter email for invitation
   - Role pre-set to "org_admin"
2. After org creation, automatically create the membership or invitation record

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

### Current State
- ❌ Course thumbnails - Not implemented (hardcoded gradient shown)
- ❌ Video uploads for lessons - Not implemented
- ❌ Document uploads for lessons - Not implemented
- ✅ Storage bucket `lms-assets` exists but has no upload UI
- ✅ Database columns exist: `video_storage_path`, `document_storage_path`, `thumbnail_url`

### Implementation

#### A. Storage RLS Policies
Add proper RLS policies to allow platform admins to upload and everyone to read.

**Migration Required:**
```sql
-- Policy: Platform admins can upload to lms-assets
CREATE POLICY "Platform admins can upload lms-assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'lms-assets' AND is_platform_admin());

-- Policy: Platform admins can update/delete lms-assets
CREATE POLICY "Platform admins can manage lms-assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'lms-assets' AND is_platform_admin());

CREATE POLICY "Platform admins can delete lms-assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'lms-assets' AND is_platform_admin());

-- Policy: Anyone can read lms-assets (through course access RLS)
CREATE POLICY "Authenticated users can read lms-assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'lms-assets' AND auth.role() = 'authenticated');
```

#### B. Reusable File Upload Component
Create a shared `FileUpload` component that:
- Accepts file type restrictions (video, document, image)
- Shows upload progress
- Returns the storage path on completion
- Displays preview (image) or file name (video/document)

**New File:** `src/components/ui/file-upload.tsx`

#### C. Course Thumbnail Upload
Add thumbnail upload to course creation and editing.

**Changes Required:**
1. `CoursesManager.tsx` - Add thumbnail upload to Create Course dialog
2. `CourseEditor.tsx` - Add thumbnail upload in Course Details card
3. Display uploaded thumbnail instead of gradient in course cards

#### D. Lesson Video/Document Upload
Add upload functionality when creating/editing lessons.

**Changes Required:**
1. `CourseEditor.tsx` - Modify the Lesson Dialog:
   - For `video` type: Show video file upload field
   - For `document` type: Show document file upload field
   - Store the resulting path in `video_storage_path` or `document_storage_path`
2. Update the lesson save handler to include storage paths

---

## Technical Details

### New Components
| Component | Purpose |
|-----------|---------|
| `src/components/ui/file-upload.tsx` | Reusable file upload with progress |

### Database Changes
| Change | Details |
|--------|---------|
| Storage policies | INSERT/UPDATE/DELETE for platform admins on `lms-assets` |
| New bucket | `org-logos` for organization logo images |

### Files to Modify
| File | Changes |
|------|---------|
| `OrganizationsManager.tsx` | Add logo upload + initial admin assignment to create dialog |
| `OrganizationDetail.tsx` | Add logo upload to edit dialog |
| `CoursesManager.tsx` | Add thumbnail upload to create dialog, show thumbnails in cards |
| `CourseEditor.tsx` | Add thumbnail upload to details card, add video/document upload to lesson dialog |

---

## Implementation Order

1. **Database migration** - Add storage RLS policies and org-logos bucket
2. **FileUpload component** - Create reusable upload component
3. **Organization logos** - Add upload to org creation/editing
4. **Initial org admin** - Add to org creation flow
5. **Course thumbnails** - Add upload to course creation/editing
6. **Lesson file uploads** - Add video/document uploads to lessons

---

## Security Considerations

- All uploads are restricted to platform admins via RLS
- Files are stored in private buckets with authenticated read access
- Existing `can_access_lms_asset()` function validates course access for learners
- File type validation on client side (accept attribute) and size limits

---

## Estimated Scope

| Area | Complexity | Files Changed |
|------|------------|---------------|
| Org logo upload | Medium | 3 files + migration |
| Initial admin assignment | Low | 1 file |
| Course thumbnail upload | Medium | 2 files |
| Lesson file uploads | Medium | 1 file |
| FileUpload component | Medium | 1 new file |

**Total: ~5-7 files changed/created, 1 database migration**
