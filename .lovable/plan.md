

# Plan: Add User Progress Details for Org Admins

## Overview
Implement a detailed view for Org Admins to see individual learner progress on courses. This will include lesson completion status, quiz attempt history, and overall progress metrics per user.

## Current State Analysis

### Existing Data Structure
- **`enrollments`**: Tracks which users are enrolled in which courses (with `status`: enrolled/completed)
- **`lesson_progress`**: Tracks individual lesson completion per user (`status`: not_started/in_progress/completed)
- **`quiz_attempts`**: Stores quiz results (score, passed, timestamps)
- **`org_memberships`**: Links users to organizations with roles

### Existing Patterns
- `OrgAnalytics.tsx`: Shows summary user stats in a table (name, enrollments, completed, avg quiz score)
- `UserDetailDialog.tsx`: Modal pattern for viewing/editing user details
- `OrgUsers.tsx`: Table-based member listing with click actions
- All org admin pages use `currentOrg` from `useAuth()` to scope data

### RLS Policies (Already Configured)
- Org admins can view `enrollments` in their org via `is_org_admin(org_id)`
- Org admins can view `lesson_progress` in their org via `is_org_admin(org_id)`
- Org admins can view `quiz_attempts` in their org via `is_org_admin(org_id)`

## Implementation Approach

### Option: Add Click-to-View on OrgAnalytics User Table
The simplest approach is to make the existing user rows in `OrgAnalytics.tsx` clickable, opening a dialog that shows detailed progress for that user.

## Implementation Steps

### Step 1: Create UserProgressDialog Component
Create a new dialog component to display detailed user progress:

**File**: `src/components/org-admin/UserProgressDialog.tsx`

Features:
- Header with user name and overall stats
- List of enrolled courses with progress bars
- Expandable course sections showing:
  - Module/lesson completion status (checkmarks)
  - Quiz attempt history with scores and dates
- Summary metrics (total lessons completed, avg quiz score, last activity)

### Step 2: Update OrgAnalytics.tsx
Modify the Team Performance table to:
- Make rows clickable to open the progress dialog
- Add a "View Details" button or cursor pointer indicator
- Import and render the `UserProgressDialog` component

## UI/UX Design

### Team Performance Table (Updated)
```text
+------------------------------------------------------+
| Team Performance                                      |
+------------------------------------------------------+
| Name          | Courses | Completed | Avg Score | -> |
+------------------------------------------------------+
| John Smith    |    3    |     2     |    85%    | >  |  <- Clickable row
| Jane Doe      |    2    |     1     |    92%    | >  |
+------------------------------------------------------+
```

### User Progress Dialog
```text
+----------------------------------------------------------+
| [Avatar] John Smith                                       |
| Member since: Jan 15, 2026                               |
|----------------------------------------------------------|
| Summary                                                   |
| +----------+ +----------+ +----------+ +-------------+   |
| | 3        | | 2        | | 85%      | | Jan 25      |   |
| | Enrolled | | Complete | | Avg Quiz | | Last Active |   |
| +----------+ +----------+ +----------+ +-------------+   |
|----------------------------------------------------------|
| Course Progress                                          |
|                                                          |
| [v] Introduction to AI                    [====100%====] |
|     Completed on Jan 20, 2026                           |
|                                                          |
|     Module 1: Basics                                     |
|       [x] Lesson 1: What is AI?                         |
|       [x] Lesson 2: History of AI                       |
|       [x] Quiz: Module 1 Review (Score: 90%)            |
|                                                          |
|     Quiz Attempts:                                       |
|     +----------+-------+--------+------------------+    |
|     | Quiz     | Score | Passed | Date             |    |
|     +----------+-------+--------+------------------+    |
|     | Module 1 | 90%   | Yes    | Jan 20, 2:30 PM  |    |
|     | Module 1 | 65%   | No     | Jan 19, 4:15 PM  |    |
|     +----------+-------+--------+------------------+    |
|                                                          |
| [ ] Machine Learning Fundamentals        [===60%=====]   |
|     In Progress                                          |
|                                                          |
+----------------------------------------------------------+
|                                              [Close]     |
+----------------------------------------------------------+
```

## Technical Details

### Files to Create

**1. `src/components/org-admin/UserProgressDialog.tsx`**
- Props: `userId`, `userName`, `orgId`, `open`, `onOpenChange`
- Fetches and displays:
  - User's enrollments with course details
  - Lesson progress per course
  - Quiz attempts with scores and timestamps
- Uses existing UI components: Dialog, Card, Progress, Badge, Table, Accordion

### Files to Modify

**2. `src/pages/org-admin/OrgAnalytics.tsx`**
- Add state for selected user and dialog visibility
- Make table rows clickable
- Add ChevronRight icon to indicate clickability
- Import and render `UserProgressDialog`

### Data Fetching Strategy

The dialog will fetch data when opened:

```typescript
// 1. Get user's enrollments for this org
const { data: enrollments } = await supabase
  .from('enrollments')
  .select(`
    *,
    course:courses(id, title, level)
  `)
  .eq('org_id', orgId)
  .eq('user_id', userId);

// 2. For each course, get modules and lessons
const { data: modules } = await supabase
  .from('course_modules')
  .select(`
    *,
    lessons(id, title, lesson_type, sort_order)
  `)
  .eq('course_id', courseId)
  .order('sort_order');

// 3. Get lesson progress for user
const { data: progress } = await supabase
  .from('lesson_progress')
  .select('*')
  .eq('user_id', userId)
  .eq('org_id', orgId);

// 4. Get quiz attempts for user
const { data: attempts } = await supabase
  .from('quiz_attempts')
  .select(`
    *,
    quiz:quizzes(lesson_id)
  `)
  .eq('user_id', userId)
  .eq('org_id', orgId)
  .order('started_at', { ascending: false });
```

### Component Structure

```typescript
interface UserProgressDialogProps {
  userId: string;
  userName: string;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EnrollmentWithProgress {
  enrollment: Enrollment;
  course: Course;
  modules: CourseModule[];
  lessonProgress: Record<string, LessonProgress>;
  quizAttempts: QuizAttempt[];
  totalLessons: number;
  completedLessons: number;
}
```

### UI Components Used
- `Dialog` - Main container
- `Card` - Summary stats section
- `Progress` - Course completion bars
- `Accordion` or `Collapsible` - Expandable course sections
- `Badge` - Status indicators (Completed, In Progress)
- `Table` - Quiz attempt history
- `CheckCircle2`, `Circle` icons - Lesson completion status

## Security Considerations
- All data access is already protected by RLS policies
- Org admins can only view progress for users in their organization
- No edge functions required - direct Supabase queries with existing policies

## Testing Recommendations
After implementation:
1. Log in as an org admin
2. Navigate to Analytics page
3. Click on a user row to open the progress dialog
4. Verify enrolled courses are displayed
5. Verify lesson completion status is accurate
6. Verify quiz attempt history shows all attempts
7. Test with users who have no enrollments (should show empty state)
8. Test with users who have completed courses vs in-progress

