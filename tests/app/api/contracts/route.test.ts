import { describe, expect, it } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { apiRequest } from "@tests/helpers/http";
import { financialContracts } from "@/backend/db/schema";
import {
  DELETE as deleteContractById,
  GET as getContractById,
  PATCH as patchContractById,
} from "@/app/api/contracts/[id]/route";
import { GET as listContracts, POST as createContract } from "@/app/api/contracts/route";

withTempDatabase();

describe("/api/contracts CRUD & validation", () => {
  it("supports creating all 4 contract types, status transitions, category switching, and deletion", async () => {
    const payloads = [
      {
        name: "Annuitätendarlehen Musterbank",
        provider: "Musterbank",
        category: "loan",
        repaymentType: "annuity",
        currentBalanceCents: 29500000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 140000,
        interestRateBps: 350,
      },
      {
        name: "Ratendarlehen Musterbank",
        category: "loan",
        repaymentType: "installment",
        currentBalanceCents: 2000000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 50000,
        interestRateBps: 400,
      },
      {
        name: "Privatdarlehen Familie Muster",
        category: "loan",
        repaymentType: "lump_sum",
        currentBalanceCents: 1500000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 0,
        interestRateBps: 0,
      },
      {
        name: "Bausparvertrag Musterkasse",
        category: "savings_contract",
        currentBalanceCents: 1200000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 30000,
        interestRateBps: 100,
        targetSumCents: 5000000,
        allocationThresholdPercent: 40,
        futureLoanInterestRateBps: 250,
      },
    ];

    const createdIds: string[] = [];
    for (const payload of payloads) {
      const res = await createContract(
        new Request("http://localhost/api/contracts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { contract: { id: string } };
      createdIds.push(body.contract.id);
    }

    const listRes = await listContracts(apiRequest("/api/contracts"));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      contracts: Array<{ id: string }>;
    };
    expect(listBody.contracts).toHaveLength(4);

    // Status transitions + category switch on first contract
    const targetId = createdIds[0]!;
    const pauseRes = await patchContractById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    expect(pauseRes.status).toBe(200);

    const switchRes = await patchContractById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "closed",
          category: "savings_contract",
          targetSumCents: 10000000,
        }),
      }),
      { params: Promise.resolve({ id: targetId }) },
    );
    expect(switchRes.status).toBe(200);
    const switchedBody = (await switchRes.json()) as {
      contract: {
        status: string;
        category: string;
        repaymentType: string | null;
        targetSumCents: number | null;
      };
    };
    expect(switchedBody.contract.status).toBe("closed");
    expect(switchedBody.contract.category).toBe("savings_contract");
    expect(switchedBody.contract.repaymentType).toBeNull();
    expect(switchedBody.contract.targetSumCents).toBe(10000000);

    const delRes = await deleteContractById(new Request("http://localhost"), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(delRes.status).toBe(200);

    const getDeleted = await getContractById(new Request("http://localhost"), {
      params: Promise.resolve({ id: targetId }),
    });
    expect(getDeleted.status).toBe(404);
  });

  it("returns 400 for unknown linkedPropertyId, invalid dates, or float cents, and 404 for unknown ID", async () => {
    const unknownPropRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 100000,
          balanceAsOfDate: "2026-11-01",
          linkedPropertyId: "non-existent-property",
        }),
      }),
    );
    expect(unknownPropRes.status).toBe(400);
    const propErrorText = await unknownPropRes.text();
    expect(propErrorText).not.toContain("FOREIGN KEY");

    const invalidDateRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 100000,
          balanceAsOfDate: "2026-02-30",
        }),
      }),
    );
    expect(invalidDateRes.status).toBe(400);

    const floatRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 100.5,
          balanceAsOfDate: "2026-11-01",
        }),
      }),
    );
    expect(floatRes.status).toBe(400);

    const unknownContract = await patchContractById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
      { params: Promise.resolve({ id: "missing-contract" }) },
    );
    expect(unknownContract.status).toBe(404);
  });
});

describe("/api/contracts household only", () => {
  it("ignores a legacy sphere field, stores household and returns contracts without sphere in the list", async () => {
    const res = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Musterkredit",
          sphere: "personal",
          category: "loan",
          currentBalanceCents: 100_000,
          balanceAsOfDate: "2026-11-01",
        }),
      }),
    );
    expect(res.status).toBe(201);

    const row = dbModule
      .getDb()
      .select()
      .from(financialContracts)
      .get();
    expect(row?.sphere).toBe("household");

    const list = (await (await listContracts(apiRequest("/api/contracts"))).json()) as {
      contracts: Array<Record<string, unknown>>;
    };
    expect(list.contracts).toHaveLength(1);
    expect("sphere" in list.contracts[0]!).toBe(false);
  });
});
