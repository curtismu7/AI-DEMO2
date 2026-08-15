import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function ManufacturingAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="manufacturing" user={user} onLogout={onLogout} />;
}
