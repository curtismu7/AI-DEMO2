import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function RetailAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="retail" user={user} onLogout={onLogout} />;
}
