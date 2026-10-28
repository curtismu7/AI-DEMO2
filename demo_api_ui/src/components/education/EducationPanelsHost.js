// banking_api_ui/src/components/education/EducationPanelsHost.js
import React, { Suspense } from "react";
import lazyWithRetry from "../../utils/lazyWithRetry";
import { useEducationUI } from "../../context/EducationUIContext";
import { EDU } from "./educationIds";
const A2ADelegationPanel = lazyWithRetry(() => import("./A2ADelegationPanel"));
const AgenticMaturityPanel = lazyWithRetry(() => import("./AgenticMaturityPanel"));
const AgentBuilderLandscapePanel = lazyWithRetry(() => import("./AgentBuilderLandscapePanel"));
const AgentFrameworksPanel = lazyWithRetry(() => import("./AgentFrameworksPanel"));
const AgentGatewayPanel = lazyWithRetry(() => import("./AgentGatewayPanel"));
const AgentRestrictionsPanel = lazyWithRetry(() => import("./AgentRestrictionsPanel"));
const AgentTechComparisonPanel = lazyWithRetry(() => import("./AgentTechComparisonPanel"));
const AiAttacksPanel = lazyWithRetry(() => import("./AiAttacksPanel"));
const AiPlatformLandscapePanel = lazyWithRetry(() => import("./AiPlatformLandscapePanel"));
const AiPrimerPanel = lazyWithRetry(() => import("./AiPrimerPanel"));
const ArchitectureDiagramPanel = lazyWithRetry(() => import("./ArchitectureDiagramPanel"));
const AuthZenPanel = lazyWithRetry(() => import("./AuthZenPanel"));
const BestPracticesPanel = lazyWithRetry(() => import("./BestPracticesPanel"));
const MachineIamSurveyPanel = lazyWithRetry(() => import("./MachineIamSurveyPanel"));
const CimdPanel = lazyWithRetry(() => import("./CimdPanel"));
const ComputerUseAgentPanel = lazyWithRetry(() => import("./ComputerUseAgentPanel"));
const ElicitationPanel = lazyWithRetry(() => import("./ElicitationPanel"));
const EnterpriseManagedAuthPanel = lazyWithRetry(() => import("./EnterpriseManagedAuthPanel"));
const FlowDiagramsPanel = lazyWithRetry(() => import("./FlowDiagramsPanel"));
const GatewayPolicySplitPanel = lazyWithRetry(() => import("./GatewayPolicySplitPanel"));
const GleanPanel = lazyWithRetry(() => import("./GleanPanel"));
const HumanInLoopPanel = lazyWithRetry(() => import("./HumanInLoopPanel"));
const IdJagPanel = lazyWithRetry(() => import("./IdJagPanel"));
const IETFStandardsPanel = lazyWithRetry(() => import("./IETFStandardsPanel"));
const IntentAuthStandardsPanel = lazyWithRetry(() => import("./IntentAuthStandardsPanel"));
const IntentDelegationPanel = lazyWithRetry(() => import("./IntentDelegationPanel"));
const IntrospectionPanel = lazyWithRetry(() => import("./IntrospectionPanel"));
const JwtClientAuthPanel = lazyWithRetry(() => import("./JwtClientAuthPanel"));
const KillSwitchMechanismsPanel = lazyWithRetry(() => import("./KillSwitchMechanismsPanel"));
const LangChainPanel = lazyWithRetry(() => import("./LangChainPanel"));
const LlmLandscapePanel = lazyWithRetry(() => import("./LlmLandscapePanel"));
const LoginFlowPanel = lazyWithRetry(() => import("./LoginFlowPanel"));
const MayActPanel = lazyWithRetry(() => import("./MayActPanel"));
const McpProtocolPanel = lazyWithRetry(() => import("./McpProtocolPanel"));
const OboPanel = lazyWithRetry(() => import("./OboPanel"));
const Oidc21Panel = lazyWithRetry(() => import("./Oidc21Panel"));
const PARPanel = lazyWithRetry(() => import("./PARPanel"));
const PingGatewayMcpPanel = lazyWithRetry(() => import("./PingGatewayMcpPanel"));
const PingOneAuthorizePanel = lazyWithRetry(() => import("./PingOneAuthorizePanel"));
const RARPanel = lazyWithRetry(() => import("./RARPanel"));
const RFC8693Panel = lazyWithRetry(() => import("./RFC8693Panel"));
const RFCIndexPanel = lazyWithRetry(() => import("./RFCIndexPanel"));
const SensitiveDataPanel = lazyWithRetry(() => import("./SensitiveDataPanel"));
const ServerCapabilitiesPanel = lazyWithRetry(() => import("./ServerCapabilitiesPanel"));
const SpiffePanel = lazyWithRetry(() => import("./SpiffePanel"));
const StepUpPanel = lazyWithRetry(() => import("./StepUpPanel"));
const TokenChainEducationPanel = lazyWithRetry(() => import("./TokenChainEducationPanel"));
const TokenExchangePanel = lazyWithRetry(() => import("./TokenExchangePanel"));
const TokenFlowPanel = lazyWithRetry(() => import("./TokenFlowPanel"));
const TransactionTokensPanel = lazyWithRetry(() => import("./TransactionTokensPanel"));
const DPoPPanel = lazyWithRetry(() => import("./DPoPPanel"));
const VerticalSetupPanel = lazyWithRetry(() => import("./VerticalSetupPanel"));
const WeaviateRagPanel = lazyWithRetry(() => import("./WeaviateRagPanel"));
const WebMcpEduPanel = lazyWithRetry(() => import("./WebMcpEduPanel"));

const PANEL_MAP = {
  [EDU.A2A_DELEGATION]: A2ADelegationPanel,
  [EDU.AGENT_BUILDER_LANDSCAPE]: AgentBuilderLandscapePanel,
  [EDU.AGENT_FRAMEWORKS]: AgentFrameworksPanel,
  [EDU.AGENT_GATEWAY]: AgentGatewayPanel,
  [EDU.AGENT_RESTRICTIONS]: AgentRestrictionsPanel,
  [EDU.AGENTIC_MATURITY]: AgenticMaturityPanel,
  [EDU.AI_ATTACKS]: AiAttacksPanel,
  [EDU.AI_PLATFORM_LANDSCAPE]: AiPlatformLandscapePanel,
  [EDU.AI_PRIMER]: AiPrimerPanel,
  [EDU.ARCHITECTURE_DIAGRAM]: ArchitectureDiagramPanel,
  [EDU.AUTHZEN]: AuthZenPanel,
  [EDU.BEST_PRACTICES]: BestPracticesPanel,
  [EDU.MACHINE_IAM_SURVEY]: MachineIamSurveyPanel,
  [EDU.CIMD]: CimdPanel,
  [EDU.CUA]: ComputerUseAgentPanel,
  [EDU.FLOW_DIAGRAMS]: FlowDiagramsPanel,
  [EDU.GATEWAY_POLICY_SPLIT]: GatewayPolicySplitPanel,
  [EDU.GLEAN]: GleanPanel,
  [EDU.HUMAN_IN_LOOP]: HumanInLoopPanel,
  [EDU.ID_JAG]: IdJagPanel,
  [EDU.IETF_STANDARDS]: IETFStandardsPanel,
  [EDU.INTENT_DELEGATION]: IntentDelegationPanel,
  [EDU.INTENT_AUTH_STANDARDS]: IntentAuthStandardsPanel,
  [EDU.INTROSPECTION]: IntrospectionPanel,
  [EDU.JWT_CLIENT_AUTH]: JwtClientAuthPanel,
  [EDU.KILL_SWITCH]: KillSwitchMechanismsPanel,
  [EDU.LANGCHAIN]: LangChainPanel,
  [EDU.LLM_LANDSCAPE]: LlmLandscapePanel,
  [EDU.LOGIN_FLOW]: LoginFlowPanel,
  [EDU.MAY_ACT]: MayActPanel,
  [EDU.MCP_ELICITATION]: ElicitationPanel,
  [EDU.ENTERPRISE_MANAGED_AUTH]: EnterpriseManagedAuthPanel,
  [EDU.MCP_PROTOCOL]: McpProtocolPanel,
  [EDU.OBO]: OboPanel,
  [EDU.OIDC_21]: Oidc21Panel,
  [EDU.PAR]: PARPanel,
  [EDU.PINGGATEWAY_MCP]: PingGatewayMcpPanel,
  [EDU.PINGONE_AUTHORIZE]: PingOneAuthorizePanel,
  [EDU.RAR]: RARPanel,
  [EDU.RFC_8693]: RFC8693Panel,
  [EDU.RFC_INDEX]: RFCIndexPanel,
  [EDU.SENSITIVE_DATA]: SensitiveDataPanel,
  [EDU.SPIFFE]: SpiffePanel,
  [EDU.STEP_UP]: StepUpPanel,
  [EDU.TOKEN_CHAIN]: TokenChainEducationPanel,
  [EDU.TOKEN_EXCHANGE]: TokenExchangePanel,
  [EDU.TOKEN_FLOW]: TokenFlowPanel,
  [EDU.TRANSACTION_TOKENS]: TransactionTokensPanel,
  [EDU.DPOP]: DPoPPanel,
  [EDU.VERTICAL_SETUP]: VerticalSetupPanel,
  [EDU.WEB_MCP]: WebMcpEduPanel,
  [EDU.AGENT_TECH_COMPARISON]: AgentTechComparisonPanel,
  [EDU.SERVER_CAPABILITIES]: ServerCapabilitiesPanel,
  [EDU.VECTOR_RAG]: WeaviateRagPanel,
};

export default function EducationPanelsHost() {
  const { panel, tab, close } = useEducationUI();
  const ActivePanel = panel ? PANEL_MAP[panel] : null;
  if (!ActivePanel) return null;
  return (
    <Suspense fallback={null}>
      <ActivePanel isOpen onClose={close} initialTabId={tab} />
    </Suspense>
  );
}
