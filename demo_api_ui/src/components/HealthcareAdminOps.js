import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function HealthcareAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="healthcare" user={user} onLogout={onLogout} />;
}
