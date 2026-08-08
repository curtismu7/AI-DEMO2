import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function InvestmentAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="investment" user={user} onLogout={onLogout} />;
}
