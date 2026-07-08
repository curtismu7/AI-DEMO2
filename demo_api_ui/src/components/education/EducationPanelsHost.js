// banking_api_ui/src/components/education/EducationPanelsHost.js
import React from "react";
import { useEducationUI } from "../../context/EducationUIContext";
import { EDU } from "./educationIds";
import A2ADelegationPanel from "./A2ADelegationPanel";
import AgenticMaturityPanel from "./AgenticMaturityPanel";
import AgentBuilderLandscapePanel from "./AgentBuilderLandscapePanel";
import AgentFrameworksPanel from "./AgentFrameworksPanel";
import AgentGatewayPanel from "./AgentGatewayPanel";
import AgentRestrictionsPanel from "./AgentRestrictionsPanel";
import AgentTechComparisonPanel from "./AgentTechComparisonPanel";
import AiAttacksPanel from "./AiAttacksPanel";
import AiPlatformLandscapePanel from "./AiPlatformLandscapePanel";
import AiPrimerPanel from "./AiPrimerPanel";
import ArchitectureDiagramPanel from "./ArchitectureDiagramPanel";
import AuthZenPanel from "./AuthZenPanel";
import BestPracticesPanel from "./BestPracticesPanel";
import MachineIamSurveyPanel from "./MachineIamSurveyPanel";
import CimdPanel from "./CimdPanel";
import ComputerUseAgentPanel from "./ComputerUseAgentPanel";
import ElicitationPanel from "./ElicitationPanel";
import EnterpriseManagedAuthPanel from "./EnterpriseManagedAuthPanel";
import FlowDiagramsPanel from "./FlowDiagramsPanel";
import GleanPanel from "./GleanPanel";
import HumanInLoopPanel from "./HumanInLoopPanel";
import IdJagPanel from "./IdJagPanel";
import IETFStandardsPanel from "./IETFStandardsPanel";
import IntentAuthStandardsPanel from "./IntentAuthStandardsPanel";
import IntentDelegationPanel from "./IntentDelegationPanel";
import IntrospectionPanel from "./IntrospectionPanel";
import JwtClientAuthPanel from "./JwtClientAuthPanel";
import LangChainPanel from "./LangChainPanel";
import LlmLandscapePanel from "./LlmLandscapePanel";
import LoginFlowPanel from "./LoginFlowPanel";
import MayActPanel from "./MayActPanel";
import McpProtocolPanel from "./McpProtocolPanel";
import OboPanel from "./OboPanel";
import Oidc21Panel from "./Oidc21Panel";
import PARPanel from "./PARPanel";
import PingGatewayMcpPanel from "./PingGatewayMcpPanel";
import PingOneAuthorizePanel from "./PingOneAuthorizePanel";
import RARPanel from "./RARPanel";
import RFC8693Panel from "./RFC8693Panel";
import RFCIndexPanel from "./RFCIndexPanel";
import SensitiveDataPanel from "./SensitiveDataPanel";
import ServerCapabilitiesPanel from "./ServerCapabilitiesPanel";
import StepUpPanel from "./StepUpPanel";
import TokenChainEducationPanel from "./TokenChainEducationPanel";
import TokenExchangePanel from "./TokenExchangePanel";
import TokenFlowPanel from "./TokenFlowPanel";
import TransactionTokensPanel from "./TransactionTokensPanel";
import DPoPPanel from "./DPoPPanel";
import VerticalSetupPanel from "./VerticalSetupPanel";
import WeaviateRagPanel from "./WeaviateRagPanel";
import WebMcpEduPanel from "./WebMcpEduPanel";

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
  [EDU.GLEAN]: GleanPanel,
  [EDU.HUMAN_IN_LOOP]: HumanInLoopPanel,
  [EDU.ID_JAG]: IdJagPanel,
  [EDU.IETF_STANDARDS]: IETFStandardsPanel,
  [EDU.INTENT_DELEGATION]: IntentDelegationPanel,
  [EDU.INTENT_AUTH_STANDARDS]: IntentAuthStandardsPanel,
  [EDU.INTROSPECTION]: IntrospectionPanel,
  [EDU.JWT_CLIENT_AUTH]: JwtClientAuthPanel,
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
  return <ActivePanel isOpen onClose={close} initialTabId={tab} />;
}
