import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function BankingAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="banking" user={user} onLogout={onLogout} />;
}
