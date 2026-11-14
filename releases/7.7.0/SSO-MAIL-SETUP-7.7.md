# JEAuditFlow 7.7 SSO and assignment notifications

## Verified local state

On 2026-11-14, a presence-only check found no Microsoft Entra SSO or Graph
mail configuration in the installed local version configuration files through
7.6. No secret values were printed. SSO is implemented but is not activated
until an administrator supplies the registration and identity mapping below.

The local Outlook read-only account query timed out with AppleEvent error
`-1712`. No message was created or sent by that check. The Outlook desktop
adapter is implemented and covered by mocked transport tests; actual acceptance
and receipt in the user's mailbox have not been verified.

## Microsoft Entra SSO

Edit the version's protected configuration file, for example
`local-deploy/config/7.7.local.env`. Set:

| Setting | Required value |
| --- | --- |
| `AUDITFLOW_SSO_ENTRA_TENANT_ID` | The intended organization's tenant UUID |
| `AUDITFLOW_SSO_ENTRA_CLIENT_ID` | Registered application's client ID |
| `AUDITFLOW_SSO_ENTRA_CLIENT_SECRET` | Server-side application secret |
| `AUDITFLOW_SSO_ENTRA_REDIRECT_URI` | Exactly the callback URI registered in Entra |
| `AUDITFLOW_SSO_ENTRA_USER_MAP` | A JSON object mapping tenant object IDs to existing AuditFlow account IDs |

For this local 7.7 installation, the callback is
`http://127.0.0.1:47683/api/auth/sso/callback`. A hosted installation uses its
own HTTPS origin and `/api/auth/sso/callback`; it needs configuration on that
server. These are distinct registration targets.

Restart after configuration. `GET /api/auth/sso/config` returns only
`enabled` and the provider name. When enabled, the login form offers Microsoft
sign-in. The flow uses the authorization code, S256 PKCE, browser-bound state,
nonce, issuer/audience/expiry/signature validation, and an explicit tenant and
object-ID mapping. A successful Microsoft login uses the mapped existing
AuditFlow account and its existing project membership and process scopes.

An email address alone does not grant an account, assessor role or access to a
project. An unmapped or disabled account is rejected. Never put client secrets,
authorization codes or access tokens into URLs, browser storage or release
packages.

## Local Outlook desktop test

Set `AUDITFLOW_MAIL_TRANSPORT=outlook-desktop` and
`AUDITFLOW_MAIL_FROM` to the exact address of an account already configured in
Microsoft Outlook on this Mac. This transport additionally requires the
`desktop` server role and macOS.

The adapter finds exactly one matching Outlook account before creating the
message. Text is passed to `/usr/bin/osascript` as arguments without a shell.
The message has one explicit recipient and plain text content. The process
times out after 15 seconds and does not fall back to another transport.

macOS Automation must permit the process running JEAuditFlow to control
Microsoft Outlook. Some Outlook versions or account modes may not expose their
mail accounts to AppleScript. A timeout is a failed acceptance check; inspect
Outlook's Outbox before retrying so a possibly queued message is not duplicated.

Use the self-test command only after setting the intended sender:

```bash
AUDITFLOW_SERVER_ROLE=desktop \
AUDITFLOW_MAIL_TRANSPORT=outlook-desktop \
AUDITFLOW_MAIL_FROM='your-configured-Outlook-address' \
node scripts/test-outlook-self-mail.mjs --send-to-self
```

The command sends only to the configured sender's own address and contains no
project evidence or private assessment data. It reports transport acceptance,
which is separate from receiving the message in the Inbox.

## Microsoft Graph transport

For a server using Graph, select
`AUDITFLOW_MAIL_TRANSPORT=microsoft-graph` and configure:

| Setting | Required value |
| --- | --- |
| `AUDITFLOW_MAIL_ENTRA_TENANT_ID` | Mail application's tenant UUID |
| `AUDITFLOW_MAIL_ENTRA_CLIENT_ID` | Mail application's client ID |
| `AUDITFLOW_MAIL_ENTRA_CLIENT_SECRET` | Server-side application secret |
| `AUDITFLOW_MAIL_FROM` | Explicit sender mailbox |

The implementation obtains an application token with
`https://graph.microsoft.com/.default` and calls
`POST /v1.0/users/{sender}/sendMail`. The registered application and mailbox
must permit that operation. Opening or signing in to the Outlook desktop app
does not configure this Graph transport.

The transport accepts only Graph's HTTP 202 response as successful submission.
AuditFlow stores `accepted`, never `delivered`, for that response. Tokens are
held in server memory and are excluded from task notifications, API payloads
and release artifacts.

## Assignment workflow

An authorized Assessor may assign in-scope BP/GP or assessor-record work to
another Assessor in the same project and compatible process scope. A Lead
Assessor may also assign an existing finding or a whole process. The assignment
form stores the selected targets, recipient account, remark and optional due
date. The server resolves the recipient email from the existing active
AuditFlow account; the client cannot choose an arbitrary mail recipient.

Creation, reassignment and status changes add a persisted task notification.
The server records transport acceptance or failure. If transport is
unconfigured, the task is retained and the notification remains failed; the
task is not discarded. A retry uses the stored recipient and requires project
authorization. An already accepted notification is not resent.

Task progress is independent of formal ASPICE ratings and finding closure.
The assignee can work and submit; the task creator or Lead Assessor accepts
completion. Completing a task or receiving an email does not confirm evidence,
close an NC or change a capability decision.
