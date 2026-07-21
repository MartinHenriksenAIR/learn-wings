import { Navigate } from 'react-router-dom';
import { routes } from '@/lib/routes';

export default function Signup() {
  return <Navigate to={routes.auth.login} replace />;
}
