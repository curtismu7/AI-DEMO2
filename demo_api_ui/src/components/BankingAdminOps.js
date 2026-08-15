import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function BankingAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="banking" user={user} onLogout={onLogout} />;
}
