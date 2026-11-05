#!/usr/bin/env python3
"""PingOne Privilege AI Gateway - Kubernetes Deployment Guide (customer-facing PDF).

Styling follows the Ping Identity doc-site look: Montserrat headings, Ping Red
accents, dark cover band, numbered sections, code blocks, tables, note/warning
callouts.
"""
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, KeepTogether,
                                ListFlowable, ListItem, Preformatted, HRFlowable, Image)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ASSETS = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ASSETS, "PingOne-Privilege-AI-Gateway-K8s-Deployment-Guide.pdf")

# ---------- fonts ----------
pdfmetrics.registerFont(TTFont("Montserrat", os.path.join(ASSETS, "Montserrat-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Montserrat-Md", os.path.join(ASSETS, "Montserrat-Medium.ttf")))
pdfmetrics.registerFont(TTFont("Montserrat-Sb", os.path.join(ASSETS, "Montserrat-SemiBold.ttf")))
pdfmetrics.registerFont(TTFont("Montserrat-Bd", os.path.join(ASSETS, "Montserrat-Bold.ttf")))
pdfmetrics.registerFont(TTFont("PlexMono", os.path.join(ASSETS, "IBMPlexMono-Regular.ttf")))

# ---------- Ping palette ----------
PING_RED = colors.HexColor("#d20e0f")
PING_RED_DARK = colors.HexColor("#aa0005")
CORE_DARK = colors.HexColor("#051727")
PING_BLUE = colors.HexColor("#12538d")
GRAY700 = colors.HexColor("#263746")
GRAY600 = colors.HexColor("#5c646b")
GRAY400 = colors.HexColor("#e0e2e4")
GRAY200 = colors.HexColor("#f7f8f8")
GRAY100 = colors.HexColor("#fcfcfc")
CODE_BG = colors.HexColor("#0b2233")
NOTE_BG = colors.HexColor("#eef4fb")
NOTE_BAR = colors.HexColor("#12538d")
WARN_BG = colors.HexColor("#fdeeee")
WARN_BAR = colors.HexColor("#d20e0f")

PAGE_W, PAGE_H = LETTER
M_L, M_R, M_T, M_B = 0.9 * inch, 0.9 * inch, 1.05 * inch, 0.85 * inch
CONTENT_W = PAGE_W - M_L - M_R

# ---------- styles ----------
def st(name, **kw):
    base = dict(fontName="Montserrat", fontSize=9.5, leading=14, textColor=GRAY700,
                spaceAfter=6, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    "h1": st("h1", fontName="Montserrat-Bd", fontSize=20, leading=25, textColor=CORE_DARK,
             spaceBefore=4, spaceAfter=4),
    "h2": st("h2", fontName="Montserrat-Sb", fontSize=13.5, leading=18, textColor=CORE_DARK,
             spaceBefore=14, spaceAfter=6),
    "h3": st("h3", fontName="Montserrat-Sb", fontSize=11, leading=15, textColor=PING_RED,
             spaceBefore=10, spaceAfter=4),
    "body": st("body"),
    "lead": st("lead", fontSize=10.5, leading=16, textColor=GRAY600),
    "bullet": st("bullet", leading=13.5, spaceAfter=3),
    "code": ParagraphStyle("code", fontName="PlexMono", fontSize=8, leading=11.5,
                           textColor=colors.HexColor("#dbe7f0"), backColor=CODE_BG,
                           borderPadding=(8, 10, 8, 10), spaceBefore=4, spaceAfter=10),
    "tblhead": st("tblhead", fontName="Montserrat-Sb", fontSize=8.5, leading=11,
                  textColor=colors.white, spaceAfter=0),
    "tblcell": st("tblcell", fontSize=8.5, leading=11.5, spaceAfter=0),
    "tblmono": ParagraphStyle("tblmono", fontName="PlexMono", fontSize=7.8, leading=10.5,
                              textColor=GRAY700, spaceAfter=0),
    "note": st("note", fontSize=9, leading=13, spaceAfter=0),
    "cover-title": st("cover-title", fontName="Montserrat-Bd", fontSize=30, leading=37,
                      textColor=colors.white, alignment=TA_LEFT, spaceAfter=0),
    "cover-sub": st("cover-sub", fontSize=13, leading=19, textColor=colors.HexColor("#bcd2e2")),
    "footer-l": st("footer-l", fontSize=7.5, textColor=GRAY600),
}

# ---------- page furniture ----------
def cover_page(canvas, doc):
    canvas.saveState()
    band_h = PAGE_H * 0.62
    canvas.setFillColor(CORE_DARK)
    canvas.rect(0, PAGE_H - band_h, PAGE_W, band_h, stroke=0, fill=1)
    canvas.setFillColor(PING_RED)
    canvas.rect(0, PAGE_H - band_h, PAGE_W, 6, stroke=0, fill=1)
    # logo
    logo = os.path.join(ASSETS, "ping-logo.png")
    if os.path.exists(logo):
        canvas.drawImage(logo, M_L, PAGE_H - 2.7 * inch,
                         width=0.85 * inch, height=0.85 * inch, mask="auto")
    # eyebrow
    canvas.setFillColor(PING_RED)
    canvas.setFont("Montserrat-Sb", 10)
    canvas.drawString(M_L, PAGE_H - band_h + 0.4 * inch, "DEPLOYMENT GUIDE")
    # title block (drawn here so it can never spill onto the white area)
    y = PAGE_H - 4.35 * inch
    canvas.setFillColor(colors.white)
    canvas.setFont("Montserrat-Bd", 30)
    canvas.drawString(M_L, y, "PingOne Privilege\u2122")
    canvas.drawString(M_L, y - 37, "AI Gateway")
    canvas.setFillColor(colors.HexColor("#bcd2e2"))
    canvas.setFont("Montserrat", 13)
    canvas.drawString(M_L, y - 74, "Kubernetes Deployment Guide")
    canvas.drawString(M_L, y - 98, "High-availability deployment with an integrated load balancer")
    canvas.restoreState()

def body_page(canvas, doc):
    canvas.saveState()
    # header rule + section hint
    canvas.setStrokeColor(GRAY400)
    canvas.setLineWidth(0.6)
    canvas.line(M_L, PAGE_H - 0.62 * inch, PAGE_W - M_R, PAGE_H - 0.62 * inch)
    canvas.setFillColor(GRAY600)
    canvas.setFont("Montserrat-Md", 7.5)
    canvas.drawString(M_L, PAGE_H - 0.55 * inch,
                      "PingOne Privilege AI Gateway  ·  Kubernetes Deployment Guide")
    canvas.setFillColor(PING_RED)
    canvas.setFont("Montserrat-Sb", 7.5)
    canvas.drawRightString(PAGE_W - M_R, PAGE_H - 0.55 * inch, "PING IDENTITY")
    # footer
    canvas.setStrokeColor(GRAY400)
    canvas.line(M_L, 0.62 * inch, PAGE_W - M_R, 0.62 * inch)
    canvas.setFillColor(GRAY600)
    canvas.setFont("Montserrat", 7.5)
    canvas.drawString(M_L, 0.45 * inch, "Ping Identity Proprietary and Confidential")
    canvas.drawRightString(PAGE_W - M_R, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()

class GuideDoc(BaseDocTemplate):
    def afterFlowable(self, fl):
        pass

doc = GuideDoc(OUT, pagesize=LETTER,
               leftMargin=M_L, rightMargin=M_R, topMargin=M_T, bottomMargin=M_B,
               title="PingOne Privilege AI Gateway — Kubernetes Deployment Guide",
               author="Ping Identity")
cover_frame = Frame(M_L, PAGE_H * 0.62 + 0.5 * inch, CONTENT_W, 2.05 * inch, id="cover")
body_frame = Frame(M_L, M_B, CONTENT_W, PAGE_H - M_T - M_B, id="body")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[cover_frame], onPage=cover_page),
    PageTemplate(id="body", frames=[body_frame], onPage=body_page),
])

story = []
def P(text, style="body"):
    story.append(Paragraph(text, S[style]))

def H1(num, text):
    story.append(Paragraph(f'<font color="#d20e0f">{num}</font>  {text}', S["h1"]))
    story.append(HRFlowable(width="100%", thickness=1.2, color=PING_RED, spaceBefore=2, spaceAfter=10))

def H2(text): story.append(Paragraph(text, S["h2"]))
def H3(text): story.append(Paragraph(text, S["h3"]))

def bullets(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, S["bullet"]), leftIndent=14) for t in items],
        bulletType="bullet", start="•", bulletFontSize=9, leftIndent=10))

def numbered(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, S["bullet"]), leftIndent=18) for t in items],
        bulletType="1", leftIndent=12))

def code(text, title=None):
    story.append(Preformatted(text, S["code"]))

def callout(kind, text):
    bg, bar = (NOTE_BG, NOTE_BAR) if kind == "note" else (WARN_BG, WARN_BAR)
    label = "NOTE" if kind == "note" else "IMPORTANT"
    inner = Paragraph(
        f'<font name="Montserrat-Sb" size="8" color="{("#12538d" if kind=="note" else "#d20e0f")}">{label}</font><br/>'
        + text, S["note"])
    t = Table([[inner]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3, bar),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(Spacer(1, 4))
    story.append(t)
    story.append(Spacer(1, 10))

def table(headers, rows, mono_cols=()):
    head = [Paragraph(h, S["tblhead"]) for h in headers]
    body = []
    for r in rows:
        body.append([Paragraph(c, S["tblmono"] if i in mono_cols else S["tblcell"])
                     for i, c in enumerate(r)])
    t = Table([head] + body, colWidths=[CONTENT_W / len(headers)] * len(headers), repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), CORE_DARK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GRAY200]),
        ("GRID", (0, 0), (-1, -1), 0.5, GRAY400),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(Spacer(1, 4))
    story.append(t)
    story.append(Spacer(1, 10))

MONO = lambda s: f'<font name="PlexMono" size="8.3" color="#aa0005">{s}</font>'

# =====================================================================
# COVER
# =====================================================================
from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate("body"))
story.append(Spacer(1, 1))
story.append(PageBreak())

# =====================================================================
# CONTENTS
# =====================================================================
story.append(Paragraph("Contents", S["h1"]))
story.append(HRFlowable(width="100%", thickness=1.2, color=PING_RED, spaceBefore=2, spaceAfter=12))
toc_rows = [
    ["1", "Introduction and audience"],
    ["2", "Architecture overview"],
    ["3", "Prerequisites"],
    ["4", "Configuring the PingOne OIDC application"],
    ["5", "Deploying the first gateway"],
    ["6", "Shared Redis state store"],
    ["7", "Deploying the integrated load balancer"],
    ["8", "Adding a second gateway node"],
    ["9", "Registering MCP servers as applications"],
    ["10", "Verification"],
    ["11", "Operational considerations"],
    ["12", "Troubleshooting"],
    ["Appendix A", "Resource summary"],
]
for n, t in toc_rows:
    story.append(Paragraph(
        f'<font name="Montserrat-Sb" color="#d20e0f">{n}</font>&nbsp;&nbsp;&nbsp;{t}',
        st("toc", fontSize=10.5, leading=20)))
story.append(PageBreak())

# =====================================================================
# 1 INTRODUCTION
# =====================================================================
H1("1", "Introduction and audience")
P("This guide describes how to deploy the PingOne Privilege AI Gateway on a Kubernetes "
  "cluster in a high-availability configuration. The deployment uses the official "
  "<i>agentless-mcpgw</i> Helm chart and includes an integrated load balancer that presents "
  "a single, stable URL to MCP clients while distributing traffic across gateway nodes.", "lead")
H3("Audience")
P("This guide is intended for platform engineers and administrators who are familiar with:")
bullets([
    "Kubernetes operations, including <i>kubectl</i> and namespaces",
    "Helm package management (Helm 3.14 or later is recommended)",
    "OAuth 2.0 / OpenID Connect concepts, particularly dynamic client registration",
    "The Model Context Protocol (MCP) and how AI agents consume MCP servers",
])
H3("What this deployment provides")
bullets([
    "<b>One public URL</b> for every MCP client and application — no client-side changes when gateways are added or removed.",
    "<b>Gateway high availability</b> — multiple gateway nodes serve the same mesh cluster; a failed node is removed from rotation automatically.",
    "<b>Durable client registrations</b> — a shared Redis store preserves dynamic client registrations across gateway restarts and failovers.",
    "<b>Centralized policy enforcement</b> — per-application authorization policies, guardrails and audit logging remain in force regardless of which node serves a request.",
])
callout("note",
        "This guide reflects the tested reference deployment. Where behavior was verified "
        "against a live cluster, it is stated as such; items that depend on your environment "
        "are marked as environment-specific.")

# =====================================================================
# 2 ARCHITECTURE
# =====================================================================
H1("2", "Architecture overview")
H3("Request path")
code("""MCP client / AI agent (browser, IDE, Postman, LM Studio)
        |
        |  https://mcpgw.example.com/<AppName>/mcp
        v
Ingress controller (TLS termination, public hostname)
        |
        v
mcpgw-lb service :8623   (integrated load balancer, 2 replicas)
        |    consistent-hash pinning: client address + application path
        v
Gateway node 1 ---- Gateway node 2 ---- Gateway node N
   (all nodes are members of ONE mesh cluster)
        |
        v
MCP backends: sidecar containers (localhost) or cluster services""")
H3("Components")
table(["Component", "Role", "Notes"], [
    ["Gateway (agentless-mcpgw)", "Serves MCP traffic, OAuth flows, policy enforcement and audit",
     "Deployed with the official Helm chart; one release per node"],
    ["Mesh cluster", "Logical grouping of gateway nodes in the Privilege console",
     "Applications are registered once per cluster; every node serves them"],
    ["Load balancer (mcpgw-lb)", "Single entry point; pins each client + application to one node",
     "Ships as part of the Helm chart; HAProxy-based health checks"],
    ["Shared Redis", "Stores dynamic client registrations",
     "Survives gateway restarts and failover; tokens are not shared"],
    ["Sidecar MCP servers", "Backends running inside the gateway pod on localhost ports",
     "Required for catalog applications pinned to http://localhost:8080/mcp"],
], mono_cols=())
H3("Session behavior and failover")
P("Each gateway node holds issued access tokens in memory. The load balancer therefore "
  "<b>pins</b> every client, for every path of a given application, to the node that "
  "authenticated it. On failover:")
bullets([
    "Client <b>registrations</b> survive (shared Redis) — clients are still known to the other node.",
    "Client <b>tokens do not survive</b> — affected clients re-authenticate automatically; with single sign-on this typically takes under 30 seconds and usually requires no prompt.",
    "The load balancer holds a failed or restarting node out of rotation until it passes a configurable number of consecutive health checks.",
])
callout("note",
        "Round-robin load balancing across gateway nodes is not supported: a token issued by "
        "one node is rejected by the others. The integrated load balancer enforces pinning "
        "automatically — do not replace it with a generic round-robin service.")

# =====================================================================
# 3 PREREQUISITES
# =====================================================================
H1("3", "Prerequisites")
table(["Requirement", "Details"], [
    ["Kubernetes cluster", "Version 1.25 or later; at least 2 worker nodes for HA"],
    ["Helm", "3.12 or later"],
    ["Ingress controller", "nginx (or equivalent) with TLS termination and a wildcard or per-host certificate"],
    ["Certificate issuer", "cert-manager with a Let's Encrypt (or corporate CA) ClusterIssuer"],
    ["DNS", "A public hostname for the gateway URL, published from the ingress (for example via external-dns)"],
    ["PingOne environment", "A PingOne environment with the PingOne Privilege service enabled, tenant administrator access"],
    ["Container registry access", "Image pull secret for the gateway and sidecar images"],
])
H3("Environment checks")
code("""kubectl config current-context          # confirm the intended cluster
kubectl get clusterissuer               # a Ready issuer must exist
kubectl get ingressclass                # note the default ingress class
helm version""")
callout("note",
        "Replace all hostnames, namespaces and identifiers in this guide with your own "
        "values. The examples use <font name='PlexMono' size='8'>mcpgw.example.com</font> "
        "and the namespace <font name='PlexMono' size='8'>privilege-gw</font>.")

# =====================================================================
# 4 PINGONE OIDC APP
# =====================================================================
H1("4", "Configuring the PingOne OIDC application")
P("The gateway signs users in through an OIDC application in your PingOne environment. "
  "Create it in the PingOne admin console before deploying the gateway.")
numbered([
    "In the PingOne admin console, go to <b>Applications</b> and click <b>+ Add Application</b>.",
    "Select <b>Web Application</b>. Note the generated <b>client ID</b> and <b>client secret</b>.",
    "On the <b>Configuration</b> tab, set Token Endpoint Authentication Method to <b>Client Secret Basic</b>.",
    "Set the redirect URI to <font name='PlexMono' size='8'>https://mcpgw.example.com/callback</font>.",
    "On the <b>Grants</b> tab, enable <b>Authorization Code</b> and <b>Token Exchange</b>.",
    "On the <b>Resources</b> tab, grant <font name='PlexMono' size='8'>openid</font>, "
    "<font name='PlexMono' size='8'>profile</font> and <font name='PlexMono' size='8'>email</font>.",
    "Save the application. Record the environment ID — it appears in your OIDC endpoints.",
])
callout("warn",
        "Do not enable PKCE-only or public-client settings on this application. The gateway "
        "authenticates to the token endpoint with the client secret (Client Secret Basic).")

# =====================================================================
# 5 DEPLOY GATEWAY 1
# =====================================================================
H1("5", "Deploying the first gateway")
H3("5.1  Generate an enrollment token")
numbered([
    "In the Privilege console, open <b>Gateways</b> and click <b>Add New</b>.",
    "Choose the <b>AI GW</b> form (the Docker command option).",
    "Enter a <b>Cluster ID</b> — this names your mesh cluster (for example "
    "<font name='PlexMono' size='8'>production-cluster</font>). Applications reference this ID.",
    "Enter the <b>Host IP</b>: the node's own in-cluster Kubernetes Service name (see section 8).",
    "Click <b>Get Docker Command</b> and copy the value of "
    "<font name='PlexMono' size='8'>ENV_PROXY_TOKEN</font> (the string beginning "
    "<font name='PlexMono' size='8'>eyJ</font>).",
])
callout("warn",
        "Enrollment tokens are single use and expire after approximately two hours. Strip any "
        "leading or trailing whitespace before saving the token — whitespace corrupts the "
        "signature check and crash-loops the gateway. Store the token in a file with owner-only "
        "permissions and delete it after use.")
H3("5.2  Create the secrets")
code("""cat > gw-secrets.yaml <<'YAML'
proxyToken: "eyJ..."            # enrollment token from the console
oidc:
  clientId: "<client ID>"
  clientSecret: "<client secret>"
  authUrl:  "https://auth.pingone.com/<environmentId>/as/authorize"
  tokenUrl: "https://auth.pingone.com/<environmentId>/as/token"
  userUrl:  "https://auth.pingone.com/<environmentId>/as/userinfo"
YAML
kubectl create namespace privilege-gw
kubectl -n privilege-gw create secret generic gw-oidc --from-file=gw-secrets.yaml
rm gw-secrets.yaml""")
H3("5.3  Install the chart")
code("""helm upgrade --install agentless-mcpgw <chart>.tgz \\
  --namespace privilege-gw \\
  --set hostname=mcpgw.example.com \\
  --set namespace=privilege-gw \\
  --set oidc.serverUrl=https://mcpgw.example.com \\
  --set-file proxyToken=<token-file> \\
  -f sidecars.values.yaml""")
P("The enrollment is persisted in the gateway's SSL persistent volume, so subsequent pod "
  "restarts do not need a new token.")
H3("5.4  Confirm enrollment")
code("""kubectl -n privilege-gw exec deploy/agentless-mcpgw -c log-tailer -- \\
  tail -100 /var/log/procyon/cyonproxy.log | grep -E 'ClusterID|LinkStatus'""")
P("Success is indicated by <font name='PlexMono' size='8'>ClusterID:&lt;your cluster&gt;</font> "
  "and <font name='PlexMono' size='8'>LinkStatus:Active</font>. Messages of the form "
  "<font name='PlexMono' size='8'>has same NodeURL</font> are cosmetic and can be ignored.")
callout("note",
        "The gateway writes its log to a file rather than stdout. Read it with the log-tailer "
        "sidecar as shown above.")
H3("5.5  Changing OIDC configuration")
P("OIDC settings are read from the secret at pod start. After any change to OIDC values, "
  "restart the gateway pod:")
code("kubectl -n privilege-gw rollout restart deploy/agentless-mcpgw")

# =====================================================================
# 6 REDIS
# =====================================================================
H1("6", "Shared Redis state store")
P("Gateway nodes keep dynamic client registrations in a Redis store when "
  "<font name='PlexMono' size='8'>MCPGW_REDIS_URL</font> is configured. Without it, every "
  "gateway restart forgets all registered clients and each client must register again. "
  "Deploy Redis before adding gateway nodes, because a gateway that cannot reach Redis "
  "at startup exits after six attempts.")
code("""# 1. Password secret and Redis itself
kubectl -n privilege-gw create secret generic privilege-redis \\
  --from-literal=password="$(openssl rand -base64 24 | tr -d '/+=')"
kubectl apply -f redis.yaml          # 1Gi PVC, append-only persistence recommended

# 2. URL secret (value is never printed)
URL="redis://:$(kubectl -n privilege-gw get secret privilege-redis \\
  -o jsonpath='{.data.password}' | base64 -d)@privilege-redis.privilege-gw.svc.cluster.local:6379/0"
kubectl -n privilege-gw create secret generic privilege-redis-url --from-literal=url="$URL"

# 3. Enable on the gateway release
helm upgrade agentless-mcpgw <chart>.tgz -n privilege-gw --reuse-values \\
  --set redis.urlSecret.name=privilege-redis-url""")
table(["Rule", "Reason"], [
    ["Never restart a gateway while Redis is down",
     "The gateway retries six times, then exits; the pod crash-loops until Redis returns"],
    ["Use the environment variable name MCPGW_REDIS_URL",
     "A bare REDIS_URL is ignored by the gateway"],
    ["Persist Redis on a volume (append-only file)",
     "A Redis restart then preserves registrations"],
    ["Keep Redis a single, small deployment",
     "It is a state store only; size 64 MB maxmemory is sufficient for registrations"],
])
P("Verify with the log line "
  "<font name='PlexMono' size='8'>Redis token store connected on attempt 1/6</font> in the "
  "gateway log, and by confirming that Redis holds keys after a client registration.")

# =====================================================================
# 7 LOAD BALANCER
# =====================================================================
H1("7", "Deploying the integrated load balancer")
P("The load balancer is part of the Helm chart "
  "(<font name='PlexMono' size='8'>templates/loadbalancer.yaml</font>) and is enabled on "
  "the primary gateway release. It provides:")
bullets([
    "<b>Consistent-hash pinning</b> — the routing key is the client address plus the first path segment (the application). One client's calls to one application always reach the same node while that node is healthy.",
    "<b>Callback routing by state tag</b> — OAuth callbacks carry a tag identifying the issuing node, so sign-in completes on the node that started it.",
    "<b>Active health checks</b> — each node is probed every 10 seconds; a failed node is held out of rotation for a configurable failover timeout (default 600 seconds).",
    "<b>Visibility</b> — every response carries an <font name='PlexMono' size='8'>X-Served-By</font> header naming the node that answered; an optional statistics page is available behind basic authentication.",
])
code("""helm upgrade agentless-mcpgw <chart>.tgz -n privilege-gw --reuse-values \\
  -f sidecars.values.yaml -f lb.values.yaml""")
table(["Value", "Purpose"], [
    ["loadBalancer.enabled", "Enables the load balancer; the ingress routes to it automatically"],
    ["loadBalancer.failTimeout", "How long a failed node is held out of rotation (default 600s)"],
    ["loadBalancer.peers[*].parked", "Removes a node from rotation (maintenance); restore with parked: false"],
    ["loadBalancer.ownParked", "Parks the local node (used to test the remaining nodes)"],
    ["loadBalancer.stats.auth", "user:password for the /lb-stats page; unset leaves the page at 401"],
    ["loadBalancer.runtimeSocket.enabled", "Enables runtime park/unpark through an admin API"],
])
callout("warn",
        "After any load balancer rollout or gateway restart, a node re-enters rotation only "
        "after 60 consecutive successful health checks (approximately 10 minutes with the "
        "default settings). During that window clients receive 503 responses with "
        "<font name='PlexMono' size='8'>node=&lt;NOSRV&gt;</font>. This is expected behavior, "
        "not an outage — do not restart the gateway in response, as that resets the timer. "
        "Time deployments accordingly.")
callout("note",
        "Always upgrade with the same values files (for example "
        "<font name='PlexMono' size='8'>sidecars.values.yaml</font>) and "
        "<font name='PlexMono' size='8'>--reuse-values</font>. An upgrade without them resets "
        "sidecar containers and routing to chart defaults.")

# =====================================================================
# 8 SECOND NODE
# =====================================================================
H1("8", "Adding a second gateway node")
P("For high availability, add at least one more gateway node to the same mesh cluster. "
  "Each node serves every application registered on the cluster; no application "
  "registration is duplicated.")
H3("8.1  Enroll the node")
numbered([
    "In the Privilege console, open <b>Gateways</b> and click <b>Add New</b>, then choose the <b>AI GW</b> form.",
    "Set <b>Cluster ID</b> to the <i>existing</i> cluster name — this makes the new deployment a second node rather than a new cluster.",
    "Set the <b>Host IP</b> to the new node's in-cluster Kubernetes Service name, for example "
    "<font name='PlexMono' size='8'>agentless-mcpgw2.privilege-gw2.svc.cluster.local</font>. "
    "Do not accept a pre-filled public hostname: a node enrolled with the wrong Host IP never "
    "appears in the console and cannot be edited later — it must be re-created.",
    "Generate the Docker command and copy the enrollment token as in section 5.1.",
])
H3("8.2  Install the second release")
P("Install the chart a second time, in a second namespace, with a distinct release name and "
  "<font name='PlexMono' size='8'>nameOverride</font> so resource names do not collide. "
  "Set <font name='PlexMono' size='8'>ingress.enabled: false</font> — the load balancer, not "
  "the ingress, routes to additional nodes. Include the same sidecar values file so both "
  "pods run the same sidecar set.")
code("""# Move any prior enrollment files aside before re-enrolling:
kubectl -n privilege-gw2 scale deploy/agentless-mcpgw2 --replicas=0
kubectl -n privilege-gw2 delete pvc agentless-mcpgw-ssl     # old enrollment only

helm upgrade --install agentless-mcpgw2 <chart>.tgz \\
  --namespace privilege-gw2 \\
  --set nameOverride=agentless-mcpgw2 \\
  --set ingress.enabled=false \\
  --set hostname=mcpgw.example.com \\
  --set oidc.serverUrl=https://mcpgw.example.com \\
  --set-file proxyToken=<token-file> \\
  -f sidecars.values.yaml""")
H3("8.3  Synchronize secrets and state")
bullets([
    "Copy the sidecar secrets into the second namespace (each sidecar's credentials, plus the image pull secret and the Redis URL secret).",
    "Enable the shared Redis URL secret on the second release (section 6).",
    "Confirm <font name='PlexMono' size='8'>Redis token store connected</font> and "
    "<font name='PlexMono' size='8'>LinkStatus:Active</font> in the new node's log before admitting traffic.",
])
H3("8.4  Admit the node to rotation")
P("Add the node to the load balancer's peer list in the primary release's values file and "
  "upgrade. Remove it with <font name='PlexMono' size='8'>parked: true</font>. Define peer "
  "entries in the values file — do not modify list values with "
  "<font name='PlexMono' size='8'>--set</font> indexes on an existing release.")

# =====================================================================
# 9 REGISTER APPS
# =====================================================================
H1("9", "Registering MCP servers as applications")
P("An MCP server is exposed to clients as an <b>application</b> in the Privilege console. "
  "Register each server once, against your mesh cluster; every gateway node serves it.")
H3("9.1  Register the application")
numbered([
    "In the Privilege console, go to <b>Agentic Apps</b> and click <b>Add Application → MCP Server</b>.",
    "Enter an <b>Application Name</b>. It becomes the client-facing path: "
    "<font name='PlexMono' size='8'>https://mcpgw.example.com/&lt;AppName&gt;/mcp</font>.",
    "Enter the <b>MCP Server URL</b> — the backend endpoint, for example "
    "<font name='PlexMono' size='8'>http://my-mcp-server.privilege-gw.svc.cluster.local/mcp</font> "
    "for a cluster service, or <font name='PlexMono' size='8'>http://localhost:&lt;port&gt;/mcp</font> "
    "for a sidecar.",
    "Select the <b>Mesh Cluster</b> (the cluster ID from section 5.1).",
    "Set <b>Auth Mode</b> as appropriate (typically <i>None</i> for internal backends).",
    "Save. The gateway discovers the server by sending an MCP <i>initialize</i> request to the registered URL.",
])
callout("warn",
    "Register backends with the <b>/mcp</b> path, not /sse. Current gateway builds discover "
    "servers by POSTing an initialize request; an SSE endpoint rejects that with HTTP 405 and "
    "discovery fails. Also note that the entry path is stored at registration time: correcting "
    "a wrong path requires deleting and re-registering the application — a restart does not "
    "recompute it.")
H3("9.2  Sidecar backends")
P("Applications created from the MCP catalog are pinned to "
  "<font name='PlexMono' size='8'>http://localhost:8080/mcp</font> and can only be served by "
  "a sidecar container inside the gateway pod. Add sidecars through the chart's "
  "<font name='PlexMono' size='8'>extraContainers</font> value: give each server a distinct "
  "local port (8080–8082 are used by the standard sidecars), a readiness probe on "
  "<font name='PlexMono' size='8'>/health</font>, and register it in the console as its own "
  "application. Every gateway node must run the same sidecar set, with the sidecars' secrets "
  "present in every node's namespace.")
H3("9.3  Authorization policies")
P("Policies are defined per application and reference synced users and groups. A newly "
  "registered application denies all access until a policy covering the intended users is "
  "created. When a call is denied, the reason is written to the gateway log — the client sees "
  "only a generic 403.")

# =====================================================================
# 10 VERIFICATION
# =====================================================================
H1("10", "Verification")
H3("10.1  Node routing and pinning")
code("""for i in 1 2 3 4; do
  curl -sk -o /dev/null -D - https://mcpgw.example.com/<AppName>/mcp | grep -i x-served-by
done""")
P("Every request from one client address and application path should return the same node "
  "name. Requests from different networks may map to different nodes.")
H3("10.2  Load balancer logs")
code("""kubectl logs -l app=mcpgw-lb --prefix --max-log-requests=4 \\
  | grep -E 'node=|register|authorize|token'""")
P("Each client request is logged with the serving node. The line from the ingress address "
  "carries the authoritative <font name='PlexMono' size='8'>node=</font> value.")
H3("10.3  End-to-end client test")
numbered([
    "In an MCP client (for example an IDE extension, Postman or LM Studio), add a server with only the URL "
    "<font name='PlexMono' size='8'>https://mcpgw.example.com/&lt;AppName&gt;/mcp</font> and no static credentials.",
    "The client performs dynamic client registration and opens a browser for the PingOne sign-in.",
    "Complete the sign-in and run a tool call.",
    "In the load balancer log, confirm the sequence register (201) → authorize (302) → callback (302) → token (200) → mcp (200).",
])
H3("10.4  Failover test")
numbered([
    "Sign in a client and confirm which node serves it (X-Served-By header).",
    "Remove that node from rotation (parked: true) or scale its deployment to zero.",
    "The client's traffic moves to a surviving node within one health-check interval; the client re-authenticates automatically (registrations are preserved by Redis; tokens are not).",
    "Restore the node and confirm it re-enters rotation after the health-check rise window.",
])

# =====================================================================
# 11 OPERATIONS
# =====================================================================
H1("11", "Operational considerations")
H3("Chart hygiene")
bullets([
    "If you customize chart templates, repackage the chart "
    "(<font name='PlexMono' size='8'>helm package</font>) in the same change. Deploying from a "
    "stale package silently drops template-level additions such as sidecar containers and image pull secrets.",
    "Before any upgrade that touches sidecars, render a dry run and verify the sidecar "
    "containers appear in the output.",
    "Upgrades of a running release should use <font name='PlexMono' size='8'>--reuse-values</font> "
    "and the same overlay files; a bare upgrade resets sidecars, Redis settings and routing.",
    "Avoid modifying nested list values with <font name='PlexMono' size='8'>--set</font> indexes; "
    "use a values file that restates the full list.",
])
H3("Restart discipline")
bullets([
    "Never restart a gateway while Redis is unavailable — the gateway exits after six failed connection attempts and crash-loops until Redis returns.",
    "A gateway restart costs clients its sessions and takes the node out of LB rotation for roughly 10 minutes (health-check rise window). Schedule restarts.",
    "OIDC configuration changes take effect only after a pod restart.",
])
H3("Capacity")
bullets([
    "The main gateway container idles at very low CPU; the chart default request of 1 CPU may be reduced (for example to 250m) on constrained clusters while keeping the limits unchanged.",
    "Each sidecar adds to the pod footprint; a pod with eight sidecars is a nine-container pod. Plan node resources accordingly.",
    "Redis with a 1Gi volume and 64 MB maxmemory is sufficient for client registrations.",
])
H3("Security")
bullets([
    "Enrollment tokens, OIDC client secrets and generated values files are sensitive: store them outside source control, delete token files after use, and rotate any credential that has been exposed in screenshots or chat history.",
    "Restrict the load balancer statistics page with authentication, or disable it.",
    "The Redis connection is password-authenticated in-cluster; if your security model requires TLS for data stores, front Redis accordingly.",
])

# =====================================================================
# 12 TROUBLESHOOTING
# =====================================================================
H1("12", "Troubleshooting")
table(["Symptom", "Likely cause", "Resolution"], [
    ["Console shows \u201CGateway Unreachable — Error discovering MCP server … Unauthorized\u201D",
     "Backend registered on /sse, wrong hostname, or expired policy — read the gateway log line \u201CError discovering MCP server\u201D for the actual method and path",
     "Re-register the backend with /mcp; verify the URL resolves from the gateway pod"],
    ["Client receives \u201CUnknown client\u201D at /authorize",
     "The gateway forgot the DCR registration (Redis unavailable or not configured)",
     "Restore Redis, then have the client register again; verify MCPGW_REDIS_URL"],
    ["401 on /<AppName>/mcp immediately after a successful sign-in",
     "The token came from one node but the call reached another (pinning bypassed)",
     "Ensure clients enter through the load balancer, not a node Service directly"],
    ["500 on /<AppName>/mcp while sign-in works",
     "The node serving the call lacks the sidecar the backend runs on",
     "Apply the same sidecar values file and secrets to every node"],
    ["503 node=&lt;NOSRV&gt; from the public URL",
     "All backends are in the health-check rise window after a restart or rollout",
     "Wait for the rise window (up to ~10 minutes); do not restart gateways"],
    ["Crash loop with \u201Ccrypto/ecdsa: verification error\u201D at enrollment",
     "The enrollment token contained leading/trailing whitespace",
     "Re-create the token, strip whitespace, delete the old SSL PVC, re-enroll"],
    ["Authorize redirects with an empty client_id",
     "The pod is still running pre-upgrade OIDC configuration",
     "Restart the gateway pod after OIDC secret changes"],
    ["An application stops working after a console edit",
     "Its Mesh Cluster was changed, which moves the application off the original cluster",
     "Set the Mesh Cluster back to the production cluster"],
    ["Gateway pod exits repeatedly, log shows fatal \u201Cunreachable after 6 attempts\u201D",
     "Redis was down when the gateway restarted",
     "Restore Redis first; the gateway reconnects automatically once Redis is reachable"],
])
H3("Reading the gateway log")
code("""kubectl exec deploy/agentless-mcpgw -c log-tailer -- \\
  tail -200 /var/log/procyon/cyonproxy.log""")
P("Policy denials are logged with the resolved user and the reason "
  "(for example, the user is not synced into Privilege, or no policy on the application "
  "covers them). The client sees only a generic 403, so always confirm in the log.")

# =====================================================================
# APPENDIX
# =====================================================================
H1("Appendix A", "Resource summary")
table(["Resource", "Namespace", "Name", "Purpose"], [
    ["Gateway deployment", "privilege-gw", "agentless-mcpgw", "Primary gateway node"],
    ["Gateway deployment", "privilege-gw2", "agentless-mcpgw2", "Second node (nameOverride, no ingress)"],
    ["SSL PVC", "each node", "agentless-mcpgw-ssl", "Enrollment state; delete only to re-enroll"],
    ["Load balancer", "privilege-gw", "mcpgw-lb (Deployment + Service)", "Client entry point, 2 replicas"],
    ["Ingress", "privilege-gw", "gateway ingress", "TLS termination for the public hostname"],
    ["Redis", "privilege-gw", "privilege-redis (Deployment, Service, 1Gi PVC)", "Shared registration store"],
    ["Secrets", "every namespace", "privilege-redis, privilege-redis-url, sidecar secrets, pull secret", "Credentials for Redis and sidecars"],
    ["OIDC secret", "privilege-gw", "gw-oidc", "Enrollment token and OIDC configuration"],
])
story.append(Spacer(1, 18))
story.append(HRFlowable(width="100%", thickness=1, color=GRAY400))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "Ping Identity Proprietary and Confidential. This document describes a reference "
    "deployment and is provided as-is. Values shown are examples; substitute your own "
    "hostnames, namespaces and identifiers.", S["footer-l"]))

doc.build(story)
print("Wrote", OUT)
