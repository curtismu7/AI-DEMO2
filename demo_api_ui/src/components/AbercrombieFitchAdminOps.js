import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function AbercrombieFitchAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="walbuy" user={user} onLogout={onLogout} />;
}
