"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

export default function AdminGalleryPage() {
  const items = useQuery(api.gallery.list, {});
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const addItem = useMutation(api.gallery.add);
  const removeItem = useMutation(api.gallery.remove);
  const updateCaption = useMutation(api.gallery.updateCaption);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await addItem({
          imageStorageId: storageId,
          beforeAfter: false,
          order: (items?.length ?? 0) + 1,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(id: Id<"gallery">) {
    if (!confirm("Delete this image?")) return;
    await removeItem({ id });
  }

  return (
    <div>
      <div className="flex justify-between items-end mb-10">
        <div>
          <Eyebrow className="mb-3">Showcase</Eyebrow>
          <h1 className="text-headline-lg uppercase">Gallery</h1>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 className="animate-spin" size={14} /> Uploading...
            </>
          ) : (
            <>
              <Plus size={14} /> Upload Images
            </>
          )}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
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
          <Button variant="primary" size="md" onClick={() => inputRef.current?.click()}>
            <Plus size={14} /> Upload
          </Button>
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
