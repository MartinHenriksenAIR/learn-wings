import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { PlatformSettingsProvider } from "@/hooks/usePlatformSettings";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { routes } from "@/lib/routes";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import LearnerDashboard from "./pages/learner/Dashboard";
import LearnerCourses from "./pages/learner/Courses";
import Assessment from "./pages/learner/Assessment";
import CoursePlayer from "./pages/learner/CoursePlayer";

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
      <Route path={routes.auth.login} element={<Login />} />
      <Route path={routes.auth.signup} element={<Signup />} />
      <Route path={routes.auth.forgotPassword} element={<ForgotPassword />} />
      <Route path={routes.auth.resetPassword} element={<ResetPassword />} />

      {/* Protected learner routes - not accessible by platform admins */}
      <Route path={routes.learner.dashboard} element={<ProtectedRoute learnerOnly><LearnerDashboard /></ProtectedRoute>} />
      <Route path={routes.learner.courses} element={<ProtectedRoute learnerOnly><LearnerCourses /></ProtectedRoute>} />
      <Route path={routes.learner.assessment} element={<ProtectedRoute learnerOnly><Assessment /></ProtectedRoute>} />
      <Route path={routes.learner.coursePlayerPattern} element={<ProtectedRoute learnerOnly><CoursePlayer /></ProtectedRoute>} />
      <Route path={routes.learner.certificates} element={<Navigate to={routes.learner.dashboard} replace />} />

      {/* Community routes */}
      <Route path={routes.community.feed} element={<ProtectedRoute><CommunityFeed /></ProtectedRoute>} />
      <Route path={routes.community.postEditPattern} element={<ProtectedRoute><PostEdit /></ProtectedRoute>} />
      <Route path={routes.community.postDetailPattern} element={<ProtectedRoute><PostDetail /></ProtectedRoute>} />
      <Route path={routes.community.ideas} element={<ProtectedRoute><IdeaLibrary /></ProtectedRoute>} />
      <Route path={routes.community.ideaNew} element={<ProtectedRoute><IdeaSubmit /></ProtectedRoute>} />
      <Route path={routes.community.ideaEditPattern} element={<ProtectedRoute><IdeaSubmit /></ProtectedRoute>} />
      <Route path={routes.community.ideaDetailPattern} element={<ProtectedRoute><IdeaDetail /></ProtectedRoute>} />
      <Route path={routes.community.resources} element={<ProtectedRoute><ResourceLibrary /></ProtectedRoute>} />
      
      {/* Protected org admin routes */}
      <Route path={routes.orgAdmin.root} element={<ProtectedRoute requireOrgAdmin><OrgAnalytics /></ProtectedRoute>} />
      <Route path={routes.orgAdmin.settings} element={<ProtectedRoute requireOrgAdmin><OrgSettings /></ProtectedRoute>} />
      <Route path={routes.orgAdmin.ideas} element={<ProtectedRoute requireOrgAdmin><OrgIdeasManagement /></ProtectedRoute>} />
      <Route path={routes.orgAdmin.moderation} element={<ProtectedRoute requireOrgAdmin><OrgCommunityModeration /></ProtectedRoute>} />

      {/* Protected platform admin routes */}
      <Route path={routes.platformAdmin.organizations} element={<ProtectedRoute requirePlatformAdmin><OrganizationsManager /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.organizationDetailPattern} element={<ProtectedRoute requirePlatformAdmin><OrganizationDetail /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.courses} element={<ProtectedRoute requirePlatformAdmin><CoursesManager /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.courseEditorPattern} element={<ProtectedRoute requirePlatformAdmin><CourseEditor /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.analytics} element={<ProtectedRoute requirePlatformAdmin><OrgAnalytics /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.settings} element={<ProtectedRoute requirePlatformAdmin><PlatformSettings /></ProtectedRoute>} />
      <Route path={routes.platformAdmin.moderation} element={<ProtectedRoute requirePlatformAdmin><PlatformCommunityModeration /></ProtectedRoute>} />
      <Route path={routes.settings} element={<ProtectedRoute><Settings /></ProtectedRoute>} />

      {/* Redirects */}
      <Route path={routes.root} element={<Navigate to={routes.auth.login} replace />} />
      <Route path={routes.appRoot} element={<Navigate to={routes.learner.dashboard} replace />} />
      
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
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </PlatformSettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
