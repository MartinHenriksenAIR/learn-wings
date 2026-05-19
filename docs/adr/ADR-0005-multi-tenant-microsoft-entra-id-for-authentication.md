---
id: "ADR-0005"
title: "Multi-Tenant Microsoft Entra ID for Authentication"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['authentication', 'security', 'azure', 'migration']
policy:
  imports: {'disallow': ['@supabase/supabase-js', 'passport', 'jsonwebtoken-express', 'express-jwt'], 'prefer': ['@azure/msal-browser', '@azure/msal-react', 'jwks-rsa', 'jsonwebtoken']}
  rationales: ['Multi-tenant Entra ID is the only auth provider; Supabase Auth and custom JWT endpoints are banned']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The platform originally used Supabase Auth (email/password). The migration to Azure requires replacing this. Users include learners from external organizations (different Azure tenants), so the auth solution must support cross-tenant sign-in without per-tenant configuration. Password management, MFA, and enterprise SSO must be handled by the identity provider, not the application.

## Decision

Use multi-tenant Microsoft Entra ID (standard Entra ID app registration with signInAudience: AzureADandPersonalMicrosoftAccount or AzureADMultipleOrgs) for all authentication. Frontend uses @azure/msal-browser + @azure/msal-react with loginRedirect flow and authority https://login.microsoftonline.com/common. Backend validates RS256 JWT tokens using jwks-rsa + jsonwebtoken with issuer regex pattern (multi-tenant issuers vary by tenant). Don't use Azure AD B2C. Don't use custom username/password endpoints. Don't use Supabase Auth.

## Consequences

Positive: No password storage in app DB, MFA and SSO handled by Microsoft, users from any Entra tenant can sign in, enterprise-grade security. Negative: Users must have a Microsoft account; no email/password fallback. Existing Supabase users need one-time email-based identity merge to preserve course progress. User identity uses oid + tid (both required for global uniqueness across tenants).

## Alternatives

1. Azure AD B2C — rejected: designed for consumer identity with custom policies; requires per-tenant configuration for enterprise use cases; significant setup overhead. 2. Custom JWT with bcrypt — rejected: password storage, MFA, and security maintenance burden falls on the app. 3. Auth0 / Okta — rejected: additional SaaS cost and vendor dependency when Entra ID already available in Azure subscription. 4. Keep Supabase Auth — rejected: contradicts the goal of removing all Supabase dependencies.
