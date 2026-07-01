import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function WorkforceAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="workforce" user={user} onLogout={onLogout} />;
}
