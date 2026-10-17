// 2-char vertical code prefixed to the CIBA binding_message (PingOne max 8 chars =
// 2 code + 6 match code). The DaVinci CIBA flows read it to brand their screens.
// Each code has a non-hex letter so it can never be mistaken for a bare 6-char hex match code.
module.exports = {
  airlines: 'AL',
  banking: 'BK',
  government: 'GV',
  healthcare: 'HC',
  investment: 'IN',
  manufacturing: 'MF',
  retail: 'RT',
  'sporting-goods': 'SG',
  university: 'UN',
  walbuy: 'WB',
  workforce: 'WF',
};
