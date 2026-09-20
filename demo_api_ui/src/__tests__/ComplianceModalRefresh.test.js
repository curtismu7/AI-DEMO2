import fs from "node:fs";
import path from "node:path";

const agentSource = fs.readFileSync(
  path.resolve(__dirname, "../components/AIAgent.js"),
  "utf8",
);

describe("MCP compliance checklist refresh behavior", () => {
  it("does not persist the checklist open state across browser refreshes", () => {
    expect(agentSource).toContain(
      "const [showCompliancePanel, setShowCompliancePanel] = useState(false);",
    );
    expect(agentSource).toContain(
      "const [complianceSlideout, setComplianceSlideout] = useState(false);",
    );
    expect(agentSource).not.toContain('localStorage.getItem("ba_show_compliance_panel")');
    expect(agentSource).not.toContain('localStorage.setItem(\n                              "ba_show_compliance_panel"');
    expect(agentSource).not.toContain('localStorage.getItem("ba_compliance_slideout")');
    expect(agentSource).not.toContain('localStorage.setItem(\n                                "ba_compliance_slideout"');
  });
});
