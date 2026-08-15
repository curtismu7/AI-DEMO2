import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function SportingGoodsAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="sporting-goods" user={user} onLogout={onLogout} />;
}
