import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import ProtocolPlayground from "../components/ProtocolPlayground/ProtocolPlayground";

/**
 * ProtocolPlayground route wrapper with AppShell chrome
 */
export function ProtocolPlaygroundPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <ProtocolPlayground />
    </AppShell>
  );
}

export default ProtocolPlaygroundPageRoute;
