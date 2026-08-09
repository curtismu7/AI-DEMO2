import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function GovernmentAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="government" user={user} onLogout={onLogout} />;
}
