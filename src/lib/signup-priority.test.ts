import { describe, expect, it } from "vitest";
import type { Bag, Participant } from "./types.js";
import {
  getBagShirtPriority,
  getParticipantShirtPriority,
  parseSubmissionTimestamp,
  sortBagsBySignupDate,
} from "./signup-priority.js";

function participant(id: string, submissionDate: string): Participant {
  return {
    id,
    source: "Individual",
    sourceRowIndex: 1,
    submissionDate,
    firstName: id,
    lastName: "Test",
    fullName: id,
    email: "",
    normalizedEmail: "",
    phone: "",
    normalizedPhone: "",
    hasOrderId: true,
    rawShirtSize: "M",
    shirtSize: "Adult M",
    waiverSigned: true,
    rawWaiver: "Checked",
    assignedBagId: "",
  };
}
function bag(id: string, bagNumber: number, participantIds: string[]): Bag {
  return {
    id,
    bagNumber,
    familyName: id,
    primaryContactName: "",
    primaryEmail: "",
    primaryPhone: "",
    participantIds,
    packed: false,
    pickedUp: false,
  };
}

describe("signup date priority", () => {
  it("parses ISO timestamps and rejects invalid dates", () => {
    expect(parseSubmissionTimestamp("2026-10-05T23:59:00.000Z")).not.toBeNull();
    expect(parseSubmissionTimestamp("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseSubmissionTimestamp("")).toBeNull();
  });
  it("sorts by earliest participant signup date, then bag number, with unknown dates last", () => {
    const participants = {
      late: participant("late", "2026-10-11T20:00:00Z"),
      early: participant("early", "2026-10-02T10:00:00Z"),
      middle: participant("middle", "2026-10-06T01:00:00Z"),
    };
    const bags = [
      bag("late", 1, ["late"]),
      bag("mixed", 9, ["late", "early"]),
      bag("early", 3, ["early"]),
      bag("middle", 2, ["middle"]),
      bag("unknown", 0, ["missing"]),
    ];
    expect(sortBagsBySignupDate(bags, participants).map((b) => b.id)).toEqual([
      "early",
      "mixed",
      "middle",
      "late",
      "unknown",
    ]);
  });
  it("guarantees registrations through all of October 6, and treats October 7 onward as extra priority", () => {
    expect(
      getParticipantShirtPriority(participant("a", "2026-10-05T23:59:59Z")),
    ).toBe("guaranteed");
    expect(
      getParticipantShirtPriority(participant("b", "2026-10-06T00:00:00Z")),
    ).toBe("guaranteed");
    expect(
      getParticipantShirtPriority(participant("c", "2026-10-06T23:59:59Z")),
    ).toBe("guaranteed");
    expect(
      getParticipantShirtPriority(participant("d", "2026-10-07T00:00:00Z")),
    ).toBe("extra");
  });
  it("flags bags containing registrations on both sides of the cutoff as mixed", () => {
    const participants = {
      a: participant("a", "2026-10-05T12:00:00Z"),
      b: participant("b", "2026-10-08T12:00:00Z"),
    };
    expect(getBagShirtPriority(bag("mixed", 1, ["a", "b"]), participants)).toBe(
      "mixed",
    );
  });
});
