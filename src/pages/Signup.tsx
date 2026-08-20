import { useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { callApi, ApiError } from '@/lib/api-client';
import { savePostLoginRedirect } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { MicrosoftSignInButton } from '@/components/auth/MicrosoftSignInButton';
import {
  CircleCheck,
  Clock,
  Loader2,
  MailX,
  SearchX,
  ShieldCheck,
  TicketX,
  TriangleAlert,
  User,
} from 'lucide-react';
import logoLight from '@/assets/logo-light.png';
import { PAGE_GRADIENT_CLASSES, AUTH_CARD_CLASSES } from './Login';

type AcceptResponse =
  | {
      kind: 'org';
      orgId: string;
      orgName: string | null;
      role: 'learner' | 'org_admin';
      alreadyMember: boolean;
    }
  | { kind: 'platform' };

type ErrorKind = 'expired' | 'invalid' | 'alreadyAccepted' | 'emailMismatch' | 'generic';

type FlowState =
  | { phase: 'accept'; submitting: boolean }
  | { phase: 'success'; result: AcceptResponse }
  | { phase: 'error'; kind: ErrorKind };

function errorKindFor(err: unknown): ErrorKind {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'INVITE_EXPIRED':
        return 'expired';
      case 'INVITE_NOT_FOUND':
        return 'invalid';
      case 'INVITE_ALREADY_ACCEPTED':
        return 'alreadyAccepted';
      case 'INVITE_EMAIL_MISMATCH':
        return 'emailMismatch';
    }
  }
  return 'generic';
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className={AUTH_CARD_CLASSES}>{children}</div>
    </div>
  );
}

function StatusIcon({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <div
      className={`grid h-14 w-14 place-items-center rounded-full ${
        tone === 'success' ? 'bg-[#e6f5ee] text-success' : 'bg-[#fbe9e9] text-destructive'
      }`}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-balance text-center text-lg font-bold text-foreground">{children}</h1>;
}

function CardBody({ children }: { children: ReactNode }) {
  return (
    <p className="text-balance text-center text-sm leading-[1.55] text-muted-foreground">
      {children}
    </p>
  );
}

const PRIMARY_BUTTON_CLASSES =
  'h-auto w-full gap-2.5 rounded-xl px-4 py-[13px] text-[14.5px] font-semibold';

export default function Signup() {
  const { user, isLoading, isPlatformAdmin, isOrgAdmin, signIn, signOut, refreshUserContext } =
    useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<FlowState>({ phase: 'accept', submitting: false });

  const inviteId = new URLSearchParams(location.search).get('invite');

  if (!inviteId) {
    return <Navigate to={routes.auth.login} replace />;
  }

  if (isLoading) {
    return (
      <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES}`}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleSignIn = () => {
    savePostLoginRedirect(location.pathname + location.search + location.hash);
    signIn();
  };

  const handleAccept = async () => {
    if (state.phase !== 'accept' || state.submitting) return; // latch against double-submit
    setState({ phase: 'accept', submitting: true });
    try {
      const result = await callApi<AcceptResponse>('/api/invitation-accept', { linkId: inviteId, language: i18n.resolvedLanguage });
      await refreshUserContext();
      setState({ phase: 'success', result });
    } catch (err) {
      setState({ phase: 'error', kind: errorKindFor(err) });
    }
  };

  const goToRoleHome = () => {
    if (isPlatformAdmin) {
      navigate(routes.platformAdmin.organizations);
    } else if (isOrgAdmin) {
      navigate(routes.orgAdmin.root);
    } else {
      navigate(routes.learner.dashboard);
    }
  };

  if (!user) {
    return (
      <AuthShell>
        <img src={logoLight} alt="AI Uddannelse" className="h-[52px] w-auto object-contain" />
        <CardTitle>{t('invitationAccept.invitedTitle')}</CardTitle>
        <CardBody>
          <Trans i18nKey="invitationAccept.invitedBody" />
        </CardBody>
        <MicrosoftSignInButton
          className={PRIMARY_BUTTON_CLASSES}
          onClick={handleSignIn}
          label={t('invitationAccept.signInWithMicrosoft')}
        />
      </AuthShell>
    );
  }

  if (state.phase === 'success') {
    const { result } = state;
    if (result.kind === 'platform') {
      return (
        <AuthShell>
          <StatusIcon tone="success">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </StatusIcon>
          <CardTitle>{t('invitationAccept.platformTitle')}</CardTitle>
          <CardBody>{t('invitationAccept.platformBody')}</CardBody>
          <Button className={PRIMARY_BUTTON_CLASSES} onClick={goToRoleHome}>
            {t('invitationAccept.continue')}
          </Button>
        </AuthShell>
      );
    }
    const org = result.orgName ?? 'AI Uddannelse';
    if (result.alreadyMember) {
      return (
        <AuthShell>
          <StatusIcon tone="success">
            <User className="h-7 w-7" aria-hidden="true" />
          </StatusIcon>
          <CardTitle>{t('invitationAccept.alreadyMemberTitle')}</CardTitle>
          <CardBody>
            <Trans i18nKey="invitationAccept.alreadyMemberBody" values={{ org }} />
          </CardBody>
          <Button className={PRIMARY_BUTTON_CLASSES} onClick={goToRoleHome}>
            {t('invitationAccept.continue')}
          </Button>
        </AuthShell>
      );
    }
    const roleLabel =
      result.role === 'org_admin' ? t('orgDetail.organizationAdmin') : t('orgDetail.learner');
    return (
      <AuthShell>
        <StatusIcon tone="success">
          <CircleCheck className="h-7 w-7" aria-hidden="true" />
        </StatusIcon>
        <CardTitle>{t('invitationAccept.orgJoinedTitle', { org })}</CardTitle>
        <CardBody>
          <Trans i18nKey="invitationAccept.orgJoinedBody" values={{ org, role: roleLabel }} />
        </CardBody>
        <Button className={PRIMARY_BUTTON_CLASSES} onClick={goToRoleHome}>
          {t('invitationAccept.continue')}
        </Button>
      </AuthShell>
    );
  }

  if (state.phase === 'error') {
    if (state.kind === 'emailMismatch') {
      return (
        <AuthShell>
          <StatusIcon tone="error">
            <MailX className="h-7 w-7" aria-hidden="true" />
          </StatusIcon>
          <CardTitle>{t('invitationAccept.emailMismatchTitle')}</CardTitle>
          <CardBody>
            <Trans
              i18nKey="invitationAccept.emailMismatchBody"
              values={{ currentEmail: user.email }}
            />
          </CardBody>
          <Button variant="destructive" className={PRIMARY_BUTTON_CLASSES} onClick={signOut}>
            {t('invitationAccept.signOut')}
          </Button>
        </AuthShell>
      );
    }
    if (state.kind === 'generic') {
      return (
        <AuthShell>
          <StatusIcon tone="error">
            <TriangleAlert className="h-7 w-7" aria-hidden="true" />
          </StatusIcon>
          <CardTitle>{t('invitationAccept.genericTitle')}</CardTitle>
          <CardBody>{t('invitationAccept.genericBody')}</CardBody>
          <Button
            className={PRIMARY_BUTTON_CLASSES}
            onClick={() => setState({ phase: 'accept', submitting: false })}
          >
            {t('invitationAccept.tryAgain')}
          </Button>
        </AuthShell>
      );
    }
    const { Icon, titleKey, bodyKey } = {
      expired: {
        Icon: Clock,
        titleKey: 'invitationAccept.expiredTitle',
        bodyKey: 'invitationAccept.expiredBody',
      },
      invalid: {
        Icon: SearchX,
        titleKey: 'invitationAccept.invalidTitle',
        bodyKey: 'invitationAccept.invalidBody',
      },
      alreadyAccepted: {
        Icon: TicketX,
        titleKey: 'invitationAccept.alreadyAcceptedTitle',
        bodyKey: 'invitationAccept.alreadyAcceptedBody',
      },
    }[state.kind];
    return (
      <AuthShell>
        <StatusIcon tone="error">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </StatusIcon>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardBody>{t(bodyKey)}</CardBody>
        <Button
          variant="ghost"
          className="h-auto rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground"
          onClick={() => navigate(routes.auth.login)}
        >
          {t('invitationAccept.goToSignIn')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <img src={logoLight} alt="AI Uddannelse" className="h-[52px] w-auto object-contain" />
      <CardTitle>{t('invitationAccept.acceptTitle')}</CardTitle>
      <CardBody>
        <Trans i18nKey="invitationAccept.acceptBody" />
      </CardBody>
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {t('invitationAccept.signedInAs', { email: user.email })}
      </span>
      <Button className={PRIMARY_BUTTON_CLASSES} onClick={handleAccept} disabled={state.submitting}>
        {state.submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {state.submitting
          ? t('invitationAccept.accepting')
          : t('invitationAccept.acceptButton')}
      </Button>
      <Button
        variant="ghost"
        className="h-auto rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground"
        onClick={signOut}
        disabled={state.submitting}
      >
        {t('invitationAccept.notYouSignOut')}
      </Button>
    </AuthShell>
  );
}
