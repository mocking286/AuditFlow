# JEAuditFlow 7.4.0 Installation and Configuration

This guide covers the two 7.4.0 release downloads:

- `JEAuditFlow-7.4.0-Backend.zip`: Linux Node.js API, FileAnalyst service files, and JiraFlow runtime.
- `JEAuditFlow-7.4.0-Browser-Extension.zip`: Chrome/Edge user interface and local browser extension.

The extension is the browser UI; the backend is the shared API service. The backend package does not contain a database server, TLS certificate, domain, or preconfigured credentials.

## 1. Prerequisites

### Linux backend host

- 64-bit Linux server.
- Node.js 20 or later and npm.
- Java 21 runtime for the included JiraFlow service.
- MySQL 8.4 with InnoDB and a dedicated 7.4 database/user.
- Nginx or an equivalent HTTPS reverse proxy with a valid TLS certificate.
- A DNS name for the service, for example `audit.example.com`.

Use a new database such as `jeauditflow_740` for a new installation. Do not point this version at the old 6.8 database or reuse its volume without a separately planned, backed-up, and verified migration. The package does not perform a 6.8 data migration.

### Browser

- Current Chrome or Microsoft Edge with Manifest V3 support.
- Access to the backend's public HTTPS origin and a provisioned JEAuditFlow account.

## 2. Configure MySQL

Create a dedicated empty database and account using an administrator connection. Choose a unique password and keep it in the server's secret store.

```sql
CREATE DATABASE jeauditflow_740
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'jeauditflow'@'127.0.0.1' IDENTIFIED BY '<replace-with-a-unique-password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
  ON jeauditflow_740.* TO 'jeauditflow'@'127.0.0.1';
FLUSH PRIVILEGES;
```

The application and FileAnalyst create or upgrade their required tables at startup. The MySQL account therefore needs the listed DML and schema privileges on this database only. If MySQL is remote, restrict its network access to the application host and change the MySQL account host and connection URL accordingly.

## 3. Install the Backend

Copy the backend ZIP to the Linux server. Replace the example paths and asset location with your deployment values.

```bash
sudo useradd --system --home-dir /var/lib/jeauditflow --create-home \
  --shell /usr/sbin/nologin jeauditflow
sudo install -d -o jeauditflow -g jeauditflow /opt/jeauditflow/7.4.0
sudo install -d -o jeauditflow -g jeauditflow /var/lib/jeauditflow/{auditflow,users,fileanalyst,jiraflow}
sudo unzip -q JEAuditFlow-7.4.0-Backend.zip \
  -d /opt/jeauditflow/7.4.0
sudo chown -R jeauditflow:jeauditflow /opt/jeauditflow/7.4.0
```

Install production dependencies:

```bash
cd /opt/jeauditflow/7.4.0/server
npm ci --omit=dev

cd /opt/jeauditflow/7.4.0/fileanalyst
npm ci --omit=dev
```

Create `/etc/jeauditflow/jeauditflow.env` as root with mode `0600`. Replace all example values. Percent-encode reserved characters in the MySQL URL password.

```ini
NODE_ENV=production
AUDITFLOW_VERSION=7.4.0
AUDITFLOW_SERVER_ROLE=collaboration
AUDITFLOW_API_ONLY=1
AUDITFLOW_PORT=47273
AUDITFLOW_MYSQL_URL=mysql://jeauditflow:<url-encoded-password>@127.0.0.1:3306/jeauditflow_740
AUDITFLOW_OUTPUT_DIR=/var/lib/jeauditflow/auditflow
AUDITFLOW_USER_DATA_DIR=/var/lib/jeauditflow/users
AUDITFLOW_BOOTSTRAP_ADMIN_EMAIL=admin@example.com
AUDITFLOW_BOOTSTRAP_ADMIN_PASSWORD=<unique-password-at-least-10-characters>
AUDITFLOW_ALLOWED_EXTENSION_ORIGINS=chrome-extension://jcnjkbebdinfibjhjbokmdoobokjlkom
JIRAFLOW_HOST=127.0.0.1
JIRAFLOW_PORT=47375
JIRAFLOW_DATA_DIR=/var/lib/jeauditflow/jiraflow
```

`AUDITFLOW_API_ONLY=1` is appropriate when using the browser extension as the UI. If you separately install a matching Web Client and want the backend to serve it, set `AUDITFLOW_WEB_CLIENT_ROOT` to that extracted client directory and follow its deployment contract instead.

Protect the environment file:

```bash
sudo chown root:jeauditflow /etc/jeauditflow/jeauditflow.env
sudo chmod 0640 /etc/jeauditflow/jeauditflow.env
```

Create `/etc/systemd/system/jeauditflow-740.service`:

```ini
[Unit]
Description=JEAuditFlow 7.4.0 Collaboration API
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=jeauditflow
Group=jeauditflow
WorkingDirectory=/opt/jeauditflow/7.4.0/server
EnvironmentFile=/etc/jeauditflow/jeauditflow.env
ExecStart=/usr/bin/node server.mjs serve
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

If Node.js is not at `/usr/bin/node`, update `ExecStart` to the result of `command -v node`. Then start the API:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jeauditflow-740
sudo systemctl status jeauditflow-740 --no-pager
sudo journalctl -u jeauditflow-740 -n 100 --no-pager
```

The API listens on `127.0.0.1:47273`. JiraFlow runs on loopback at the configured `JIRAFLOW_PORT`; do not expose either port directly to the Internet.

## 4. Install FileAnalyst

In collaboration mode the API expects FileAnalyst as a separate process. Create `/etc/jeauditflow/fileanalyst.env`:

```ini
NODE_ENV=production
FILEANALYST_PORT=4310
FILEANALYST_HOST=127.0.0.1
FILEANALYST_BASE_PATH=/fileanalyst
FILEANALYST_STORAGE=mysql
FILEANALYST_REQUIRE_DATABASE=1
FILEANALYST_MYSQL_URL=mysql://jeauditflow:<url-encoded-password>@127.0.0.1:3306/jeauditflow_740
FILEANALYST_DATA_DIR=/var/lib/jeauditflow/fileanalyst
FILEANALYST_AUDITFLOW_AUTH_URL=http://127.0.0.1:47273/api/auth/me
FILEANALYST_AUDITFLOW_PROJECTS_URL=http://127.0.0.1:47273/api/projects
```

Create `/etc/systemd/system/jeauditflow-fileanalyst-740.service`:

```ini
[Unit]
Description=JEAuditFlow 7.4.0 FileAnalyst
After=network-online.target mysql.service jeauditflow-740.service
Wants=jeauditflow-740.service

[Service]
Type=simple
User=jeauditflow
Group=jeauditflow
WorkingDirectory=/opt/jeauditflow/7.4.0/fileanalyst
EnvironmentFile=/etc/jeauditflow/fileanalyst.env
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Protect the file and start the service:

```bash
sudo chown root:jeauditflow /etc/jeauditflow/fileanalyst.env
sudo chmod 0640 /etc/jeauditflow/fileanalyst.env
sudo systemctl daemon-reload
sudo systemctl enable --now jeauditflow-fileanalyst-740
sudo systemctl status jeauditflow-fileanalyst-740 --no-pager
```

## 5. Configure HTTPS Reverse Proxy

Terminate TLS at Nginx and proxy requests to the API process. The API itself proxies `/fileanalyst/` and `/jiraflow/` to the loopback services.

```nginx
server {
    listen 443 ssl http2;
    server_name audit.example.com;

    # Configure ssl_certificate and ssl_certificate_key for your certificate.

    client_max_body_size 30m;
    proxy_read_timeout 120s;

    # This package is the API endpoint; the browser extension supplies the UI.
    location = / {
        return 302 /api/health;
    }

    location / {
        proxy_pass http://127.0.0.1:47273;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

Configure HTTP on port 80 to redirect to HTTPS. Do not add wildcard CORS headers. Browser requests to `/api/`, `/fileanalyst/`, and `/jiraflow/` stay same-origin; extension requests are accepted only from the configured extension origin. Keep MySQL, `47273`, `4310`, and `47375` inaccessible from the public network.

Reload and inspect Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Load and Configure the Browser Extension

1. Download `JEAuditFlow-7.4.0-Browser-Extension.zip` and verify its SHA-256 against the Release page or `released/SHA256SUMS.txt`.
2. Extract the ZIP to a permanent local folder. Confirm that `manifest.json` is directly inside the selected folder.
3. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
4. Turn on **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
5. Pin JEAuditFlow from the browser Extensions menu and open it.
6. In JEAuditFlow, open **Settings → Collaboration**. Set the endpoint to `https://audit.example.com`, test the connection, and sign in with the provisioned server account.
7. When the browser asks for optional access to the configured HTTPS origin, approve it. The packaged extension ID is `jcnjkbebdinfibjhjbokmdoobokjlkom`; the backend CORS allowlist must include `chrome-extension://jcnjkbebdinfibjhjbokmdoobokjlkom`.
8. Select an authorized project. A server sign-in synchronizes the shared project representation; local AI preferences and browser-only settings remain on that client.

The browser extension archive does not contain API keys or server credentials. If a provider-backed AI service is configured, keep its key in a protected server environment/secret manager; never paste it into extension source or public settings.

## 7. Verify Installation

Run these from a client machine after TLS and reverse proxy setup:

```bash
curl -fsS https://audit.example.com/api/health
curl -fsS https://audit.example.com/jiraflow/health
curl -fsS https://audit.example.com/fileanalyst/api/health
```

Expected health data identifies JEAuditFlow version `7.4.0`, collaboration role, a configured MySQL database, healthy JiraFlow `2.1.0`, and healthy FileAnalyst `6.5.0`. The browser's Collaboration settings should report that the server is ready, and an authorized project should open without a CORS error.

Check service logs when a health endpoint fails:

```bash
sudo journalctl -u jeauditflow-740 -n 100 --no-pager
sudo journalctl -u jeauditflow-fileanalyst-740 -n 100 --no-pager
```

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Backend exits at startup | Confirm Node.js is 20+, `NODE_ENV=production`, MySQL is reachable, and the dedicated database user can create/alter tables. Inspect the API unit log. |
| `Production collaboration requires AUDITFLOW_MYSQL_URL` | Set `AUDITFLOW_MYSQL_URL` in the API unit environment file and restart the unit. |
| FileAnalyst health is unavailable | Confirm its unit is active, `FILEANALYST_STORAGE=mysql`, its database URL is valid, and it listens only on `127.0.0.1:4310`. |
| JiraFlow stays unavailable | Confirm Java 21 is installed and visible to the service account; check `JIRAFLOW_PORT`, permissions on `JIRAFLOW_DATA_DIR`, and API unit logs. |
| Browser reports CORS or network failure | Use one HTTPS origin consistently, proxy all paths through that origin, approve the extension's optional origin permission, and allow only the exact extension ID. Do not expose `127.0.0.1` on user computers or add `Access-Control-Allow-Origin: *`. |
| Sign-in is rejected | Confirm the bootstrap administrator was created, the account is enabled, the password meets the 10-character minimum, and the extension endpoint has no path suffix such as `/api`. |
| Browser keeps old behavior | Reload the extension from `edge://extensions` or `chrome://extensions`; for a hosted HTTPS page use a hard refresh after static assets/CDN are updated. |
| Port already in use | Choose unused loopback ports in systemd settings and update the corresponding Nginx and FileAnalyst URLs together. |

## 9. Upgrade Boundary

Do not replace a JEAuditFlow 6.8 installation by pointing 7.4 services at the same database directory or volume. Back up the 6.8 database and uploaded files, install 7.4 into separate paths with a new database, then plan and validate any required data conversion separately. This release package does not perform that migration.
