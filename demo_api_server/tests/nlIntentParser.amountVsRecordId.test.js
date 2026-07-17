/**
 * A single number in a phrase is EITHER an amount OR a record id — never both.
 *
 * norm() strips "$" before any extractor runs ("pay my $300 bill" arrives as
 * "pay my 300 bill"), so a heuristic that sets BOTH extractsAmount and
 * extractsRecordId had both regexes match the SAME token and emitted
 * { amount: 300, recordId: "300" }.
 *
 * That broke the chip end-to-end: healthcare's pay_bill handler does
 *   let _billId = params.billId || params.recordId;
 *   if (!_billId) { _billId = firstOutstandingBill }   // <- intended fallback
 * and its comment says amount-driven chips "don't carry a bill id". They did,
 * so the fallback was dead code and the chip paid bill "300" — real bill ids are
 * 401+ — giving "bill not found".
 *
 * Only two heuristics set both flags: healthcare pay_bill and manufacturing
 * approve_purchase_order.
 */
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
const healthcareSeed = require('../config/verticals/healthcare/seed.json');

describe('heuristic params: amount vs recordId', () => {
  const hcCtx = resolveVerticalCtx('healthcare');

  describe('healthcare pay_bill', () => {
    test.each([
      ['pay my $300 bill', 300],
      ['pay the $150 bill', 150],
      ['pay my $2500 bill', 2500],
    ])('%s -> amount only, NO invented recordId', (message, amount) => {
      const r = parseHeuristic(message, 'healthcare', hcCtx, {});
      expect(r.action).toBe('pay_bill');
      expect(r.params.amount).toBe(amount);
      // The dollar figure must NOT leak into recordId: the handler would use it
      // as a bill id and find nothing.
      expect(r.params.recordId).toBeUndefined();
    });

    test('an amount-driven chip never names a bill that does not exist', () => {
      const r = parseHeuristic('pay my $300 bill', 'healthcare', hcCtx, {});
      const billIds = (healthcareSeed.billingHistory || []).map((b) => String(b.id));
      expect(billIds.length).toBeGreaterThan(0);
      const billId = r.params.billId || r.params.recordId;
      if (billId) {
        expect(billIds).toContain(String(billId));
      }
      // With no id, the handler falls back to the first outstanding bill — the
      // behaviour its comment describes.
      expect(billId).toBeFalsy();
    });

    test('an explicit id IS still extracted ("pay bill 402")', () => {
      const r = parseHeuristic('pay bill 402', 'healthcare', hcCtx, {});
      expect(r.action).toBe('pay_bill');
      expect(r.params.recordId).toBe('402');
    });
  });

  describe('single-flag heuristics keep working (no regression)', () => {
    test.each([
      ['release record 102', 'release_records', '102'],
      ['cancel appointment 202', 'cancel_appointment', '202'],
    ])('%s -> %s recordId %s', (message, action, recordId) => {
      const r = parseHeuristic(message, 'healthcare', hcCtx, {});
      expect(r.action).toBe(action);
      expect(r.params.recordId).toBe(recordId);
    });
  });

  describe('manufacturing approve_purchase_order (the other both-flag heuristic)', () => {
    const mfgCtx = resolveVerticalCtx('manufacturing');

    test('"approve the $5000 purchase order" -> amount only', () => {
      const r = parseHeuristic('approve the $5000 purchase order', 'manufacturing', mfgCtx, {});
      expect(r.action).toBe('approve_purchase_order');
      expect(r.params.amount).toBe(5000);
      expect(r.params.recordId).toBeUndefined();
    });

    test('"approve purchase order 5001" -> id is still extracted', () => {
      const r = parseHeuristic('approve purchase order 5001', 'manufacturing', mfgCtx, {});
      expect(r.action).toBe('approve_purchase_order');
      expect(r.params.recordId).toBe('5001');
    });
  });
});
