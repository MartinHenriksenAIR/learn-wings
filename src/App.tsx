import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { PlatformSettingsProvider } from "@/hooks/usePlatformSettings";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import LearnerDashboard from "./pages/learner/Dashboard";
import LearnerCourses from "./pages/learner/Courses";
import CoursePlayer from "./pages/learner/CoursePlayer";
import OrgUsers from "./pages/org-admin/OrgUsers";
import OrgAnalytics from "./pages/org-admin/OrgAnalytics";
import OrgSettings from "./pages/org-admin/OrgSettings";
import OrganizationsManager from "./pages/platform-admin/OrganizationsManager";
import OrganizationDetail from "./pages/platform-admin/OrganizationDetail";
import CoursesManager from "./pages/platform-admin/CoursesManager";
import CourseEditor from "./pages/platform-admin/CourseEditor";
import PlatformSettings from "./pages/platform-admin/PlatformSettings";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import CommunityFeed from "./pages/community/CommunityFeed";
import PostDetail from "./pages/community/PostDetail";
import PostEdit from "./pages/community/PostEdit";
import IdeaLibrary from "./pages/community/IdeaLibrary";
import IdeaSubmit from "./pages/community/IdeaSubmit";
import IdeaDetail from "./pages/community/IdeaDetail";
import ResourceLibrary from "./pages/community/ResourceLibrary";
import OrgIdeasManagement from "./pages/org-admin/OrgIdeasManagement";
import OrgCommunityModeration from "./pages/org-admin/OrgCommunityModeration";
import PlatformCommunityModeration from "./pages/platform-admin/PlatformCommunityModeration";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      
      {/* Protected learner routes - not accessible by platform admins */}
      <Route path="/app/dashboard" element={<ProtectedRoute learnerOnly><LearnerDashboard /></ProtectedRoute>} />
      <Route path="/app/courses" element={<ProtectedRoute learnerOnly><LearnerCourses /></ProtectedRoute>} />
      <Route path="/app/learn/:courseId" element={<ProtectedRoute learnerOnly><CoursePlayer /></ProtectedRoute>} />
      <Route path="/app/certificates" element={<Navigate to="/app/dashboard" replace />} />
      
      {/* Community routes */}
      <Route path="/app/community" element={<ProtectedRoute><CommunityFeed /></ProtectedRoute>} />
      <Route path="/app/community/:scope/posts/:postId/edit" element={<ProtectedRoute><PostEdit /></ProtectedRoute>} />
      <Route path="/app/community/:scope/posts/:postId" element={<ProtectedRoute><PostDetail /></ProtectedRoute>} />
      <Route path="/app/community/org/ideas" element={<ProtectedRoute><IdeaLibrary /></ProtectedRoute>} />
      <Route path="/app/community/org/ideas/new" element={<ProtectedRoute><IdeaSubmit /></ProtectedRoute>} />
      <Route path="/app/community/org/ideas/edit/:ideaId" element={<ProtectedRoute><IdeaSubmit /></ProtectedRoute>} />
      <Route path="/app/community/org/ideas/:ideaId" element={<ProtectedRoute><IdeaDetail /></ProtectedRoute>} />
      <Route path="/app/community/org/resources" element={<ProtectedRoute><ResourceLibrary /></ProtectedRoute>} />
      
      {/* Protected org admin routes */}
      <Route path="/app/admin/org/users" element={<ProtectedRoute requireOrgAdmin><OrgUsers /></ProtectedRoute>} />
      <Route path="/app/admin/analytics" element={<ProtectedRoute requireOrgAdmin><OrgAnalytics /></ProtectedRoute>} />
      <Route path="/app/admin/org/settings" element={<ProtectedRoute requireOrgAdmin><OrgSettings /></ProtectedRoute>} />
      <Route path="/app/admin/org/ideas" element={<ProtectedRoute requireOrgAdmin><OrgIdeasManagement /></ProtectedRoute>} />
      <Route path="/app/admin/org/moderation" element={<ProtectedRoute requireOrgAdmin><OrgCommunityModeration /></ProtectedRoute>} />
      
      {/* Protected platform admin routes */}
      <Route path="/app/admin/organizations" element={<ProtectedRoute requirePlatformAdmin><OrganizationsManager /></ProtectedRoute>} />
      <Route path="/app/admin/organizations/:orgId" element={<ProtectedRoute requirePlatformAdmin><OrganizationDetail /></ProtectedRoute>} />
      <Route path="/app/admin/courses" element={<ProtectedRoute requirePlatformAdmin><CoursesManager /></ProtectedRoute>} />
      <Route path="/app/admin/courses/:courseId" element={<ProtectedRoute requirePlatformAdmin><CourseEditor /></ProtectedRoute>} />
      <Route path="/app/admin/analytics/global" element={<ProtectedRoute requirePlatformAdmin><OrgAnalytics /></ProtectedRoute>} />
      <Route path="/app/admin/platform/settings" element={<ProtectedRoute requirePlatformAdmin><PlatformSettings /></ProtectedRoute>} />
      <Route path="/app/admin/platform/moderation" element={<ProtectedRoute requirePlatformAdmin><PlatformCommunityModeration /></ProtectedRoute>} />
      <Route path="/app/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      
      {/* Redirects */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      
      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PlatformSettingsProvider>
            <AppRoutes />
          </PlatformSettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
