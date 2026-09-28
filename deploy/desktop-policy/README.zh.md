# Desktop policy service

[English](README.md) | 中文

此服务实现仓库 API 提案中的 Desktop 强制更新接口。它通过 OIDC 使用 Zitadel，提供 Desktop 客户端所需的测试登录流程。它不会替代 Desktop 更新源或发布托管服务。

## Flow

1. Desktop 在没有会话 Cookie 的情况下调用 GET /api/v0/check_client_update。
2. 服务返回带有 UNAUTHENTICATED 错误的 HTTP 401。
3. Desktop 打开 policy origin。GET / 重定向到 Zitadel 授权端点。
4. Zitadel 重定向到 /oauth/callback。服务交换授权码，调用 userinfo，并设置带签名的 HttpOnly 会话 Cookie。
5. Desktop 重试 policy 请求。服务返回 no-force 响应，或返回 Desktop 所需的扁平化 40005 响应。

回调路径使用标准的 `/oauth/callback` 名称。身份提供方是 Zitadel；此服务不会调用飞书 API。

## Zitadel setup

在 Zitadel 中创建 OIDC 应用，并配置以下精确的重定向 URI：

    https://policy.example.com/oauth/callback

使用启用 PKCE 的授权码流程。客户端密钥是可选的：公共客户端将 `ZITADEL_CLIENT_SECRET` 留空，此时令牌请求只发送 `client_id` 和 PKCE verifier，不发送密钥。将 `ZITADEL_ISSUER` 设置为 Zitadel 实例的 origin，不要包含路径或末尾斜杠。服务请求 openid profile email 权限，校验回调 state 和 PKCE verifier，交换授权码，并通过 OIDC userinfo 验证返回的 subject。

回调仍必须能够访问此 policy service。Zitadel Native 应用通常会将重定向限制为自定义协议或 loopback HTTP URI。按照当前 Desktop 回调流程，这些 URI 无法访问单独托管的 policy service。对于托管的 policy service，请使用支持无客户端认证 PKCE 的 Zitadel Web 应用；如果你的 Zitadel 版本提供该选项，也可以配置公共 Web 客户端。

## Configuration

将 .env.example 复制到部署密钥存储中。PUBLIC_ORIGIN 必须是 DSH_DESKTOP_POLICY_TEST_ORIGIN 使用的 HTTPS origin。将 DSH_DESKTOP_AUTH_TEST_ORIGIN 设置为精确的 Zitadel origin，例如 https://tenant.zitadel.cloud. GitHub workflow 会将该 origin 写入 allowedAuthOrigins；不要包含 /oauth/v2/authorize、路径、查询参数或末尾斜杠。

MIN_DESKTOP_VERSION 是允许继续运行的第一个版本。当 Desktop 版本或内置 dsh 版本任一低于该值时，客户端会被阻止。留空可让所有有效客户端继续收到 no-force 响应。服务会匹配平台、架构、渠道和完整的 SemVer 值。

服务将 DOWNLOAD_PAGE_URL 作为 desktop_app_link 返回；未设置时，它默认为 PUBLIC_ORIGIN 加上 /download。由于当前 workflow 只允许使用 policy origin 访问此页面，请保持该 URL 位于 policy origin 下。服务中的路由只是占位页面；请在该路径提供实际发布页面，或将 DOWNLOAD_PAGE_URL 设置为获准的同源路径。

## Run

    node deploy/desktop-policy/server.mjs

使用 docker build -t dsh-desktop-policy deploy/desktop-policy 构建随附镜像，并在运行时注入环境值。请将服务置于 HTTPS 反向代理或负载均衡器之后。签名会话 Cookie 是无状态的，因此副本可以共享流量；多个副本必须使用相同的 SESSION_SECRET。

使用 Docker Compose 时，将 `.env.example` 复制为 `.env`，填入部署值，然后从此目录启动服务：

    cd deploy/desktop-policy
    cp .env.example .env
    docker compose up -d --build

在 PowerShell 中，如果 `cp` 别名不可用，请使用 `Copy-Item .env.example .env`。

Compose 文件默认绑定 `127.0.0.1:8787`。如果需要其他本地端口，请在启动前设置 `POLICY_PORT`。在反向代理处终止 HTTPS，并将公开的 policy origin 转发到此本地端口；Zitadel 重定向 URI 仍为 `https://<policy-origin>/oauth/callback`。

服务不会存储用户资料或 refresh token。Zitadel token 只在回调期间使用，不会写入磁盘。policy endpoint 会发送 Cache-Control no-store。

## GitHub Actions variables

请设置仓库 Variables，而不是 Secrets，因为 workflow 读取的是 vars.*：

    DSH_DESKTOP_POLICY_TEST_ORIGIN=https://policy.example.com
    DSH_DESKTOP_AUTH_TEST_ORIGIN=https://tenant.zitadel.cloud

将 SESSION_SECRET 保存在 policy service 的部署密钥存储中。如果使用机密型 Zitadel 客户端，也将 `ZITADEL_CLIENT_SECRET` 保存在那里；公共客户端将其留空。不要将任一密钥放入 GitHub Actions Variables 或仓库。
