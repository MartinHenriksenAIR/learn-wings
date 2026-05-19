---
id: "ADR-0009"
title: "Resend for Transactional Email"
status: accepted
date: 2026-05-19
deciders: ['le-dawg']
tags: ['email', 'backend', 'integration']
policy:
  imports: {'disallow': ['nodemailer', '@sendgrid/mail', 'mailgun.js'], 'prefer': ['resend']}
  rationales: ['Resend is the transactional email provider; no Nodemailer or competing email SDKs']approval_date: 2026-05-19
approval_notes: "Baseline approval"

---

## Context

The platform sends invitation emails with tokenized links for org and platform admin workflows. Originally sent via Supabase Edge Function using SMTP or a third-party email API. The Azure migration needs a reliable transactional email provider that works from Azure Functions with minimal configuration.

## Decision

Use Resend (resend.com) as the transactional email provider. The send-invitation-email Azure Function calls the Resend API using RESEND_API_KEY from Key Vault. Don't use Nodemailer with direct SMTP, SendGrid, or Mailgun unless Resend is explicitly replaced by a future ADR.

## Consequences

Positive: Simple REST API, good deliverability, existing function logic can be ported directly. Negative: External SaaS dependency; API key must be stored in Key Vault as resend-api-key before deployment.

## Alternatives

1. Azure Communication Services (Email) — rejected: more complex setup, requires Azure domain verification; Resend already in use in Supabase function. 2. SendGrid — rejected: Resend has simpler API, better developer experience, and was already chosen in the Supabase implementation. 3. Nodemailer + SMTP — rejected: requires SMTP server management; Azure blocks outbound port 25 on many SKUs.
