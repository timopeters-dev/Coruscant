"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import { type PropertyDetailState } from "./use-property-detail";

/** Objektbild hochladen, ersetzen oder entfernen. */
export function PropertyImageSection({ ws }: { ws: PropertyDetailState }) {
  const {
    fileInputRef, handleImageFileSelected, handleRemoveImage, imageError, isBusy, isRemovingImage,
    isUploadingImage, property,
  } = ws;
  return (
    <>
      {/* Objektbild */}
      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageFileSelected}
          className="hidden"
        />

        {property.imagePath ? (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/properties/${property.id}/image?v=${encodeURIComponent(property.updatedAt)}`}
              alt={`Objektbild: ${property.name}`}
              className="max-h-48 w-full rounded-xl border border-[var(--border)] object-cover"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
              >
                <ImagePlus className="h-3.5 w-3.5" />
                {isUploadingImage ? "Lädt hoch..." : "Bild ersetzen"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemoveImage}
                disabled={isBusy}
                className="text-[var(--rose)] hover:text-[var(--rose)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {isRemovingImage ? "Entfernt..." : "Bild entfernen"}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-sub)] bg-[var(--surface-elevated)]/30 px-4 py-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImagePlus className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {isUploadingImage
                ? "Bild wird hochgeladen..."
                : "Objektbild hinzufügen (JPEG, PNG, WebP · max. 5 MB)"}
            </span>
          </button>
        )}

        {imageError ? (
          <p className="text-xs text-[var(--rose)]">{imageError}</p>
        ) : null}
      </div>
    </>
  );
}
