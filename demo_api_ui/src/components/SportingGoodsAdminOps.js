import React from 'react';
import VerticalOpsConsole from './verticalOps/VerticalOpsConsole';

export default function SportingGoodsAdminOps({ user, onLogout }) {
  return <VerticalOpsConsole vertical="sporting-goods" user={user} onLogout={onLogout} />;
}
