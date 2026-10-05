package com.pingidentity.demo.ciba;

import com.pingidentity.demo.ciba.ApprovalStatus.Outcome;

public final class ApprovalStatusTest {
    private static void expect(String status, Outcome outcome) {
        Outcome actual = ApprovalStatus.of(status);
        if (actual != outcome) throw new AssertionError(status + " -> " + actual + ", expected " + outcome);
    }

    public static void main(String[] args) {
        expect("approved", Outcome.SUCCESS);
        expect("denied", Outcome.FAILURE);
        expect("expired", Outcome.FAILURE);
        expect("pending", Outcome.IN_PROGRESS);
        // Anything unexpected must never read as approval.
        expect("APPROVED", Outcome.IN_PROGRESS);
        expect("", Outcome.IN_PROGRESS);
        expect("null", Outcome.IN_PROGRESS);
        expect(null, Outcome.IN_PROGRESS);
        System.out.println("ApprovalStatusTest passed");
    }
}
