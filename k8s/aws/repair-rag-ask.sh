#!/usr/bin/env bash
# k8s/aws/repair-rag-ask.sh — Repair Code Search Ask after a fresh RAG bring-up.
#
# Fixes the common SE-cluster failure mode:
#   1) LlamaIndex raced ahead and created CodeChunk without codebase_id
#   2) No indexed codebase (empty list → Ask has nothing to ground on)
#   3) Rebuild/redeploy llamaindex-agent with single-shot + long LLM timeout
#
# Example:
#   GITHUB_OWNER=curtismu7 K8S_NAMESPACE=ping-devops-cmuir ./k8s/aws/repair-rag-ask.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

GITHUB_OWNER="${GITHUB_OWNER:?Set GITHUB_OWNER (e.g. curtismu7)}"
NS="${K8S_NAMESPACE:?Set K8S_NAMESPACE (e.g. ping-devops-cmuir)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
OWNER_LC="$(echo "$GITHUB_OWNER" | tr '[:upper:]' '[:lower:]')"
LLAMA_GHCR="ghcr.io/${OWNER_LC}/ai-demo-llamaindex-agent:${IMAGE_TAG}"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
die()     { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo "============================================"
echo " Repair Code Search Ask"
echo "============================================"
info "Namespace: $NS"
info "Image:     $LLAMA_GHCR"
echo

kubectl get namespace "$NS" &>/dev/null || die "Namespace '$NS' not found"
API_POD="$(kubectl get pod -n "$NS" -l component=api-server -o jsonpath='{.items[0].metadata.name}')"
[[ -n "$API_POD" ]] || die "demo-api-server pod not found"

info "1/6 Schema check"
PROPS="$(kubectl exec -n "$NS" "$API_POD" -- node -e '
fetch("http://weaviate:8080/v1/schema").then(r=>r.json()).then(d=>{
  const c=(d.classes||[]).find(x=>x.class==="CodeChunk");
  console.log(c?c.properties.map(p=>p.name).join(","):"MISSING");
}).catch(e=>console.log("ERR:"+e.message));
' 2>/dev/null | tail -1)"
echo "  CodeChunk props: $PROPS"
if [[ "$PROPS" != *"codebase_id"* ]]; then
  warn "Deleting broken/missing CodeChunk class"
  kubectl exec -n "$NS" "$API_POD" -- node -e '
fetch("http://weaviate:8080/v1/schema/CodeChunk",{method:"DELETE"})
  .then(async r=>console.log("delete",r.status)).catch(e=>console.log(e.message));
' 2>/dev/null | tail -1
  kubectl rollout restart deployment/mcp-code-search -n "$NS"
  kubectl rollout status deployment/mcp-code-search -n "$NS" --timeout=180s
  success "Schema recreated by mcp-code-search"
else
  success "Schema already has codebase_id"
fi

info "2/6 Rebuild + push llamaindex-agent (single-shot mode + longer timeout)"
command -v docker >/dev/null || die "docker required"
command -v gh >/dev/null || die "gh required"
echo "$(gh auth token)" | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin >/dev/null
docker build -t "$LLAMA_GHCR" "$ROOT_DIR/llamaindex_agent"
docker push "$LLAMA_GHCR"
success "Pushed $LLAMA_GHCR"

info "3/6 Patch llamaindex-agent env + restart"
kubectl set image "deployment/llamaindex-agent" "llamaindex-agent=${LLAMA_GHCR}" -n "$NS"
kubectl set env "deployment/llamaindex-agent" -n "$NS" \
  AGENT_MODE=single-shot \
  AGENT_LLM_TIMEOUT=240 \
  AGENT_MAX_TOKENS=1200
kubectl rollout status deployment/llamaindex-agent -n "$NS" --timeout=180s
success "llamaindex-agent restarted"

info "4/6 Ensure sample codebase is indexed (if empty)"
CB="$(kubectl exec -n "$NS" deploy/mcp-code-search -- wget -qO- http://localhost:8095/codebases 2>/dev/null || echo '{}')"
echo "  codebases: $CB"
if echo "$CB" | grep -q '"codebases":\[\]'; then
  warn "No codebases — indexing a tiny auth sample as ai-demo2-default"
  kubectl exec -n "$NS" deploy/mcp-code-search -- node -e '
const files=[{path:"demo_api_server/middleware/auth.js",content:Buffer.from(`
async function requireAuth(req,res,next){
  const token=req.headers.authorization?.replace(/^Bearer\\s+/i,"");
  if(!token)return res.status(401).json({error:"authentication_required"});
  const claims=await validateJwt(token);
  req.user={sub:claims.sub,scopes:claims.scope}; next();
}
module.exports={requireAuth};
`).toString("base64")}];
fetch("http://127.0.0.1:8095/index",{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({codebase_id:"ai-demo2-default",codebase_name:"This demo (AI-DEMO2)",files})})
  .then(async r=>console.log(r.status, await r.text()));
' 2>/dev/null | tail -1
  success "Sample indexed"
else
  success "At least one codebase already present"
fi

info "5/6 Smoke-test /ask (may take up to ~4 minutes on gpt-oss)"
ASK_OUT="$(kubectl exec -n "$NS" "$API_POD" -- node -e '
const ctrl=new AbortController();
const t=setTimeout(()=>ctrl.abort(),240000);
fetch("http://llamaindex-agent:8894/ask",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({question:"How does authentication work in this code?",codebase_id:"ai-demo2-default",limit:4}),
  signal:ctrl.signal,
}).then(async r=>{console.log("STATUS",r.status); console.log(await r.text()); clearTimeout(t);})
  .catch(e=>{console.log("STATUS ERR"); console.log(e.message); clearTimeout(t);});
' 2>/dev/null | grep -v '^\[' || true)"
echo "$ASK_OUT"
if echo "$ASK_OUT" | grep -q '^STATUS 200'; then
  success "Ask returned 200"
else
  warn "Ask did not return 200 — see output above / llamaindex logs"
  kubectl logs -n "$NS" deploy/llamaindex-agent --tail=40 || true
fi

info "6/6 Final status"
kubectl get pods -n "$NS" -l 'component in (weaviate,embeddings,mcp-code-search,llamaindex-agent)'
kubectl exec -n "$NS" deploy/mcp-code-search -- wget -qO- http://localhost:8095/codebases; echo
echo
success "Repair finished"
echo "Refresh https://ai-demo.ping-devops.com/code-search"
echo "Select codebase 'This demo (AI-DEMO2)' (or upload your own), then Ask again."
echo "Expect ~1–3 minutes per answer while only llama-tier5 (gpt-oss) is running."
