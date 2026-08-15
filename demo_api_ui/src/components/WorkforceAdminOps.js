import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function WorkforceAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="workforce" user={user} onLogout={onLogout} />;
}
