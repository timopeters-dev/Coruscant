import { NextResponse } from "next/server";
import {
  getPropertyById,
  updatePropertyImagePath,
} from "@/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from "@/lib/api/http";
import {
  deletePropertyImageIfExists,
  InvalidPropertyImageError,
  MAX_PROPERTY_IMAGE_BYTES,
  PropertyImagePathTraversalError,
  PropertyImageTooLargeError,
  readPropertyImageFile,
  savePropertyImageFile,
} from "@/lib/storage/property-image-storage";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const property = getPropertyById(id);
    if (!property || !property.imagePath) {
      return notFoundResponse("Kein Objektbild vorhanden.");
    }

    const { buffer, mimeType } = readPropertyImageFile(property.imagePath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(buffer.byteLength),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof PropertyImagePathTraversalError) {
      return notFoundResponse("Kein Objektbild vorhanden.");
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return notFoundResponse("Bilddatei nicht gefunden.");
    }
    return internalErrorResponse();
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const existing = getPropertyById(id);
    if (!existing) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return badRequestResponse(
        "Ungültige multipart/form-data-Anfrage für den Bildupload.",
      );
    }

    const fileEntry = formData.get("file");
    if (!fileEntry || !(fileEntry instanceof Blob)) {
      return badRequestResponse("Bitte eine Bilddatei im Feld 'file' hochladen.");
    }

    if (fileEntry.size > MAX_PROPERTY_IMAGE_BYTES) {
      return NextResponse.json(
        { error: new PropertyImageTooLargeError().message },
        { status: 413 },
      );
    }

    const arrayBuffer = await fileEntry.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let saved: ReturnType<typeof savePropertyImageFile>;
    try {
      saved = savePropertyImageFile(buffer, fileEntry.type);
    } catch (error) {
      if (error instanceof PropertyImageTooLargeError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      if (error instanceof InvalidPropertyImageError) {
        return badRequestResponse(error.message);
      }
      throw error;
    }

    let updatedResult: ReturnType<typeof updatePropertyImagePath>;
    try {
      updatedResult = updatePropertyImagePath(id, saved.storagePath);
    } catch (error) {
      try {
        deletePropertyImageIfExists(saved.storagePath);
      } catch {
        // Best-effort rollback of written file
      }
      throw error;
    }

    if (!updatedResult) {
      try {
        deletePropertyImageIfExists(saved.storagePath);
      } catch {
        // Best-effort rollback
      }
      return notFoundResponse("Immobilie nicht gefunden.");
    }

    if (
      updatedResult.previousImagePath &&
      updatedResult.previousImagePath !== saved.storagePath
    ) {
      try {
        deletePropertyImageIfExists(updatedResult.previousImagePath);
      } catch {
        // Best-effort cleanup of replaced image
      }
    }

    return NextResponse.json(
      { property: updatedResult.property },
      { status: 200 },
    );
  } catch {
    return internalErrorResponse();
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const updatedResult = updatePropertyImagePath(id, null);
    if (!updatedResult) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }

    if (updatedResult.previousImagePath) {
      try {
        deletePropertyImageIfExists(updatedResult.previousImagePath);
      } catch {
        // Best-effort cleanup
      }
    }

    return NextResponse.json(
      { property: updatedResult.property },
      { status: 200 },
    );
  } catch {
    return internalErrorResponse();
  }
}
