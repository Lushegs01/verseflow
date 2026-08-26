"use client";

import * as React from "react";
import { Share2, Check } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { trackEvent } from "@/lib/utils/api-client";

/** Share a public profile URL. Uses the native share sheet on mobile. */
export function ShareProfile({ handle, name }: { handle: string; name: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  const share = async () => {
    const url = `${window.location.origin}/p/${handle}`;
    trackEvent("public_agreement_shared", { handle });

    if (navigator.share) {
      try {
        await navigator.share({ title: `${name} on VerseFlow`, url });
        return;
      } catch {
        // The user dismissed the share sheet; fall through to copying.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ tone: "settle", title: "Link copied", body: url });
    } catch {
      toast({ tone: "attn", title: "Could not copy", body: url });
    }
  };

  return (
    <Button
      variant="secondary"
      icon={copied ? <Check className="size-3.5" /> : <Share2 className="size-3.5" />}
      onClick={share}
    >
      {copied ? "Copied" : "Share reputation"}
    </Button>
  );
}
