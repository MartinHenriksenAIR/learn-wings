import { Navigate } from 'react-router-dom';
import { routes } from '@/lib/routes';

export default function ResetPassword() {
  return <Navigate to={routes.auth.forgotPassword} replace />;
}
