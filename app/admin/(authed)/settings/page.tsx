"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Button } from "@/components/ui/button";

const KEYS = ["hero", "process"] as const;

export default function AdminSettingsPage() {
  const content = useQuery(api.siteContent.getMany, { keys: [...KEYS] });
  const setContent = useMutation(api.siteContent.set);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});

  useEffect(() => {
    if (content) {
      const next: Record<string, string> = {};
      for (const k of KEYS) {
        next[k] = JSON.stringify(content[k] ?? null, null, 2);
      }
      setDrafts(next);
    }
  }, [content]);

  async function save(key: string) {
    setSaving(key);
    try {
      const parsed = JSON.parse(drafts[key]);
      await setContent({ key, value: parsed });
      setSavedAt((s) => ({ ...s, [key]: Date.now() }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <Eyebrow className="mb-3">Configuration</Eyebrow>
      <h1 className="text-headline-lg uppercase mb-2">Site Content</h1>
      <p className="text-body-md text-foreground-muted mb-10 max-w-2xl">
        Edit the JSON values that drive the home page hero and process sections. Changes go live
        immediately. Static brand info (phone, address, social) lives in <code className="text-primary">config/site.ts</code>.
      </p>

      <div className="space-y-6">
        {KEYS.map((key) => (
          <div key={key} className="gloss-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-headline-md uppercase">{key}</h2>
              <div className="flex items-center gap-3">
                {savedAt[key] && Date.now() - savedAt[key] < 3000 && (
                  <span className="text-label-tech text-success flex items-center gap-1">
                    <Check size={12} /> Saved
                  </span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => save(key)}
                  disabled={saving === key}
                >
                  {saving === key ? (
                    <>
                      <Loader2 className="animate-spin" size={12} /> Saving...
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
            <textarea
              value={drafts[key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
              rows={Math.min(20, drafts[key]?.split("\n").length ?? 5)}
              className="w-full bg-surface-container-lowest font-mono-tech text-body-md text-foreground border border-border p-4 focus:outline-none focus:border-primary resize-y"
              spellCheck={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
