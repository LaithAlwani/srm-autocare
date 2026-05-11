"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Plus, Star, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

export default function AdminReviewsPage() {
  const reviews = useQuery(api.reviews.listAll);
  const createReview = useMutation(api.reviews.create);
  const setFeatured = useMutation(api.reviews.setFeatured);
  const removeReview = useMutation(api.reviews.remove);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    author: "",
    rating: 5,
    body: "",
    vehicleInfo: "",
    featured: true,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createReview({
      author: form.author,
      rating: form.rating,
      body: form.body,
      vehicleInfo: form.vehicleInfo || undefined,
      source: "manual",
      date: Date.now(),
      featured: form.featured,
    });
    setForm({ author: "", rating: 5, body: "", vehicleInfo: "", featured: true });
    setShowForm(false);
  }

  return (
    <div>
      <div className="flex justify-between items-end mb-10">
        <div>
          <Eyebrow className="mb-3">Social Proof</Eyebrow>
          <h1 className="text-headline-lg uppercase">Reviews</h1>
        </div>
        {!showForm && (
          <Button variant="primary" size="md" onClick={() => setShowForm(true)}>
            <Plus size={14} /> New Review
          </Button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="gloss-card p-8 mb-8 space-y-4">
          <h2 className="text-headline-md uppercase mb-4">New review</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              required
              placeholder="Author"
              value={form.author}
              onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))}
              className="bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
            />
            <input
              placeholder="Vehicle (optional)"
              value={form.vehicleInfo}
              onChange={(e) => setForm((f) => ({ ...f, vehicleInfo: e.target.value }))}
              className="bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setForm((f) => ({ ...f, rating: n }))}
                className="text-primary"
              >
                <Star size={24} fill={n <= form.rating ? "currentColor" : "transparent"} />
              </button>
            ))}
          </div>
          <textarea
            required
            rows={4}
            placeholder="Review body"
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            className="w-full bg-surface-container px-4 py-3 text-body-md text-foreground border-0 border-b border-chrome focus:outline-none focus:border-primary resize-none"
          />
          <label className="flex items-center gap-3 text-label-tech text-foreground">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            Featured on home page
          </label>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="md" onClick={() => setShowForm(false)} type="button">
              Cancel
            </Button>
            <Button variant="primary" size="md" type="submit">
              Save
            </Button>
          </div>
        </form>
      )}

      {reviews === undefined ? (
        <p className="text-foreground-muted">Loading...</p>
      ) : reviews.length === 0 ? (
        <div className="gloss-card p-12 text-center text-foreground-muted">
          No reviews yet.
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => (
            <div key={r._id} className="gloss-card p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-headline-md text-foreground">{r.author}</span>
                    {r.vehicleInfo && (
                      <span className="text-label-tech text-foreground-muted">{r.vehicleInfo}</span>
                    )}
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          size={12}
                          className="text-primary"
                          fill={n <= r.rating ? "currentColor" : "transparent"}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-body-md text-foreground-muted italic">"{r.body}"</p>
                </div>
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <label className="flex items-center gap-2 text-label-tech text-foreground-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={r.featured}
                      onChange={(e) => setFeatured({ id: r._id, featured: e.target.checked })}
                      className="w-4 h-4 accent-primary"
                    />
                    Featured
                  </label>
                  <button
                    onClick={async () => {
                      if (confirm("Delete this review?")) await removeReview({ id: r._id });
                    }}
                    className="text-foreground-muted hover:text-error"
                    aria-label="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
