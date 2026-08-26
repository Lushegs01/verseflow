"use client";

import * as React from "react";
import { trackEvent } from "@/lib/utils/api-client";

/**
 * Records a profile view once per mount. Only the handle is sent; no viewer
 * identity is attached beyond whatever session already exists.
 */
export function ProfileViewTracker({ handle }: { handle: string }) {
  React.useEffect(() => {
    trackEvent("reputation_profile_viewed", { handle });
  }, [handle]);

  return null;
}
