import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function RetailAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="retail" user={user} onLogout={onLogout} />;
}
