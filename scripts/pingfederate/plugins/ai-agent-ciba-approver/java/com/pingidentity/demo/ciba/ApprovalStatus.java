package com.pingidentity.demo.ciba;

/** Maps the demo BFF's answer for a pending approval onto what PingFederate's check() must report. */
final class ApprovalStatus {
    enum Outcome { IN_PROGRESS, SUCCESS, FAILURE }

    private ApprovalStatus() { }

    /** Anything the BFF does not clearly call "approved" or a refusal keeps waiting; PingFederate expires it. */
    static Outcome of(String bffStatus) {
        if (bffStatus == null) return Outcome.IN_PROGRESS;
        switch (bffStatus) {
            case "approved": return Outcome.SUCCESS;
            case "denied":
            case "expired": return Outcome.FAILURE;
            default: return Outcome.IN_PROGRESS;
        }
    }
}
