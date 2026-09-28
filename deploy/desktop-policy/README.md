# Desktop policy service

English | [中文](README.zh.md)

This service implements the Desktop mandatory-update endpoint from the repository API proposal. It uses Zitadel through OIDC for the test login flow expected by the Desktop client. It does not replace Desktop updater feeds or release hosting.

## Flow

1. Desktop calls GET /api/v0/check_client_update without a session cookie.
2. The service returns HTTP 401 with an UNAUTHENTICATED error.
3. Desktop opens the policy origin. GET / redirects to the Zitadel authorization endpoint.
4. Zitadel redirects to /oauth/callback. The service exchanges the code, calls userinfo, and sets a signed HttpOnly session cookie.
5. Desktop retries the policy request. The service returns either the no-force response or the flattened 40005 response required by Desktop.

The callback path uses the standard `/oauth/callback` name. The identity provider is Zitadel; this service does not call a Feishu API.

## Zitadel setup

Create an OIDC application in Zitadel and configure this exact redirect URI:

    https://policy.example.com/oauth/callback

Use authorization-code flow with PKCE enabled. A client secret is optional: leave `ZITADEL_CLIENT_SECRET` empty for a public client, and the token request then sends `client_id` plus the PKCE verifier without a secret. Set `ZITADEL_ISSUER` to the Zitadel instance origin, without a path or trailing slash. The service requests openid profile email, validates the callback state and PKCE verifier, exchanges the code, and verifies the returned subject through OIDC userinfo.

The callback still has to reach this policy service. Zitadel Native applications normally restrict redirects to a custom protocol or loopback HTTP URI. Those URIs cannot reach a separately hosted policy service through the current Desktop callback flow. For a hosted policy service, use a Zitadel Web application that supports PKCE without client authentication, or configure a public Web client if your Zitadel version exposes that option.

## Configuration

Copy .env.example to the deployment secret store. PUBLIC_ORIGIN must be the HTTPS origin used for DSH_DESKTOP_POLICY_TEST_ORIGIN. Set DSH_DESKTOP_AUTH_TEST_ORIGIN to the exact Zitadel origin, for example https://tenant.zitadel.cloud. The GitHub workflow writes that origin into allowedAuthOrigins; do not include /oauth/v2/authorize, a path, a query, or a trailing slash.

MIN_DESKTOP_VERSION is the first version that is allowed to continue. A client is blocked when either its Desktop version or bundled dsh version is lower. Leave it empty to keep all valid clients on the no-force response. The service matches platform, architecture, channel, and complete SemVer values.

The service returns desktop_app_link as DOWNLOAD_PAGE_URL, defaulting to PUBLIC_ORIGIN followed by /download. Keep that URL on the policy origin because the current workflow allows only the policy origin for this page. The service route is a placeholder page; serve the actual release page at that path or set DOWNLOAD_PAGE_URL to an approved same-origin path.

## Run

    node deploy/desktop-policy/server.mjs

Build the included image with docker build -t dsh-desktop-policy deploy/desktop-policy and inject environment values at runtime. Put the service behind an HTTPS reverse proxy or load balancer. The signed session cookie is stateless, so replicas can share traffic; keep SESSION_SECRET identical across replicas.

For Docker Compose, copy `.env.example` to `.env`, fill in the deployment values, and start the service from this directory:

    cd deploy/desktop-policy
    cp .env.example .env
    docker compose up -d --build

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if the alias is unavailable.

The Compose file binds `127.0.0.1:8787` by default. Set `POLICY_PORT` before starting when another local port is needed. Terminate HTTPS at a reverse proxy and forward the public policy origin to this local port; the Zitadel redirect URI remains `https://<policy-origin>/oauth/callback`.

The service does not store user profiles or refresh tokens. Zitadel tokens are used only during the callback and are not written to disk. The policy endpoint sends Cache-Control no-store.

## GitHub Actions variables

Set repository Variables, not Secrets, because the workflow reads vars.*:

    DSH_DESKTOP_POLICY_TEST_ORIGIN=https://policy.example.com
    DSH_DESKTOP_AUTH_TEST_ORIGIN=https://tenant.zitadel.cloud

Keep SESSION_SECRET in the policy service deployment secret store. If you use a confidential Zitadel client, keep `ZITADEL_CLIENT_SECRET` there too; public clients leave it empty. Do not put either secret in GitHub Actions Variables or in the repository.
