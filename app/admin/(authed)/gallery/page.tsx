"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
import { Camera, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/image";

export default function AdminGalleryPage() {
  const items = useQuery(api.gallery.list, {});
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const addItem = useMutation(api.gallery.add);
  const removeItem = useMutation(api.gallery.remove);
  const updateCaption = useMutation(api.gallery.updateCaption);
  // Two file inputs: one for picking from gallery / files, one that
  // forces the camera on mobile via `capture="environment"`. Desktop
  // browsers ignore the capture attribute, so the camera input behaves
  // like a normal file picker there — harmless.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    setError(null);
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        // 1. Compress client-side before upload — phone photos can be
        //    8–20 MB raw; we downscale to 2000px max and re-encode JPEG
        //    @ 0.85 quality. Visually identical, ~10x smaller on the wire.
        const { blob } = await compressImage(file);

        // 2. Get a one-shot upload URL from Convex.
        const uploadUrl = await generateUploadUrl();

        // 3. POST the compressed blob. The Content-Type MUST match the
        //    blob's type (image/jpeg after compression, or the original
        //    type if we passthrough'd) — Convex storage uses this for
        //    serving later, and a mismatch makes the image fail to
        //    render in browsers.
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || file.type || "image/jpeg" },
          body: blob,
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status}). Try again.`);
        }
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };

        await addItem({
          imageStorageId: storageId,
          beforeAfter: false,
          order: (items?.length ?? 0) + 1 + i,
        });
        setProgress({ done: i + 1, total: list.length });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  async function handleDelete(id: Id<"gallery">) {
    if (!confirm("Delete this image?")) return;
    await removeItem({ id });
  }

  const uploading = progress !== null;
  const uploadLabel = uploading
    ? `Uploading ${progress.done}/${progress.total}...`
    : null;

  return (
    <div>
      <div className="flex flex-wrap justify-between items-end gap-3 mb-10">
        <div>
          <Eyebrow className="mb-3">Showcase</Eyebrow>
          <h1 className="text-headline-lg uppercase">Gallery</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="md"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
          >
            <Camera size={14} /> Take photo
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" size={14} /> {uploadLabel}
              </>
            ) : (
              <>
                <Plus size={14} /> Upload images
              </>
            )}
          </Button>
        </div>

        {/* Standard file picker — accepts any image, multi-select allowed.
            iPhones/Android show a chooser that includes "Take Photo"
            alongside the photo library, so even this single input gives
            mobile users a camera path. The dedicated camera button just
            skips the chooser step. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleUpload(e.target.files)}
        />
        {/* Camera-only input. `capture="environment"` forces the rear
            camera on mobile (desktop ignores the attribute). */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {error && <p className="text-error text-body-md mb-4">{error}</p>}

      {items === undefined ? (
        <p className="text-foreground-muted">Loading...</p>
      ) : items.length === 0 ? (
        <div className="gloss-card p-12 text-center">
          <Upload className="text-foreground-muted mx-auto mb-4" size={32} />
          <p className="text-foreground-muted mb-6">No images yet — upload your first showcase.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            <Button variant="ghost" size="md" onClick={() => cameraInputRef.current?.click()}>
              <Camera size={14} /> Take photo
            </Button>
            <Button variant="primary" size="md" onClick={() => fileInputRef.current?.click()}>
              <Plus size={14} /> Upload
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {items.map((item) => (
            <div key={item._id} className="gloss-card relative group overflow-hidden">
              <div className="relative aspect-square">
                {item.imageUrl && (
                  <Image
                    src={item.imageUrl}
                    alt={item.caption ?? "Gallery image"}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 50vw, 25vw"
                  />
                )}
              </div>
              <div className="p-3 border-t border-border">
                <input
                  defaultValue={item.caption ?? ""}
                  placeholder="Add caption..."
                  onBlur={(e) =>
                    e.target.value !== (item.caption ?? "") &&
                    updateCaption({ id: item._id, caption: e.target.value })
                  }
                  className="w-full bg-transparent text-label-tech text-foreground-muted focus:text-foreground focus:outline-none"
                />
              </div>
              <button
                onClick={() => handleDelete(item._id)}
                className="absolute top-2 right-2 w-8 h-8 bg-surface/80 backdrop-blur flex items-center justify-center text-foreground-muted hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
