
# Plan: Add Course Deletion for Platform Admin

## Overview
Implement the ability for platform administrators to delete courses from the platform. This includes adding a delete button with confirmation dialog to both the course list page and the individual course editor page, ensuring proper cascade deletion of all related data.

## Current State Analysis

### Database Structure
The database already has proper CASCADE delete rules configured:
- `courses` -> `course_modules` (CASCADE)
- `course_modules` -> `lessons` (CASCADE)
- `lessons` -> `quizzes` (CASCADE)
- `quizzes` -> `quiz_questions` (CASCADE)
- `courses` -> `org_course_access` (CASCADE)
- `courses` -> `enrollments` (CASCADE)
- `courses` -> `course_reviews` (CASCADE)
- `lessons` -> `lesson_progress` (CASCADE)
- `quizzes` -> `quiz_attempts` (CASCADE)

This means deleting a course will automatically clean up all related data.

### Existing Patterns
- The `UserDetailDialog` component uses `AlertDialog` for delete confirmation
- The `OrganizationDetail` page has a similar delete pattern with confirmation
- RLS policies already allow platform admins to delete courses (`is_platform_admin()`)

## Implementation Steps

### Step 1: Update CoursesManager.tsx (Course List Page)
Add a delete button to each course card with confirmation dialog:

1. Add state variables for delete dialog:
   - `deleteOpen: boolean` - controls dialog visibility
   - `courseToDelete: Course | null` - stores the course being deleted
   - `deleting: boolean` - loading state during deletion

2. Add a delete icon button to each course card (next to the publish toggle)

3. Add AlertDialog component for delete confirmation with:
   - Warning about permanent deletion of all related data
   - Course title displayed prominently
   - Cancel and Delete buttons with loading state

4. Implement `handleDeleteCourse` function:
   - Call Supabase to delete the course
   - Show success/error toast
   - Refresh the course list

### Step 2: Update CourseEditor.tsx (Individual Course Page)
Add a delete button to the course details section:

1. Add state variables for delete confirmation

2. Add a "Delete Course" button (destructive variant) in the Course Details card header

3. Add AlertDialog for confirmation with the same pattern

4. Implement delete handler that:
   - Deletes the course
   - Shows success toast
   - Navigates back to the courses list (`/app/admin/courses`)

## UI/UX Design

### Course List (CoursesManager)
```text
+----------------------------------+
| [Course Card]                    |
| +------------------------------+ |
| | Thumbnail                    | |
| +------------------------------+ |
| | Title            [Level]     | |
| | Description...               | |
| +------------------------------+ |
| | [Toggle] Published  [Trash]  | |
| +------------------------------+ |
+----------------------------------+
```

### Course Editor (CourseEditor)
```text
+----------------------------------------+
| Course Details                [Level]   |
|                     [Delete] [Save]     |
+----------------------------------------+
| Thumbnail, Title, Description...        |
+----------------------------------------+
```

### Confirmation Dialog
```text
+------------------------------------------+
|  Delete Course?                          |
|------------------------------------------|
|  This will permanently delete            |
|  "Course Title" and all associated       |
|  data including:                         |
|  - All modules and lessons               |
|  - All learner enrollments and progress  |
|  - All quiz attempts and reviews         |
|                                          |
|  This action cannot be undone.           |
|                                          |
|  [Cancel]              [Delete Course]   |
+------------------------------------------+
```

## Technical Details

### Files to Create
None - all changes are modifications to existing files.

### Files to Modify

**1. `src/pages/platform-admin/CoursesManager.tsx`**
- Import `AlertDialog` components and `Trash2` icon
- Add delete state management
- Add delete button to each course card
- Add confirmation dialog
- Implement delete handler with toast notifications

**2. `src/pages/platform-admin/CourseEditor.tsx`**
- Import `AlertDialog` components
- Add delete state management
- Add "Delete Course" button in the Course Details card
- Add confirmation dialog
- Implement delete handler that navigates back after deletion

### Code Patterns to Follow
Use the existing patterns from `UserDetailDialog.tsx` and `OrganizationDetail.tsx`:

```typescript
// State
const [deleteOpen, setDeleteOpen] = useState(false);
const [deleting, setDeleting] = useState(false);

// Handler
const handleDeleteCourse = async () => {
  setDeleting(true);
  const { error } = await supabase
    .from('courses')
    .delete()
    .eq('id', course.id);
  
  if (error) {
    toast({ 
      title: 'Failed to delete course', 
      description: error.message, 
      variant: 'destructive' 
    });
  } else {
    toast({ title: 'Course deleted' });
    // Navigate or refresh
  }
  setDeleting(false);
};
```

## Security Considerations
- RLS policies already restrict course deletion to platform admins only
- The CASCADE delete rules ensure referential integrity
- No edge function needed - direct Supabase deletion is sufficient

## Testing Recommendations
After implementation:
1. Create a test course with modules, lessons, and enrollments
2. Test deletion from the course list view
3. Test deletion from the course editor view
4. Verify all related data is cleaned up (check modules, lessons, enrollments in database)
5. Verify navigation works correctly after deletion
