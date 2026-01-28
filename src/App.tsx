import { Toaster } from "@/components/ui/toaster";
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
import Certificates from "./pages/learner/Certificates";
import OrgDashboard from "./pages/org-admin/OrgDashboard";
import OrgUsers from "./pages/org-admin/OrgUsers";
import OrgAnalytics from "./pages/org-admin/OrgAnalytics";
import OrganizationsManager from "./pages/platform-admin/OrganizationsManager";
import OrganizationDetail from "./pages/platform-admin/OrganizationDetail";
import CoursesManager from "./pages/platform-admin/CoursesManager";
import UsersManager from "./pages/platform-admin/UsersManager";
import CourseEditor from "./pages/platform-admin/CourseEditor";
import PlatformSettings from "./pages/platform-admin/PlatformSettings";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

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
      <Route path="/app/certificates" element={<ProtectedRoute learnerOnly><Certificates /></ProtectedRoute>} />
      
      {/* Protected org admin routes */}
      <Route path="/app/admin/org" element={<ProtectedRoute requireOrgAdmin><OrgDashboard /></ProtectedRoute>} />
      <Route path="/app/admin/org/users" element={<ProtectedRoute requireOrgAdmin><OrgUsers /></ProtectedRoute>} />
      <Route path="/app/admin/analytics" element={<ProtectedRoute requireOrgAdmin><OrgAnalytics /></ProtectedRoute>} />
      
      {/* Protected platform admin routes */}
      <Route path="/app/admin/organizations" element={<ProtectedRoute requirePlatformAdmin><OrganizationsManager /></ProtectedRoute>} />
      <Route path="/app/admin/organizations/:orgId" element={<ProtectedRoute requirePlatformAdmin><OrganizationDetail /></ProtectedRoute>} />
      <Route path="/app/admin/courses" element={<ProtectedRoute requirePlatformAdmin><CoursesManager /></ProtectedRoute>} />
      <Route path="/app/admin/courses/:courseId" element={<ProtectedRoute requirePlatformAdmin><CourseEditor /></ProtectedRoute>} />
      <Route path="/app/admin/users" element={<ProtectedRoute requirePlatformAdmin><UsersManager /></ProtectedRoute>} />
      <Route path="/app/admin/analytics/global" element={<ProtectedRoute requirePlatformAdmin><OrgAnalytics /></ProtectedRoute>} />
      <Route path="/app/admin/platform/settings" element={<ProtectedRoute requirePlatformAdmin><PlatformSettings /></ProtectedRoute>} />
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
      <Toaster />
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
