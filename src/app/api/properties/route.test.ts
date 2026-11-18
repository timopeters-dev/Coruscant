import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import {
  GET as listContracts,
  POST as createContract,
} from "@/app/api/contracts/route";
import { PATCH as patchContractById } from "@/app/api/contracts/[id]/route";
import { MAX_PROPERTY_IMAGE_BYTES } from "@/lib/storage/property-image-storage";
import {
  DELETE as deletePropertyImage,
  GET as getPropertyImage,
  POST as uploadPropertyImage,
} from "./[id]/image/route";
import {
  DELETE as deletePropertyById,
  GET as getPropertyById,
  PATCH as patchPropertyById,
} from "./[id]/route";
import { GET as listProperties, POST as createProperty } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalImagesDir = process.env.PROPERTY_IMAGES_DIR;

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-properties-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  process.env.PROPERTY_IMAGES_DIR = path.join(dir, "images");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  if (originalImagesDir === undefined) {
    delete process.env.PROPERTY_IMAGES_DIR;
  } else {
    process.env.PROPERTY_IMAGES_DIR = originalImagesDir;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("/api/properties CRUD & integrity", () => {
  it("supports POST -> GET list -> GET [id] -> PATCH [id] -> DELETE [id]", async () => {
    const createReq = new Request("http://localhost/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Immobilie #0 (Musterstraße 1)",
        usage: "owner_occupied",
        purchaseDate: "2024-03-01",
        purchasePriceCents: 45000000,
        estimatedValueCents: 48000000,
      }),
    });

    const createRes = await createProperty(createReq);
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as {
      property: { id: string; name: string; estimatedValueCents: number };
    };
    const propertyId = createdBody.property.id;
    expect(createdBody.property.name).toBe("Immobilie #0 (Musterstraße 1)");
    expect(createdBody.property.estimatedValueCents).toBe(48000000);

    const listRes = await listProperties();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      properties: Array<{ id: string }>;
    };
    expect(listBody.properties).toHaveLength(1);
    expect(listBody.properties[0]?.id).toBe(propertyId);

    const getRes = await getPropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(getRes.status).toBe(200);

    const patchRes = await patchPropertyById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedValueCents: 49500000 }),
      }),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedBody = (await patchRes.json()) as {
      property: { estimatedValueCents: number };
    };
    expect(patchedBody.property.estimatedValueCents).toBe(49500000);

    const deleteRes = await deletePropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ deletedId: propertyId });

    const afterDeleteRes = await getPropertyById(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it("returns 400 on invalid inputs and 404 on unknown IDs without leaking internals", async () => {
    const invalidRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          purchaseDate: "2026-02-30",
          estimatedValueCents: -500,
        }),
      }),
    );
    expect(invalidRes.status).toBe(400);
    const raw = await invalidRes.text();
    expect(raw).not.toContain("SQLITE");
    expect(raw).not.toContain("Error:");

    const unknownRes = await getPropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-prop" }),
    });
    expect(unknownRes.status).toBe(404);
  });

  it("sets linkedPropertyId to null on contracts when a linked property is deleted", async () => {
    const propRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Immobilie #0 (Musterstraße 1)",
          estimatedValueCents: 40000000,
        }),
      }),
    );
    const { property } = (await propRes.json()) as {
      property: { id: string };
    };

    const contractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 25000000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 120000,
          interestRateBps: 340,
          linkedPropertyId: property.id,
        }),
      }),
    );
    expect(contractRes.status).toBe(201);

    const delRes = await deletePropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(delRes.status).toBe(200);

    const contractsRes = await listContracts();
    const { contracts } = (await contractsRes.json()) as {
      contracts: Array<{ id: string; linkedPropertyId: string | null }>;
    };
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.linkedPropertyId).toBeNull();
  });

  it("persists extended property metadata and allows resetting optional fields to null via PATCH", async () => {
    const createRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Musterhaus",
          usage: "rented",
          estimatedValueCents: 42000000,
          street: "Musterstraße",
          houseNumber: "1",
          postalCode: "12345",
          city: "Musterstadt",
          livingAreaSqm: 145,
          usableAreaSqm: 35,
          plotAreaSqm: 520,
          constructionYear: 1998,
          energyClass: "B",
          features: "Kamin, Sauna",
        }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      property: {
        id: string;
        street: string | null;
        houseNumber: string | null;
        postalCode: string | null;
        city: string | null;
        livingAreaSqm: number | null;
        usableAreaSqm: number | null;
        plotAreaSqm: number | null;
        constructionYear: number | null;
        energyClass: string | null;
        features: string | null;
      };
    };
    expect(created.property.street).toBe("Musterstraße");
    expect(created.property.livingAreaSqm).toBe(145);
    expect(created.property.energyClass).toBe("B");
    expect(created.property.features).toBe("Kamin, Sauna");

    const patchRes = await patchPropertyById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          livingAreaSqm: 150,
          street: null,
          energyClass: null,
          features: null,
        }),
      }),
      { params: Promise.resolve({ id: created.property.id }) },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      property: {
        livingAreaSqm: number | null;
        street: string | null;
        city: string | null;
        energyClass: string | null;
        features: string | null;
      };
    };
    expect(patched.property.livingAreaSqm).toBe(150);
    expect(patched.property.city).toBe("Musterstadt");
    expect(patched.property.street).toBeNull();
    expect(patched.property.energyClass).toBeNull();
    expect(patched.property.features).toBeNull();
  });

  it("handles property image upload, replacement, validation errors, serving, and cleanup on delete", async () => {
    const createRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Musterhaus Bildtest",
          estimatedValueCents: 30000000,
        }),
      }),
    );
    const { property } = (await createRes.json()) as {
      property: { id: string };
    };
    const imagesDir = process.env.PROPERTY_IMAGES_DIR as string;

    // 404 before image uploaded
    const emptyGet = await getPropertyImage(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(emptyGet.status).toBe(404);

    // 404 on unknown property
    const unknownGet = await getPropertyImage(new Request("http://localhost"), {
      params: Promise.resolve({ id: "unknown-id" }),
    });
    expect(unknownGet.status).toBe(404);

    // 400 on missing file field
    const missingForm = new FormData();
    const missingRes = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: missingForm }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(missingRes.status).toBe(400);

    // 400 on invalid magic bytes / MIME
    const badForm = new FormData();
    badForm.append(
      "file",
      new Blob([Buffer.from("%PDF-1.7")], { type: "image/png" }),
      "evil.png",
    );
    const badRes = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: badForm }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(badRes.status).toBe(400);

    // 413 on oversized file
    const bigBuf = Buffer.alloc(MAX_PROPERTY_IMAGE_BYTES + 1);
    PNG_BYTES.copy(bigBuf);
    const bigForm = new FormData();
    bigForm.append(
      "file",
      new Blob([bigBuf], { type: "image/png" }),
      "big.png",
    );
    const bigRes = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: bigForm }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(bigRes.status).toBe(413);

    // 200 on valid PNG upload
    const pngForm = new FormData();
    pngForm.append(
      "file",
      new Blob([PNG_BYTES], { type: "image/png" }),
      "house.png",
    );
    const uploadRes = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: pngForm }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as {
      property: { imagePath: string | null };
    };
    const firstImagePath = uploadBody.property.imagePath;
    expect(firstImagePath).toMatch(/\.png$/);
    expect(fs.existsSync(path.join(imagesDir, firstImagePath!))).toBe(true);

    // GET serves identical bytes with nosniff
    const getRes = await getPropertyImage(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("Content-Type")).toBe("image/png");
    expect(getRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const servedBuf = Buffer.from(await getRes.arrayBuffer());
    expect(servedBuf.equals(PNG_BYTES)).toBe(true);

    // Replace with JPEG -> old PNG deleted from disk
    const jpgForm = new FormData();
    jpgForm.append(
      "file",
      new Blob([JPEG_BYTES], { type: "image/jpeg" }),
      "house.jpg",
    );
    const replaceRes = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: jpgForm }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(replaceRes.status).toBe(200);
    const replaceBody = (await replaceRes.json()) as {
      property: { imagePath: string | null };
    };
    const secondImagePath = replaceBody.property.imagePath;
    expect(secondImagePath).toMatch(/\.jpg$/);
    expect(fs.existsSync(path.join(imagesDir, firstImagePath!))).toBe(false);
    expect(fs.existsSync(path.join(imagesDir, secondImagePath!))).toBe(true);

    // DELETE image endpoint removes file & resets imagePath
    const delImgRes = await deletePropertyImage(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(delImgRes.status).toBe(200);
    const delImgBody = (await delImgRes.json()) as {
      property: { imagePath: string | null };
    };
    expect(delImgBody.property.imagePath).toBeNull();
    expect(fs.existsSync(path.join(imagesDir, secondImagePath!))).toBe(false);

    const afterDelGet = await getPropertyImage(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(afterDelGet.status).toBe(404);

    // Upload again and verify DELETE /api/properties/[id] cleans up the image
    const pngForm2 = new FormData();
    pngForm2.append(
      "file",
      new Blob([PNG_BYTES], { type: "image/png" }),
      "house2.png",
    );
    const uploadRes2 = await uploadPropertyImage(
      new Request("http://localhost", { method: "POST", body: pngForm2 }),
      { params: Promise.resolve({ id: property.id }) },
    );
    const uploadBody2 = (await uploadRes2.json()) as {
      property: { imagePath: string | null };
    };
    const thirdImagePath = uploadBody2.property.imagePath!;
    expect(fs.existsSync(path.join(imagesDir, thirdImagePath))).toBe(true);

    const delPropRes = await deletePropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(delPropRes.status).toBe(200);
    expect(fs.existsSync(path.join(imagesDir, thirdImagePath))).toBe(false);
  });

  it("links and unlinks an existing contract via PATCH /api/contracts/[id]", async () => {
    const propRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Musterhaus Verknüpfung",
          estimatedValueCents: 38000000,
        }),
      }),
    );
    const { property } = (await propRes.json()) as {
      property: { id: string };
    };

    const contractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unverknüpfter Kredit",
          category: "loan",
          currentBalanceCents: 15000000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 80000,
          interestRateBps: 320,
        }),
      }),
    );
    const { contract } = (await contractRes.json()) as {
      contract: { id: string; linkedPropertyId: string | null };
    };
    expect(contract.linkedPropertyId).toBeNull();

    // Link
    const linkRes = await patchContractById(
      new Request(`http://localhost/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedPropertyId: property.id }),
      }),
      { params: Promise.resolve({ id: contract.id }) },
    );
    expect(linkRes.status).toBe(200);
    const linkedBody = (await linkRes.json()) as {
      contract: { linkedPropertyId: string | null };
    };
    expect(linkedBody.contract.linkedPropertyId).toBe(property.id);

    // Unlink
    const unlinkRes = await patchContractById(
      new Request(`http://localhost/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedPropertyId: null }),
      }),
      { params: Promise.resolve({ id: contract.id }) },
    );
    expect(unlinkRes.status).toBe(200);
    const unlinkedBody = (await unlinkRes.json()) as {
      contract: { linkedPropertyId: string | null };
    };
    expect(unlinkedBody.contract.linkedPropertyId).toBeNull();

    // Unknown propertyId -> 400
    const badLinkRes = await patchContractById(
      new Request(`http://localhost/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedPropertyId: "non-existent-property" }),
      }),
      { params: Promise.resolve({ id: contract.id }) },
    );
    expect(badLinkRes.status).toBe(400);
  });

  it("validates rental profile rules on POST and merged PATCH, and enforces unique maintenanceReservePotId", async () => {
    // POST rented with rental fields -> 201
    const rentedRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Wohnung Musterstraße 1",
          usage: "rented",
          estimatedValueCents: 25_000_000,
          monthlyColdRentCents: 80_000,
          monthlyNonRecoverableCostsCents: 6_000,
          monthlyMaintenanceAllowanceCents: 5_000,
          depreciationBasisCents: 18_000_000,
        }),
      }),
    );
    expect(rentedRes.status).toBe(201);
    const { property: rentedProp } = (await rentedRes.json()) as {
      property: {
        id: string;
        monthlyColdRentCents: number | null;
        monthlyMaintenanceAllowanceCents: number | null;
      };
    };
    expect(rentedProp.monthlyColdRentCents).toBe(80_000);
    expect(rentedProp.monthlyMaintenanceAllowanceCents).toBe(5_000);

    // POST owner_occupied with rent -> 400 with fieldErrors.monthlyColdRentCents
    const invalidOwnerRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Immobilie #0",
          usage: "owner_occupied",
          estimatedValueCents: 30_000_000,
          monthlyColdRentCents: 50_000,
        }),
      }),
    );
    expect(invalidOwnerRes.status).toBe(400);
    const invalidOwnerBody = (await invalidOwnerRes.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(invalidOwnerBody.fieldErrors?.monthlyColdRentCents).toBeTruthy();

    // Create valid owner_occupied
    const ownerRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Immobilie #0",
          usage: "owner_occupied",
          estimatedValueCents: 30_000_000,
        }),
      }),
    );
    const { property: ownerProp } = (await ownerRes.json()) as {
      property: { id: string };
    };

    // PATCH owner_occupied with only monthlyColdRentCents -> 400 (merged check)
    const patchOwnerRent = await patchPropertyById(
      new Request(`http://localhost/api/properties/${ownerProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyColdRentCents: 40_000 }),
      }),
      { params: Promise.resolve({ id: ownerProp.id }) },
    );
    expect(patchOwnerRent.status).toBe(400);

    // PATCH rented -> owner_occupied without nulls -> 400
    const patchSwitchWithoutNulls = await patchPropertyById(
      new Request(`http://localhost/api/properties/${rentedProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usage: "owner_occupied" }),
      }),
      { params: Promise.resolve({ id: rentedProp.id }) },
    );
    expect(patchSwitchWithoutNulls.status).toBe(400);

    // PATCH rented -> owner_occupied with explicit nulls -> 200
    const patchSwitchWithNulls = await patchPropertyById(
      new Request(`http://localhost/api/properties/${rentedProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usage: "owner_occupied",
          monthlyColdRentCents: null,
          monthlyNonRecoverableCostsCents: null,
          monthlyMaintenanceAllowanceCents: null,
          depreciationBasisCents: null,
        }),
      }),
      { params: Promise.resolve({ id: rentedProp.id }) },
    );
    expect(patchSwitchWithNulls.status).toBe(200);
    const switchedBody = (await patchSwitchWithNulls.json()) as {
      property: { monthlyColdRentCents: number | null };
    };
    expect(switchedBody.property.monthlyColdRentCents).toBeNull();

    // Unknown maintenanceReservePotId -> 400
    const unknownPotRes = await patchPropertyById(
      new Request(`http://localhost/api/properties/${rentedProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceReservePotId: "pot-does-not-exist" }),
      }),
      { params: Promise.resolve({ id: rentedProp.id }) },
    );
    expect(unknownPotRes.status).toBe(400);

    // Create a pot and assign to rentedProp -> 200
    const db = dbModule.getDb();
    const { pots } = await import("@/db/schema");
    db.insert(pots)
      .values({
        id: "pot-res-1",
        name: "Instandhaltung",
        priority: 1,
        currentCents: 0,
        ruleType: "fill_to_target",
        targetCents: 500_000,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const assignPotRes = await patchPropertyById(
      new Request(`http://localhost/api/properties/${rentedProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceReservePotId: "pot-res-1" }),
      }),
      { params: Promise.resolve({ id: rentedProp.id }) },
    );
    expect(assignPotRes.status).toBe(200);

    // Re-saving same property with same pot -> 200
    const resavePotRes = await patchPropertyById(
      new Request(`http://localhost/api/properties/${rentedProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceReservePotId: "pot-res-1" }),
      }),
      { params: Promise.resolve({ id: rentedProp.id }) },
    );
    expect(resavePotRes.status).toBe(200);

    // Assigning same pot to ownerProp -> 400
    const conflictPotRes = await patchPropertyById(
      new Request(`http://localhost/api/properties/${ownerProp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceReservePotId: "pot-res-1" }),
      }),
      { params: Promise.resolve({ id: ownerProp.id }) },
    );
    expect(conflictPotRes.status).toBe(400);
  });
});
